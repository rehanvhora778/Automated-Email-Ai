"""First-party email verification codes.

Supabase can mail its own codes, but only if the project's email templates are
edited to include `{{ .Token }}` and its OTP length happens to match what the UI
renders. Both are dashboard settings the application cannot read or control, and
when either is wrong the failure is silent — the user gets a link they cannot
type, or a code too long for the boxes on screen.

So the code itself is issued and checked here instead, and delivered over the
deployment's own SMTP. Supabase stays the identity store: this module never
holds a password, and the account is still created and signed in through
Supabase once the code checks out.

What guards it:
  * codes are stored only as salted hashes, so the table is useless if read
  * ten-minute expiry, five verification attempts, then the code is dead
  * send quotas per address and per caller, so it cannot be used to mail-bomb
  * verification is constant-time, so timing cannot leak a partial match
"""
import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.db.supabase import supabase
from app.services import mailer, password_policy

router = APIRouter()

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
# Sends allowed per address per hour, across both purposes.
MAX_SENDS_PER_HOUR = 5
# The per-address quota does nothing about a script working through a list of
# addresses: every one of them stays under its own limit while the deployment's
# daily sending allowance is spent and real codes stop arriving. So the caller
# is capped too — generously, since an office or a campus shares one address.
MAX_SENDS_PER_IP_PER_HOUR = 20
# Held in memory, which means per worker process and emptied by every restart
# or deploy. That is the deliberate trade: a counter that survived either one
# would mean Redis or another table for something whose whole job is to blunt
# the easy abuse, and the per-address quota still backs it up.
_ip_requests: dict[str, list[float]] = {}
# Hourly expiry is not a bound when the key comes from a header the caller
# writes: a script rotating X-Forwarded-For adds a row per request and the
# worker runs out of memory long before the hour is up. Far above the number of
# real callers an hour brings here, and the quietest are the ones evicted.
MAX_TRACKED_CALLERS = 5000

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_KEY", "")

# Hashes are salted with a server-side secret so the table alone cannot be
# brute-forced — a six-digit space is only a million entries. Falls back to the
# service key, which is already a deployment secret, when nothing is set.
_PEPPER = os.getenv("OTP_PEPPER", "") or SERVICE_KEY or "dev-only-pepper"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _hash_code(email: str, purpose: str, code: str) -> str:
    """Bind the hash to the address and purpose so a code cannot be replayed."""
    payload = f"{email.lower()}|{purpose}|{code}".encode()
    return hmac.new(_PEPPER.encode(), payload, hashlib.sha256).hexdigest()


def _admin_headers() -> dict:
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def _password_is_current(email: str, password: str) -> bool:
    """True when `password` is already this account's password.

    Supabase never exposes the stored hash, so the only honest way to ask is to
    try signing in with the candidate. A success means the user has typed the
    password they already have, which a reset should refuse rather than
    silently accept as a change.

    A failure here is not proof of anything else — the account could be locked
    or the API down — so callers treat False as "carry on", never as a verdict.
    """
    try:
        resp = requests.post(
            f"{SUPABASE_URL}/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": SERVICE_KEY, "Content-Type": "application/json"},
            json={"email": email, "password": password},
            timeout=20,
        )
    except requests.exceptions.RequestException as e:
        print(f"otp: same-password check could not run: {e}")
        return False
    return resp.status_code == 200


def _find_user(email: str) -> dict | None:
    """Look an account up by address, or None. Raises on an unreachable API."""
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_admin_headers(),
            params={"per_page": 200},
            timeout=20,
        )
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Could not reach Supabase. Try again shortly.")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not read the account list.")

    wanted = email.lower()
    for user in (resp.json() or {}).get("users", []):
        if (user.get("email") or "").lower() == wanted:
            return user
    return None


