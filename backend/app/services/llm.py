"""Provider-agnostic access to a chat-completions LLM.

The app used to build one Mistral SDK client with one hard-coded model. When
Mistral cut that model to zero requests a minute on free accounts, every AI
feature failed at once, and all a user ever saw was "Mistral AI is busy".

Every provider listed here speaks the OpenAI chat-completions wire format, so a
single small `requests` client covers all of them. Which providers are used,
and in what order, is configuration rather than code:

    AI_PROVIDERS=groq,openai                   # the default order
    GROQ_API_KEY=...      GROQ_MODEL=openai/gpt-oss-120b,openai/gpt-oss-20b
    OPENAI_API_KEY=...    OPENAI_MODEL=gpt-4o-mini
    GEMINI_API_KEY=...    GEMINI_MODEL=gemini-flash-lite-latest
    MISTRAL_API_KEY=...   MISTRAL_MODEL=open-mistral-nemo

A provider without a key is skipped. Each request walks the remaining chain,
every model of every provider, until one returns a usable answer. A model that
rate-limits is benched until its quota window reopens, so the requests behind
it skip straight past instead of paying a round trip to be refused again.

Gemini and Mistral are opt-in: they are used only when AI_PROVIDERS names
them. Their free tiers may use API content to improve their models, and this
app sends people's Gmail content, which the privacy policy and Google's Limited
Use rules promise is never used to train a model. A key alone must not be
enough to start sending mail there — someone has to choose it, ideally after
turning off training in that provider's console or moving to a paid plan.

Nothing here logs or returns an API key.
"""
import json
import os
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

import requests
from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Provider:
    name: str
    label: str
    base_url: str
    default_models: tuple
    # OpenAI renamed max_tokens to max_completion_tokens and its reasoning
    # models reject the old name. Groq takes either; Mistral and Gemini's
    # OpenAI-compatible endpoint take the old one.
    max_tokens_field: str = "max_tokens"
    # OpenAI's reasoning models refuse any temperature but their default, and
    # OPENAI_MODEL can name one, so OpenAI is left on its default.
    accepts_temperature: bool = True


PROVIDERS = {
    "groq": Provider(
        "groq", "Groq", "https://api.groq.com/openai/v1",
        ("openai/gpt-oss-120b", "openai/gpt-oss-20b"),
        max_tokens_field="max_completion_tokens",
    ),
    "gemini": Provider(
        "gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
        ("gemini-flash-lite-latest", "gemini-flash-latest"),
    ),
    "openai": Provider(
        "openai", "OpenAI", "https://api.openai.com/v1",
        ("gpt-4o-mini",),
        max_tokens_field="max_completion_tokens",
        accepts_temperature=False,
    ),
    # Mistral's free mode allows 0 requests/minute on mistral-medium-latest and
    # mistral-small-latest; only open-mistral-nemo and ministral-8b answer, at
    # about 2 requests/minute, so open-mistral-nemo is the default. After
    # upgrading, MISTRAL_MODEL=mistral-medium-latest brings the larger one back.
    "mistral": Provider(
        "mistral", "Mistral", "https://api.mistral.ai/v1",
        ("open-mistral-nemo",),
    ),
}
# Only providers that do not train on API content by default. Gemini and
# Mistral join the chain when AI_PROVIDERS lists them (see the module notes).
DEFAULT_ORDER = ("groq", "openai")


def _model_options(provider, model):
    """Request fields one particular model needs on top of the standard ones."""
    if provider == "groq" and model.startswith("openai/gpt-oss"):
        # gpt-oss reasons before it answers, and those tokens count against
        # the free tier's per-minute token cap. Low effort is plenty for email
        # work, and the reasoning text itself is never shown, so it is not sent.
        return {"reasoning_effort": "low", "include_reasoning": False}
    return {}


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class LLMError(Exception):
    """No configured provider produced a usable answer.

    `kind` says why in a form the API can act on; `user_message` is the
    sentence to put in front of a person. The underlying detail goes to the
    server log, never to the browser, since it can name the account's plan.
    """

    NOT_CONFIGURED = "not_configured"
    RATE_LIMITED = "rate_limited"
    UNAVAILABLE = "unavailable"

    _MESSAGES = {
        NOT_CONFIGURED: (
            "The AI service is not configured on the server yet. Add GROQ_API_KEY "
            "(or another provider's key) to the backend environment."
        ),
        RATE_LIMITED: (
            "The AI service has reached its free usage limit for the moment. "
            "Please wait about a minute and try again."
        ),
        UNAVAILABLE: (
            "The AI service is not responding right now. Please try again in a moment."
        ),
    }

    def __init__(self, kind, detail=""):
        self.kind = kind
        self.detail = detail
        super().__init__(f"{kind}: {detail}" if detail else kind)

    @property
    def user_message(self):
        return self._MESSAGES.get(self.kind, self._MESSAGES[self.UNAVAILABLE])


