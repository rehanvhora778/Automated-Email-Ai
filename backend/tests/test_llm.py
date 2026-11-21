"""The provider chain behind every AI feature, exercised without the network.

What these pin down is the behaviour the old single-provider client lacked: a
rate-limited or broken provider hands the request to the next one instead of
failing the feature, a model the plan cannot use stops being asked, and when
everything is exhausted the caller learns *why* in words a person can act on.

Run from the backend directory:
    .venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests  # noqa: E402
from requests.structures import CaseInsensitiveDict  # noqa: E402

from app.services import llm  # noqa: E402

ENV_NAMES = ["AI_PROVIDERS"] + [
    f"{name.upper()}_{suffix}" for name in llm.PROVIDERS for suffix in ("API_KEY", "MODEL")
]


class FakeResponse:
    def __init__(self, status=200, payload=None, text=None, headers=None, lines=None):
        self.status_code = status
        self._payload = payload
        self._text = text
        self.headers = CaseInsensitiveDict(headers or {})
        self._lines = lines or []
        self.closed = False

    @property
    def text(self):
        if self._text is not None:
            return self._text
        return json.dumps(self._payload)

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload

    def iter_lines(self, chunk_size=None):
        for line in self._lines:
            if isinstance(line, Exception):
                raise line
            yield line.encode("utf-8") if isinstance(line, str) else line

    def close(self):
        self.closed = True


def ok(content, finish="stop"):
    return FakeResponse(200, {
        "choices": [{"message": {"role": "assistant", "content": content}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5},
    })


def sse(*deltas, done=True):
    lines = ['data: {"choices":[{"index":0,"delta":{"role":"assistant"}}]}', ""]
    for d in deltas:
        lines.append("data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": d}}]}))
        lines.append("")
    if done:
        lines.append("data: [DONE]")
    return FakeResponse(200, lines=lines)


class ChainTestCase(unittest.TestCase):
    """Isolates env and module state, and routes requests.post to a script."""

    def setUp(self):
        saved = {name: os.environ.get(name) for name in ENV_NAMES}

        def restore():
            for name, value in saved.items():
                if value is None:
                    os.environ.pop(name, None)
                else:
                    os.environ[name] = value
        self.addCleanup(restore)
        for name in ENV_NAMES:
            os.environ.pop(name, None)

        llm.reset_state()
        self.addCleanup(llm.reset_state)

        self.calls = []
        self.script = {}  # model -> list of responses/exceptions, consumed in order
        patcher = mock.patch.object(llm.requests, "post", side_effect=self._post)
        patcher.start()
        self.addCleanup(patcher.stop)
        sleeper = mock.patch.object(llm.time, "sleep")
        self.sleep = sleeper.start()
        self.addCleanup(sleeper.stop)

    def env(self, **values):
        for name, value in values.items():
            os.environ[name] = value

    def _post(self, url, json=None, headers=None, timeout=None, stream=False):
        self.calls.append({"url": url, "json": json, "headers": headers, "stream": stream})
        queue = self.script.get(json["model"])
        if not queue:
            raise AssertionError(f"unexpected request to model {json['model']}")
        result = queue.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    def models_called(self):
        return [c["json"]["model"] for c in self.calls]


class ConfigurationTest(ChainTestCase):
    def test_nothing_configured_fails_fast_and_says_so(self):
        with self.assertRaises(llm.LLMError) as ctx:
            llm.complete([{"role": "user", "content": "hi"}])
        self.assertEqual(ctx.exception.kind, llm.LLMError.NOT_CONFIGURED)
        self.assertIn("GROQ_API_KEY", ctx.exception.user_message)
        self.assertEqual(self.calls, [])

    def test_default_chain_leaves_out_providers_that_may_train_on_content(self):
        # A key alone must not send Gmail content to a free tier that may
        # train on it; Gemini and Mistral have to be named in AI_PROVIDERS.
        self.env(GROQ_API_KEY="gsk_test", MISTRAL_API_KEY="m_test", GEMINI_API_KEY="g_test")
        chain = [(p.name, m) for p, _, m in llm.configured_chain()]
        self.assertEqual(chain, [
            ("groq", "openai/gpt-oss-120b"),
            ("groq", "openai/gpt-oss-20b"),
        ])

    def test_opt_in_providers_join_when_listed(self):
        self.env(GROQ_API_KEY="gsk_test", MISTRAL_API_KEY="m_test", AI_PROVIDERS="groq,mistral")
        chain = [(p.name, m) for p, _, m in llm.configured_chain()]
        self.assertEqual(chain[-1], ("mistral", "open-mistral-nemo"))

    def test_only_an_opt_in_key_means_not_configured(self):
        self.env(MISTRAL_API_KEY="m_test")
        with self.assertRaises(llm.LLMError) as ctx:
            llm.complete([{"role": "user", "content": "hi"}])
        self.assertEqual(ctx.exception.kind, llm.LLMError.NOT_CONFIGURED)
        mistral = next(p for p in llm.status()["providers"] if p["name"] == "mistral")
        self.assertEqual((mistral["configured"], mistral["enabled"]), (True, False))

    def test_order_and_models_come_from_the_environment(self):
        self.env(GROQ_API_KEY="g", MISTRAL_API_KEY="m", AI_PROVIDERS="mistral, nonsense, groq",
                 MISTRAL_MODEL="mistral-medium-latest", GROQ_MODEL="openai/gpt-oss-20b")
        chain = [(p.name, m) for p, _, m in llm.configured_chain()]
        self.assertEqual(chain, [("mistral", "mistral-medium-latest"), ("groq", "openai/gpt-oss-20b")])

    def test_status_reports_configuration_without_leaking_keys(self):
        self.env(GROQ_API_KEY="gsk_super_secret_value")
        report = llm.status()
        self.assertTrue(report["configured"])
        self.assertNotIn("gsk_super_secret_value", json.dumps(report))
        groq = next(p for p in report["providers"] if p["name"] == "groq")
        self.assertTrue(groq["configured"])
        mistral = next(p for p in report["providers"] if p["name"] == "mistral")
        self.assertFalse(mistral["configured"])


class CompleteTest(ChainTestCase):
    def test_first_provider_answers_with_the_expected_request(self):
        self.env(GROQ_API_KEY="gsk_test")
        self.script["openai/gpt-oss-120b"] = [ok('{"status": "ready", "content": "Hi"}')]

        result = llm.complete([{"role": "user", "content": "Return JSON"}], json_mode=True,
                              max_tokens=500, temperature=0.3)

        self.assertEqual(result.data, {"status": "ready", "content": "Hi"})
        self.assertEqual((result.provider, result.model), ("groq", "openai/gpt-oss-120b"))
        call = self.calls[0]
        self.assertEqual(call["url"], "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(call["headers"]["Authorization"], "Bearer gsk_test")
        body = call["json"]
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertEqual(body["max_completion_tokens"], 500)
        self.assertEqual(body["temperature"], 0.3)
        self.assertEqual(body["reasoning_effort"], "low")
        self.assertNotIn("stream", body)

    def test_rate_limit_falls_through_and_benches_the_model(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [FakeResponse(429, {"error": {"message": "slow down"}},
                                                           headers={"retry-after": "30"})]
        self.script["openai/gpt-oss-20b"] = [ok("first"), ok("second")]

        self.assertEqual(llm.complete([{"role": "user", "content": "x"}]).text, "first")
        # The benched model is skipped outright: no second round trip to be refused.
        self.assertEqual(llm.complete([{"role": "user", "content": "x"}]).text, "second")
        self.assertEqual(self.models_called(),
                         ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "openai/gpt-oss-20b"])
        self.sleep.assert_not_called()

    def test_a_short_rate_limit_is_waited_out_on_the_same_model(self):
        self.env(GROQ_API_KEY="g", GROQ_MODEL="openai/gpt-oss-120b")
        self.script["openai/gpt-oss-120b"] = [
            FakeResponse(429, {"error": {"message": "Please try again in 1.5s."}}),
            ok("after the wait"),
        ]
        self.assertEqual(llm.complete([{"role": "user", "content": "x"}]).text, "after the wait")
        self.sleep.assert_called_once()
        self.assertGreaterEqual(self.sleep.call_args[0][0], 1.5)

    def test_a_model_the_plan_does_not_include_is_benched_for_long(self):
        self.env(MISTRAL_API_KEY="m", MISTRAL_MODEL="mistral-medium-latest,open-mistral-nemo",
                 AI_PROVIDERS="mistral")
        self.script["mistral-medium-latest"] = [FakeResponse(
            429, {"message": "Rate limit exceeded"}, headers={"x-ratelimit-limit-req-minute": "0"})]
        self.script["open-mistral-nemo"] = [ok("nemo answered")]

        self.assertEqual(llm.complete([{"role": "user", "content": "x"}]).text, "nemo answered")
        left, kind = llm._bench_left("mistral", "mistral-medium-latest")
        self.assertGreater(left, 600)
        self.assertEqual(kind, "rate_limited")

    def test_everything_rate_limited_is_reported_as_a_rate_limit(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [FakeResponse(429, {"error": {"message": "rpm"}},
                                                           headers={"retry-after": "60"})]
        self.script["openai/gpt-oss-20b"] = [FakeResponse(429, {"error": {"message": "rpm"}},
                                                          headers={"retry-after": "60"})]
        with self.assertRaises(llm.LLMError) as ctx:
            llm.complete([{"role": "user", "content": "x"}])
        self.assertEqual(ctx.exception.kind, llm.LLMError.RATE_LIMITED)
        self.assertIn("limit", ctx.exception.user_message)

        # Both are benched now, so the next request fails fast without the network.
        with self.assertRaises(llm.LLMError) as again:
            llm.complete([{"role": "user", "content": "x"}])
        self.assertEqual(again.exception.kind, llm.LLMError.RATE_LIMITED)
        self.assertEqual(len(self.calls), 2)

    def test_mixed_failures_are_reported_as_unavailable(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [FakeResponse(500, {"error": {"message": "boom"}})]
        self.script["openai/gpt-oss-20b"] = [requests.exceptions.ReadTimeout()]
        with self.assertRaises(llm.LLMError) as ctx:
            llm.complete([{"role": "user", "content": "x"}])
        self.assertEqual(ctx.exception.kind, llm.LLMError.UNAVAILABLE)
        self.assertIn("server", ctx.exception.detail)
        self.assertIn("timeout", ctx.exception.detail)

    def test_unparseable_json_moves_on_to_the_next_model(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [ok("Sure! Here is your email: Dear team...")]
        self.script["openai/gpt-oss-20b"] = [ok('{"status": "ready"}')]
        result = llm.complete([{"role": "user", "content": "JSON please"}], json_mode=True)
        self.assertEqual(result.data, {"status": "ready"})
        self.assertEqual(result.model, "openai/gpt-oss-20b")

    def test_json_wrapped_in_a_code_fence_still_parses(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [ok('```json\n{"a": 1}\n```')]
        self.assertEqual(llm.complete([{"role": "user", "content": "x"}], json_mode=True).data, {"a": 1})

    def test_empty_content_is_not_an_answer(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [ok("", finish="length")]
        self.script["openai/gpt-oss-20b"] = [ok("real text")]
        self.assertEqual(llm.complete([{"role": "user", "content": "x"}]).text, "real text")

    def test_a_rejected_key_benches_the_model(self):
        self.env(GROQ_API_KEY="bad", MISTRAL_API_KEY="m", AI_PROVIDERS="groq,mistral")
        self.script["openai/gpt-oss-120b"] = [FakeResponse(401, {"error": {"message": "Invalid API Key"}})]
        self.script["openai/gpt-oss-20b"] = [FakeResponse(401, {"error": {"message": "Invalid API Key"}})]
        self.script["open-mistral-nemo"] = [ok("backup")]
        self.assertEqual(llm.complete([{"role": "user", "content": "x"}]).text, "backup")
        self.assertGreater(llm._bench_left("groq", "openai/gpt-oss-120b")[0], 0)

    def test_a_request_too_large_for_one_model_is_not_benched(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [
            FakeResponse(413, {"error": {"message": "Request too large ... Limit 8000, Requested 9100"}}),
            ok("small one fits"),
        ]
        self.script["openai/gpt-oss-20b"] = [ok("fallback")]
        self.assertEqual(llm.complete([{"role": "user", "content": "big"}]).text, "fallback")
        self.assertEqual(llm._bench_left("groq", "openai/gpt-oss-120b"), (0.0, None))
        self.assertEqual(llm.complete([{"role": "user", "content": "small"}]).text, "small one fits")

    def test_a_request_over_the_token_cap_retries_with_a_smaller_budget(self):
        self.env(GROQ_API_KEY="g", GROQ_MODEL="openai/gpt-oss-120b")
        self.script["openai/gpt-oss-120b"] = [
            FakeResponse(413, {"error": {"message": "Request too large ... Limit 8000, Requested 9500"}}),
            ok("fits now"),
        ]
        result = llm.complete([{"role": "user", "content": "big"}], max_tokens=3500)
        self.assertEqual(result.text, "fits now")
        self.assertEqual(self.calls[1]["json"]["max_completion_tokens"], 3500 - 1500 - 64)

    def test_openai_is_left_on_its_default_temperature(self):
        self.env(OPENAI_API_KEY="sk", OPENAI_MODEL="gpt-4o-mini")
        self.script["gpt-4o-mini"] = [ok("hi")]
        llm.complete([{"role": "user", "content": "x"}], max_tokens=100, temperature=0.2)
        body = self.calls[0]["json"]
        self.assertNotIn("temperature", body)
        self.assertEqual(body["max_completion_tokens"], 100)
        self.assertNotIn("reasoning_effort", body)

    def test_mistral_uses_max_tokens(self):
        self.env(MISTRAL_API_KEY="m", AI_PROVIDERS="mistral")
        self.script["open-mistral-nemo"] = [ok("hi")]
        llm.complete([{"role": "user", "content": "x"}], max_tokens=100)
        body = self.calls[0]["json"]
        self.assertEqual(self.calls[0]["url"], "https://api.mistral.ai/v1/chat/completions")
        self.assertEqual(body["max_tokens"], 100)
        self.assertNotIn("max_completion_tokens", body)


class RetryAfterTest(unittest.TestCase):
    def test_header_wins(self):
        self.assertEqual(llm._retry_after({"retry-after": "12"}, ""), 12.0)

    def test_gemini_retry_delay(self):
        body = '[{"error": {"code": 429, "details": [{"retryDelay": "37s"}]}}]'
        self.assertEqual(llm._retry_after({}, body), 37.0)

    def test_groq_minutes_and_seconds(self):
        body = '{"error": {"message": "... Please try again in 1m26.4s. Visit ..."}}'
        self.assertAlmostEqual(llm._retry_after({}, body), 86.4)

    def test_groq_milliseconds(self):
        body = '{"error": {"message": "Please try again in 860ms."}}'
        self.assertAlmostEqual(llm._retry_after({}, body), 0.86)

    def test_no_hint(self):
        self.assertIsNone(llm._retry_after({}, '{"error": {"message": "nope"}}'))


class StreamTest(ChainTestCase):
    def test_streams_text_from_the_first_working_model(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [FakeResponse(429, {"error": {"message": "busy"}},
                                                           headers={"retry-after": "30"})]
        self.script["openai/gpt-oss-20b"] = [sse("Hel", "lo ", "world")]
        stream = llm.open_stream([{"role": "user", "content": "x"}])
        self.assertEqual("".join(stream), "Hello world")
        self.assertTrue(self.calls[1]["stream"])
        self.assertTrue(self.calls[1]["json"]["stream"])

    def test_failure_is_raised_before_any_text_is_promised(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [FakeResponse(503, {"error": {"message": "down"}})]
        self.script["openai/gpt-oss-20b"] = [requests.exceptions.ConnectionError()]
        with self.assertRaises(llm.LLMError) as ctx:
            llm.open_stream([{"role": "user", "content": "x"}])
        self.assertEqual(ctx.exception.kind, llm.LLMError.UNAVAILABLE)

    def test_a_stream_that_ends_without_text_falls_through(self):
        self.env(GROQ_API_KEY="g")
        self.script["openai/gpt-oss-120b"] = [sse()]
        self.script["openai/gpt-oss-20b"] = [sse("ok")]
        self.assertEqual("".join(llm.open_stream([{"role": "user", "content": "x"}])), "ok")

    def test_non_ascii_text_survives(self):
        self.env(GROQ_API_KEY="g", GROQ_MODEL="openai/gpt-oss-120b")
        self.script["openai/gpt-oss-120b"] = [sse("नमस्ते", " — ", "café")]
        self.assertEqual("".join(llm.open_stream([{"role": "user", "content": "x"}])), "नमस्ते — café")

    def test_a_break_after_the_first_token_raises_llm_error(self):
        self.env(GROQ_API_KEY="g", GROQ_MODEL="openai/gpt-oss-120b")
        broken = FakeResponse(200, lines=[
            "data: " + json.dumps({"choices": [{"delta": {"content": "partial"}}]}),
            "data: " + json.dumps({"error": {"message": "upstream reset"}}),
        ])
        self.script["openai/gpt-oss-120b"] = [broken]
        stream = llm.open_stream([{"role": "user", "content": "x"}])
        self.assertEqual(next(stream), "partial")
        with self.assertRaises(llm.LLMError):
            next(stream)
        self.assertTrue(broken.closed)


if __name__ == "__main__":
    unittest.main()