def _client_ip(request: Request) -> str:
    """The caller's address, as well as it can be known from behind a proxy.

    Render terminates TLS in front of the app, so request.client is its proxy
    and the real caller is the first entry of X-Forwarded-For. Nothing stops a
    caller setting that header themselves, so this is a speed bump rather than
    an identity — which is all a throttle needs to be.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    # Cut to the longest an address can actually be. What arrives becomes a
    # dictionary key kept for an hour, and its length is the caller's choice.
    first = forwarded.split(",")[0].strip()[:45]
    if first:
        return first
    return request.client.host if request.client else "unknown"


def _ip_quota_ok(ip: str) -> bool:
    """Count one request from `ip`, and say whether it stayed under the cap.

    Attempts are counted rather than sends, so an address that turns out not to
    exist is not a free retry — enumeration is the shape of abuse this is here
    to slow down, and it looks exactly like a run of requests that send nothing.
    """
    cutoff = time.time() - 3600
    # Callers that have gone quiet would otherwise sit in the dict forever.
    for stale in [key for key, seen in _ip_requests.items() if not seen or seen[-1] <= cutoff]:
        del _ip_requests[stale]

    if len(_ip_requests) > MAX_TRACKED_CALLERS:
        # A batch rather than a single row, so a flood of fresh keys pays for
        # this sort once every few hundred requests instead of on every one.
        by_last_seen = sorted(_ip_requests, key=lambda caller: _ip_requests[caller][-1])
        for stale in by_last_seen[: len(_ip_requests) // 10 + 1]:
            del _ip_requests[stale]

    recent = [seen for seen in _ip_requests.get(ip, []) if seen > cutoff]
    _ip_requests[ip] = recent
    if len(recent) >= MAX_SENDS_PER_IP_PER_HOUR:
        return False
    recent.append(time.time())
    return True


# --------------------------------------------------------------------------
# request a code
# --------------------------------------------------------------------------
class OtpRequest(BaseModel):
    email: str
    purpose: str = Field(pattern="^(signup|recovery)$")


@router.post("/request")
def request_code(payload: OtpRequest, request: Request):
    email = (payload.email or "").strip().lower()
    if not mailer.looks_like_email(email):
        raise HTTPException(status_code=400, detail="That does not look like an email address.")

    # Anyone at all can reach this and name the address the server mails, so
    # the caller is checked before the account lookup and well before any mail.
    if not _ip_quota_ok(_client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail="Too many codes requested from here. Try again later.",
        )

    # mailer is the only thing that knows which of its transports this
    # deployment is on, so it is the only thing that can say what is missing;
    # advice written here would be guessing, and on a host that blocks outbound
    # SMTP the obvious guess is the one that cannot work.
    problem = mailer.configuration_problem()
    if problem:
        raise HTTPException(status_code=500, detail=problem)

    existing = _find_user(email)

    # Signup is the one case where saying "already registered" is right: the
    # person is trying to create that account and needs to know to sign in
    # instead. Recovery stays silent, so it cannot be used to test addresses.
    if payload.purpose == "signup" and existing:
        raise HTTPException(
            status_code=409,
            detail="An account with that email already exists. Sign in instead.",
        )

    # Throttle before doing any work, and count both purposes together so
    # alternating between them cannot double the quota.
    since = (_now() - timedelta(hours=1)).isoformat()
    try:
        recent = (
            supabase.from_("email_otps")
            .select("id", count="exact")
            .eq("email", email)
            .gte("created_at", since)
            .execute()
        )
        sent_recently = recent.count or 0
    except Exception as e:
        print(f"otp: quota check failed: {e}")
        sent_recently = 0

    if sent_recently >= MAX_SENDS_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="Too many codes requested for this address. Try again in an hour.",
        )

    # Recovery for an unknown address: return success without sending, so the
    # response is identical either way.
    if payload.purpose == "recovery" and not existing:
        return {"sent": True}

    code = f"{secrets.randbelow(10 ** CODE_LENGTH):0{CODE_LENGTH}d}"

    try:
        # Retire any codes still outstanding for this address and purpose, so
        # the newest email is the only one that works.
        supabase.from_("email_otps").update({"consumed_at": _now().isoformat()}) \
            .eq("email", email).eq("purpose", payload.purpose).is_("consumed_at", "null").execute()

        supabase.from_("email_otps").insert({
            "email": email,
            "purpose": payload.purpose,
            "code_hash": _hash_code(email, payload.purpose, code),
            "expires_at": (_now() + timedelta(minutes=CODE_TTL_MINUTES)).isoformat(),
        }).execute()
    except Exception as e:
        print(f"otp: could not store code: {e}")
        raise HTTPException(status_code=500, detail="Could not start verification. Try again.")

    try:
        mailer.send_otp(email, code, payload.purpose)
    except mailer.MailerNotConfigured as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        print(f"otp: send failed: {type(e).__name__}: {e}")
        # Say what the mail server actually objected to. A generic failure here
        # leaves no way to tell a wrong app password from a blocked port.
        raise HTTPException(
            status_code=502,
            detail=f"The verification email could not be sent — {type(e).__name__}: {e}",
        )

    try:
        supabase.rpc("purge_expired_email_otps", {}).execute()
    except Exception:
        pass  # housekeeping only

    return {"sent": True}


# --------------------------------------------------------------------------
# consume a code
# --------------------------------------------------------------------------
def _consume(email: str, purpose: str, code: str) -> None:
    """Validate and burn a code, or raise the reason it failed."""
    try:
        res = (
            supabase.from_("email_otps")
            .select("*")
            .eq("email", email)
            .eq("purpose", purpose)
            .is_("consumed_at", "null")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as e:
        print(f"otp: lookup failed: {e}")
        raise HTTPException(status_code=500, detail="Could not verify the code. Try again.")

    row = res.data[0] if res.data else None
    if not row:
        raise HTTPException(status_code=400, detail="No code is pending for this address. Request a new one.")

    if datetime.fromisoformat(row["expires_at"].replace("Z", "+00:00")) < _now():
        raise HTTPException(status_code=400, detail="That code has expired — request a new one.")

    if (row.get("attempts") or 0) >= MAX_ATTEMPTS:
        raise HTTPException(status_code=429, detail="Too many incorrect attempts. Request a new code.")

    if not hmac.compare_digest(row["code_hash"], _hash_code(email, purpose, code)):
        try:
            supabase.from_("email_otps").update({"attempts": (row.get("attempts") or 0) + 1}) \
                .eq("id", row["id"]).execute()
        except Exception as e:
            print(f"otp: could not record attempt: {e}")
        raise HTTPException(status_code=400, detail="That code is not right. Check it and try again.")

    try:
        supabase.from_("email_otps").update({"consumed_at": _now().isoformat()}) \
            .eq("id", row["id"]).execute()
    except Exception as e:
        print(f"otp: could not consume code: {e}")


class VerifySignup(BaseModel):
    email: str
    code: str
    password: str
    full_name: str | None = None


@router.post("/verify-signup")
def verify_signup(payload: VerifySignup):
    """Confirm the code, then create the account through Supabase.

    The password arrives with this call rather than being held from the earlier
    request, so a pending signup never parks a plaintext password anywhere.
    """
    email = (payload.email or "").strip().lower()
    problem = password_policy.describe_failure(payload.password or "")
    if problem:
        # Checked before the code is spent, so a weak password does not cost
        # the user their one-shot code.
        raise HTTPException(status_code=400, detail=problem)

    _consume(email, "signup", (payload.code or "").strip())

    # Re-check between the code being issued and used — the address could have
    # been registered by someone else in that window.
    if _find_user(email):
        raise HTTPException(status_code=409, detail="An account with that email already exists. Sign in instead.")

    try:
        resp = requests.post(
            f"{SUPABASE_URL}/auth/v1/admin/users",
            headers=_admin_headers(),
            json={
                "email": email,
                "password": payload.password,
                # Confirmed because the code just proved the address. This is
                # the only route that sets it, and only after _consume passed.
                "email_confirm": True,
                "user_metadata": {"full_name": (payload.full_name or "").strip() or email.split("@")[0]},
            },
            timeout=25,
        )
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Could not reach Supabase. Try again shortly.")

    if resp.status_code not in (200, 201):
        detail = ""
        try:
            body = resp.json()
            detail = body.get("msg") or body.get("message") or body.get("error_description") or ""
        except Exception:
            pass
        print(f"otp: user creation failed {resp.status_code}: {detail}")
        raise HTTPException(status_code=400, detail=detail or "Could not create the account.")

    return {"created": True, "email": email}


class VerifyRecovery(BaseModel):
    email: str
    code: str
    password: str


@router.post("/verify-recovery")
def verify_recovery(payload: VerifyRecovery):
    """Confirm the code, then set the new password."""
    email = (payload.email or "").strip().lower()

    # Nothing is said about the password until the code has been proved. Asked
    # the other way round, "that is already your current password" answers a
    # caller holding no code at all, which turns an unauthenticated form into a
    # place to test password guesses against somebody else's account.
    _consume(email, "recovery", (payload.code or "").strip())

    problem = password_policy.describe_failure(payload.password or "")
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    # A reset that sets the password back to what it already was is not a
    # reset, and reporting success would be a lie.
    if _password_is_current(email, payload.password):
        raise HTTPException(
            status_code=400,
            detail="That is already your current password. Choose a different one.",
        )

    user = _find_user(email)
    if not user:
        # Only reachable if the account vanished after the code was issued.
        raise HTTPException(status_code=400, detail="That account no longer exists.")

    try:
        resp = requests.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user['id']}",
            headers=_admin_headers(),
            json={"password": payload.password},
            timeout=25,
        )
    except requests.exceptions.RequestException:
        raise HTTPException(status_code=503, detail="Could not reach Supabase. Try again shortly.")

    if resp.status_code != 200:
        detail = ""
        try:
            body = resp.json()
            detail = body.get("msg") or body.get("message") or ""
        except Exception:
            pass
        print(f"otp: password update failed {resp.status_code}: {detail}")
        raise HTTPException(status_code=400, detail=detail or "Could not update the password.")

    return {"updated": True, "email": email}


@router.get("/health")
def health(check: bool = False):
    """Whether this deployment can send mail, without revealing config.

    `?check=true` also opens a real connection and authenticates, reporting what
    the mail server said. Nothing is sent and no credential is echoed back.
    """
    provider = mailer.active_provider()
    result = {
        "email_configured": mailer.is_configured(),
        "provider": provider,
        "mail_from": mailer.MAIL_FROM or None,
    }

    # Only the settings that actually apply. Reporting SMTP host and port while
    # sending over an HTTP API invites exactly the wrong conclusion about where
    # a failure is coming from.
    if provider == "smtp":
        result["smtp_host"] = mailer.SMTP_HOST or None
        result["smtp_port"] = mailer.SMTP_PORT
        result["starttls"] = mailer.SMTP_STARTTLS

    if check:
        ok, detail = mailer.check_connection()
        result["connection_ok"] = ok
        result["detail"] = detail
        if provider == "gmail_api":
            sender = mailer.gmail_sender()
            result["mail_from"] = (sender or {}).get("address") or result.get("mail_from")
            # Whether this address was chosen or merely the one that turned up.
            result["sender_pinned"] = bool(mailer.MAIL_GMAIL_PROFILE_ID)

    return result