class _Attempt(Exception):
    """One candidate failed. Carries how, so the walk can move on and summarise."""

    def __init__(self, kind, detail="", bench=0.0, retry_after=None):
        self.kind = kind
        self.detail = detail
        self.bench = bench
        self.retry_after = retry_after
        super().__init__(f"{kind}: {detail}")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

def _env_list(name):
    return [part.strip() for part in (os.getenv(name) or "").split(",") if part.strip()]


def provider_order():
    order = []
    for name in (_env_list("AI_PROVIDERS") or DEFAULT_ORDER):
        name = name.lower()
        if name in PROVIDERS and name not in order:
            order.append(name)
    return order


def _api_key(name):
    return (os.getenv(f"{name.upper()}_API_KEY") or "").strip().strip('"').strip("'")


def _models(name):
    return _env_list(f"{name.upper()}_MODEL") or list(PROVIDERS[name].default_models)


def configured_chain():
    """(provider, api_key, model) for every model of every keyed provider, in order."""
    chain = []
    for name in provider_order():
        key = _api_key(name)
        if not key:
            continue
        for model in _models(name):
            chain.append((PROVIDERS[name], key, model))
    return chain


def is_configured():
    return bool(configured_chain())


# ---------------------------------------------------------------------------
# Bench (rate-limit memory) and last outcomes, for skipping and for /ai/status
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_benched = {}   # (provider, model) -> (monotonic deadline, kind)
_outcomes = {}  # (provider, model) -> {"ok": bool, "kind": str, "at": iso8601}

# Bench lengths, in seconds, for failures that will not clear by themselves
# within a request or two.
_BENCH_ZERO_QUOTA = 900.0   # a model the plan allows 0 requests/minute
_BENCH_AUTH = 600.0         # rejected key: stop hammering until it is fixed
_BENCH_NOT_FOUND = 1800.0   # model id the provider does not serve
_BENCH_RATE_DEFAULT = 20.0  # rate-limited with no hint of how long to wait
_BENCH_RATE_MAX = 900.0


def _bench(provider, model, seconds, kind):
    if seconds <= 0:
        return
    with _lock:
        _benched[(provider, model)] = (time.monotonic() + seconds, kind)


def _bench_left(provider, model):
    with _lock:
        hit = _benched.get((provider, model))
        if not hit:
            return 0.0, None
        until, kind = hit
        left = until - time.monotonic()
        if left <= 0:
            _benched.pop((provider, model), None)
            return 0.0, None
        return left, kind


def _record(provider, model, ok, kind="ok"):
    with _lock:
        _outcomes[(provider, model)] = {
            "ok": ok,
            "kind": kind,
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }


def reset_state():
    """Forget benches and outcomes (tests, and nothing else)."""
    with _lock:
        _benched.clear()
        _outcomes.clear()


def status():
    """Which providers are configured and how each model last behaved. No secrets.

    Lists every known provider, so a key that is present but not enabled (an
    opt-in provider missing from AI_PROVIDERS) is visible rather than silently
    ignored.
    """
    order = provider_order()
    providers = []
    for name in list(order) + [n for n in PROVIDERS if n not in order]:
        provider = PROVIDERS[name]
        keyed = bool(_api_key(name))
        enabled = name in order
        models = []
        if keyed and enabled:
            for model in _models(name):
                left, kind = _bench_left(name, model)
                models.append({
                    "model": model,
                    "benched_for_seconds": round(left) if left else 0,
                    "bench_reason": kind,
                    "last": _outcomes.get((name, model)),
                })
        providers.append({
            "name": name,
            "label": provider.label,
            "enabled": enabled,
            "configured": keyed,
            "models": models,
        })
    return {"configured": is_configured(), "order": order, "providers": providers}


