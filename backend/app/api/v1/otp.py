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
  * a per-address send quota, so the endpoint cannot be used to mail-bomb
  * verification is constant-time, so timing cannot leak a partial match
"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.db.supabase import supabase
from app.services import mailer

router = APIRouter()

CODE_LENGTH = 6
CODE_TTL_MINUTES = 10
MAX_ATTEMPTS = 5
# Sends allowed per address per hour, across both purposes.
MAX_SENDS_PER_HOUR = 5
MIN_PASSWORD = 6

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


# --------------------------------------------------------------------------
# request a code
# --------------------------------------------------------------------------
class OtpRequest(BaseModel):
    email: str
    purpose: str = Field(pattern="^(signup|recovery)$")


@router.post("/request")
async def request_code(payload: OtpRequest):
    email = (payload.email or "").strip().lower()
    if not mailer.looks_like_email(email):
        raise HTTPException(status_code=400, detail="That does not look like an email address.")

    if not mailer.is_configured():
        raise HTTPException(
            status_code=500,
            detail=(
                "Email sending is not configured on the server. Set SMTP_HOST, SMTP_USER, "
                "SMTP_PASSWORD and SMTP_FROM, then redeploy."
            ),
        )

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
async def verify_signup(payload: VerifySignup):
    """Confirm the code, then create the account through Supabase.

    The password arrives with this call rather than being held from the earlier
    request, so a pending signup never parks a plaintext password anywhere.
    """
    email = (payload.email or "").strip().lower()
    if len(payload.password or "") < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD} characters.")

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
async def verify_recovery(payload: VerifyRecovery):
    """Confirm the code, then set the new password."""
    email = (payload.email or "").strip().lower()
    if len(payload.password or "") < MIN_PASSWORD:
        raise HTTPException(status_code=400, detail=f"Password must be at least {MIN_PASSWORD} characters.")

    _consume(email, "recovery", (payload.code or "").strip())

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
async def health(check: bool = False):
    """Whether this deployment can send mail, without revealing config.

    `?check=true` also opens a real connection and authenticates, reporting what
    the mail server said. Nothing is sent and no credential is echoed back.
    """
    result = {
        "smtp_configured": mailer.is_configured(),
        "smtp_host": mailer.SMTP_HOST or None,
        "smtp_port": mailer.SMTP_PORT,
        "starttls": mailer.SMTP_STARTTLS,
        # Enough to spot a typo without disclosing the address in full.
        "smtp_user_domain": (mailer.SMTP_USER.split("@")[-1] if "@" in mailer.SMTP_USER else None),
    }
    if check:
        ok, detail = mailer.check_connection()
        result["connection_ok"] = ok
        result["detail"] = detail
    return result