def _log(message):
    print(f"LLM: {message}", flush=True)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

_DURATION_PART = re.compile(r"([\d.]+)(ms|h|m|s)")
_TRY_AGAIN = re.compile(r"try again in\s+([0-9.hms]+)", re.IGNORECASE)
_RETRY_DELAY = re.compile(r'"retryDelay"\s*:\s*"([\d.]+)s"')


def _parse_duration(text):
    total = 0.0
    for number, unit in _DURATION_PART.findall(text or ""):
        try:
            value = float(number)
        except ValueError:
            continue
        total += {"ms": value / 1000.0, "h": value * 3600.0, "m": value * 60.0, "s": value}[unit]
    return total


def _retry_after(headers, body):
    """Seconds until the provider will accept another request, if it says."""
    raw = (headers or {}).get("retry-after")
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    match = _RETRY_DELAY.search(body or "")          # Gemini: RetryInfo.retryDelay
    if match:
        return float(match.group(1))
    match = _TRY_AGAIN.search(body or "")            # Groq/OpenAI: "try again in 1m26.4s"
    if match:
        seconds = _parse_duration(match.group(1))
        if seconds > 0:
            return seconds
    return None


def _error_message(body):
    """The human part of a provider's error body, whatever shape it came in."""
    try:
        data = json.loads(body)
    except (TypeError, ValueError):
        return (body or "").strip()[:300]
    if isinstance(data, list) and data:
        data = data[0]
    if isinstance(data, dict):
        err = data.get("error", data)
        if isinstance(err, dict):
            return str(err.get("message") or err.get("detail") or err)[:300]
        if isinstance(err, str):
            return err[:300]
        msg = data.get("message")
        if msg:
            return str(msg)[:300]
    return str(data)[:300]


def _classify(status, headers, body):
    message = _error_message(body)
    if status == 429:
        limit = (headers or {}).get("x-ratelimit-limit-req-minute")
        if limit is not None and limit.strip() == "0":
            # Not a busy minute: the plan does not include this model at all.
            return _Attempt("rate_limited", f"plan allows 0 requests/minute ({message})",
                            bench=_BENCH_ZERO_QUOTA)
        wait = _retry_after(headers, body)
        bench = min(_BENCH_RATE_MAX, wait if wait else _BENCH_RATE_DEFAULT)
        return _Attempt("rate_limited", message, bench=bench, retry_after=wait)
    if status == 413:
        # Groq answers 413 when one request alone exceeds the per-minute token
        # cap. A smaller request could still fit, so nothing is benched.
        return _Attempt("too_large", message)
    if status in (401, 403):
        return _Attempt("auth", f"HTTP {status}: {message}", bench=_BENCH_AUTH)
    if status == 404:
        return _Attempt("not_found", f"HTTP 404: {message}", bench=_BENCH_NOT_FOUND)
    if status == 400 and "json_validate_failed" in (body or ""):
        return _Attempt("bad_json", "provider rejected its own JSON output")
    if 400 <= status < 500:
        return _Attempt("bad_request", f"HTTP {status}: {message}")
    return _Attempt("server", f"HTTP {status}: {message}")


def _post(provider, key, payload, timeout, stream=False):
    try:
        resp = requests.post(
            f"{provider.base_url}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=timeout,
            stream=stream,
        )
    except requests.exceptions.Timeout:
        raise _Attempt("timeout", "no response in time")
    except requests.exceptions.RequestException as exc:
        raise _Attempt("network", type(exc).__name__)

    if resp.status_code == 200:
        return resp
    try:
        body = resp.text
    except Exception:
        body = ""
    finally:
        resp.close()
    raise _classify(resp.status_code, resp.headers, body)


def _payload(provider, model, messages, json_mode, max_tokens, temperature, stream):
    body = {"model": model, "messages": messages}
    if max_tokens:
        body[provider.max_tokens_field] = int(max_tokens)
    if temperature is not None and provider.accepts_temperature:
        body["temperature"] = temperature
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    if stream:
        body["stream"] = True
    body.update(_model_options(provider.name, model))
    return body


def _message_text(data):
    try:
        choice = (data.get("choices") or [])[0]
    except (AttributeError, IndexError):
        return "", None
    content = (choice.get("message") or {}).get("content")
    if isinstance(content, list):  # content parts, as some providers return them
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    return (content or ""), choice.get("finish_reason")


_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL)


def parse_json_object(text):
    """Parse a model's JSON object, tolerating a code fence or stray prose around it."""
    cleaned = (text or "").strip()
    fenced = _FENCE.match(cleaned)
    if fenced:
        cleaned = fenced.group(1)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError:
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise
        value = json.loads(cleaned[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError("expected a JSON object")
    return value


# ---------------------------------------------------------------------------
# The walk
# ---------------------------------------------------------------------------

@dataclass
class Completion:
    text: str
    provider: str
    model: str
    data: dict = None
    usage: dict = field(default_factory=dict)


# A rate limit this short is cheaper to wait out on the same model than to
# hand to a weaker one further down the chain.
_SHORT_WAIT = 4.0


_TOO_LARGE = re.compile(r"Limit\s+(\d+),\s*Requested\s+(\d+)", re.IGNORECASE)
# Below this, a JSON briefing or a set of replies would be cut off mid-answer.
_MIN_OUTPUT_BUDGET = 1024


def _shrunk_budget(failure, payload, provider):
    """A smaller output budget that fits a per-minute token cap, if one exists.

    Groq counts the requested output budget against its free tier's tokens-
    per-minute cap, and refuses (413) a request whose prompt plus budget is
    over it. When trimming the budget is enough to fit, that beats falling
    back to a weaker model; when the prompt alone is too big, it is not.
    """
    if failure.kind != "too_large":
        return None
    match = _TOO_LARGE.search(failure.detail or "")
    current = payload.get(provider.max_tokens_field)
    if not match or not current:
        return None
    limit, requested = int(match.group(1)), int(match.group(2))
    smaller = current - (requested - limit) - 64
    return smaller if smaller >= _MIN_OUTPUT_BUDGET else None


def _summarise(failures):
    if failures and all(kind == "rate_limited" for kind in failures):
        return LLMError.RATE_LIMITED
    return LLMError.UNAVAILABLE


def complete(messages, *, json_mode=False, max_tokens=1024, temperature=None, deadline=90.0):
    """The first usable answer from the configured chain.

    With `json_mode`, an answer only counts if it parses as a JSON object, and
    the parsed object is on `Completion.data`. Raises LLMError when the whole
    chain is exhausted, configured to nothing, or out of time.
    """
    chain = configured_chain()
    if not chain:
        raise LLMError(LLMError.NOT_CONFIGURED, "no provider API key is set")

    started = time.monotonic()
    failures, notes = [], []
    for provider, key, model in chain:
        left, why = _bench_left(provider.name, model)
        if left > 0:
            failures.append(why or "unavailable")
            notes.append(f"{provider.name}/{model} benched {round(left)}s ({why})")
            continue

        payload = _payload(provider, model, messages, json_mode, max_tokens, temperature, stream=False)
        for attempt in (1, 2):
            remaining = deadline - (time.monotonic() - started)
            if remaining < 3:
                failures.append("timeout")
                notes.append("out of time")
                raise LLMError(_summarise(failures), "; ".join(notes))
            try:
                resp = _post(provider, key, payload, timeout=(10, min(60.0, remaining)))
                try:
                    data = resp.json()
                except ValueError:
                    raise _Attempt("server", "response was not JSON")
                text, finish = _message_text(data)
                if not text.strip():
                    raise _Attempt("empty", f"no content (finish_reason={finish})")
                parsed = None
                if json_mode:
                    try:
                        parsed = parse_json_object(text)
                    except ValueError:
                        raise _Attempt("bad_json", f"unparseable JSON (finish_reason={finish})")
                _record(provider.name, model, True)
                return Completion(text=text, provider=provider.name, model=model,
                                  data=parsed, usage=data.get("usage") or {})
            except _Attempt as failure:
                smaller = _shrunk_budget(failure, payload, provider) if attempt == 1 else None
                if smaller:
                    payload = dict(payload, **{provider.max_tokens_field: smaller})
                    continue
                short = failure.retry_after is not None and failure.retry_after <= _SHORT_WAIT
                if failure.kind == "rate_limited" and short and attempt == 1 \
                        and deadline - (time.monotonic() - started) > failure.retry_after + 5:
                    time.sleep(failure.retry_after + 0.25)
                    continue
                _bench(provider.name, model, failure.bench, failure.kind)
                _record(provider.name, model, False, failure.kind)
                failures.append(failure.kind)
                notes.append(f"{provider.name}/{model} {failure.kind}: {failure.detail}")
                _log(f"{provider.name}/{model} failed ({failure.kind}): {failure.detail}")
                break

    raise LLMError(_summarise(failures), "; ".join(notes))


def _sse_deltas(resp):
    """Text deltas from an OpenAI-style server-sent-event stream."""
    for raw in resp.iter_lines(chunk_size=256):
        if not raw:
            continue
        line = raw.decode("utf-8", errors="replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            return
        try:
            chunk = json.loads(data)
        except ValueError:
            continue
        if isinstance(chunk, list):
            chunk = chunk[0] if chunk else {}
        if not isinstance(chunk, dict):
            continue
        if chunk.get("error"):
            raise _Attempt("server", _error_message(data))
        choices = chunk.get("choices") or []
        if not choices:
            continue
        delta = (choices[0].get("delta") or {}).get("content")
        if isinstance(delta, str) and delta:
            yield delta


def _relay(first, deltas, resp, label):
    try:
        yield first
        try:
            for delta in deltas:
                yield delta
        except _Attempt as failure:
            _log(f"{label} stream broke mid-answer ({failure.kind}): {failure.detail}")
            raise LLMError(LLMError.UNAVAILABLE, failure.detail)
        except requests.exceptions.RequestException as exc:
            _log(f"{label} stream broke mid-answer: {type(exc).__name__}")
            raise LLMError(LLMError.UNAVAILABLE, type(exc).__name__)
    finally:
        resp.close()


def open_stream(messages, *, max_tokens=1500, temperature=None, deadline=60.0):
    """Start a streamed answer, falling back across the chain until text flows.

    Fallback is only possible before the first token: once text has reached
    the user it cannot be taken back. So each candidate is primed until it
    yields its first piece of content, and only then committed to. This runs
    eagerly, so a caller can still answer with an error status instead of an
    HTTP 200 whose body is an apology. Returns an iterator of text deltas.
    """
    chain = configured_chain()
    if not chain:
        raise LLMError(LLMError.NOT_CONFIGURED, "no provider API key is set")

    started = time.monotonic()
    failures, notes = [], []
    for provider, key, model in chain:
        left, why = _bench_left(provider.name, model)
        if left > 0:
            failures.append(why or "unavailable")
            notes.append(f"{provider.name}/{model} benched {round(left)}s ({why})")
            continue
        remaining = deadline - (time.monotonic() - started)
        if remaining < 3:
            failures.append("timeout")
            break

        payload = _payload(provider, model, messages, False, max_tokens, temperature, stream=True)
        resp = None
        try:
            resp = _post(provider, key, payload, timeout=(10, min(60.0, remaining)), stream=True)
            deltas = _sse_deltas(resp)
            first = next(deltas, None)
            if first is None:
                raise _Attempt("empty", "stream ended without any text")
        except _Attempt as failure:
            if resp is not None:
                resp.close()
            _bench(provider.name, model, failure.bench, failure.kind)
            _record(provider.name, model, False, failure.kind)
            failures.append(failure.kind)
            notes.append(f"{provider.name}/{model} {failure.kind}: {failure.detail}")
            _log(f"{provider.name}/{model} stream failed ({failure.kind}): {failure.detail}")
            continue
        except requests.exceptions.RequestException as exc:
            if resp is not None:
                resp.close()
            _record(provider.name, model, False, "network")
            failures.append("network")
            notes.append(f"{provider.name}/{model} network: {type(exc).__name__}")
            _log(f"{provider.name}/{model} stream failed (network): {type(exc).__name__}")
            continue

        _record(provider.name, model, True)
        return _relay(first, deltas, resp, f"{provider.name}/{model}")

    raise LLMError(_summarise(failures), "; ".join(notes))
