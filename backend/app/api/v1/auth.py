"""Authentication — Google (Gmail) sign-in, plus email/password.

Two ways in:

* **Google** (recommended) — the browser calls Supabase's Google provider and
  Supabase issues the session. The sign-in requests Gmail scopes alongside the
  identity scopes, so one consent covers both and Gmail ends up linked with no
  second approval screen.
* **Email + password** — handled entirely client-side by Supabase, which emails
  a one-time code and confirms the address via `verifyOtp`. There is no backend
  signup endpoint on purpose: one that created pre-confirmed accounts through
  the admin API would be an open route around the verification everyone else
  goes through. Gmail stays unlinked on this path until the user runs the
  "Link Gmail" flow, since no Google consent has happened.

The Google path needs backend help Supabase cannot provide. Google returns a
token good for the Gmail API too, and Supabase exposes it on the session as
`provider_token` / `provider_refresh_token` — but only once, immediately after
sign-in, and it never persists them. So the frontend posts them here and we
store them on the profile in the same shape the original "Link Gmail" flow
produced, which keeps gmail_service and every existing caller working.

The separate /actions/login-google flow remains the fallback for re-linking
when a token is revoked, missing, or the account signed up with a password.
"""
import os

import requests
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

from app.db.supabase import supabase

load_dotenv()

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_KEY = os.getenv("SUPABASE_KEY")  # service_role key


class GoogleTokenPayload(BaseModel):
    """Provider tokens lifted off the Supabase session after Google sign-in."""
    provider_token: str | None = None
    provider_refresh_token: str | None = None
    expires_in: int | None = None
    scope: str | None = None


def _user_id_from_bearer(authorization: str | None) -> str:
    """Resolve the caller's user id from their Supabase access token.

    The user id is deliberately NOT taken from the request body. This endpoint
    writes Gmail credentials onto a profile row, so trusting a client-supplied
    id would let anyone attach their own Google tokens to somebody else's
    account. Asking Supabase who the token belongs to is the only safe source.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()

    if not SUPABASE_URL or not SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"apikey": SERVICE_KEY, "Authorization": f"Bearer {token}"},
            timeout=15,
        )
    except requests.exceptions.RequestException:
        raise HTTPException(
            status_code=503,
            detail=(
                "Could not reach Supabase. The project may be paused — "
                "restore it at https://supabase.com/dashboard, then try again."
            ),
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user_id = (resp.json() or {}).get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not identify the signed-in user")
    return user_id


@router.post("/google/link")
async def link_google_tokens(
    payload: GoogleTokenPayload,
    authorization: str | None = Header(default=None),
):
    """Store the Google tokens from a fresh sign-in as the profile's Gmail token.

    Returns `{linked: bool}` — `linked` is False when Google withheld a refresh
    token and we have none on file, which means Gmail calls will stop working
    once the access token expires and the user should re-consent.
    """
    user_id = _user_id_from_bearer(authorization)

    if not payload.provider_token:
        raise HTTPException(status_code=400, detail="No Google access token on the session")

    # Google only returns a refresh token on the first consent (or when
    # prompt=consent forces a new one). On later sign-ins the field is absent,
    # so overwriting blindly would throw away the only long-lived credential we
    # have. Keep whatever is already stored unless Google sent a new one.
    existing_refresh = None
    try:
        res = supabase.from_("profiles").select("gmail_token").eq("id", user_id).execute()
        if res.data:
            existing_refresh = (res.data[0].get("gmail_token") or {}).get("refresh_token")
    except Exception as e:
        print(f"auth: could not read existing gmail_token: {e}")

    refresh_token = payload.provider_refresh_token or existing_refresh

    # Same shape the /actions/callback flow writes, so gmail_service and every
    # existing caller keep working unchanged.
    token_data = {
        "access_token": payload.provider_token,
        "refresh_token": refresh_token,
        "token_type": "Bearer",
        "scope": payload.scope or "",
        "expires_in": payload.expires_in,
        "source": "supabase_google_signin",
    }

    try:
        supabase.from_("profiles").update({"gmail_token": token_data}).eq("id", user_id).execute()
    except Exception as e:
        print(f"auth: failed to store gmail token: {e}")
        raise HTTPException(status_code=500, detail="Could not save Gmail access")

    return {"linked": bool(refresh_token), "user_id": user_id}


@router.get("/me")
async def me(authorization: str | None = Header(default=None)):
    """The signed-in user's profile, including whether Gmail is linked."""
    user_id = _user_id_from_bearer(authorization)

    def _select(columns: str):
        return supabase.from_("profiles").select(columns).eq("id", user_id).execute()

    # `avatar_url` only exists once migrations/003_google_auth.sql has been run.
    # Selecting it unconditionally would make this endpoint 500 on any database
    # that has not been migrated yet — including a fresh clone — so fall back to
    # the columns that have always existed and carry on without the avatar.
    try:
        res = _select("id, full_name, avatar_url, gmail_token")
    except Exception as e:
        if "avatar_url" not in str(e):
            print(f"auth: profile lookup failed: {e}")
            raise HTTPException(status_code=500, detail="Could not load profile")
        print(
            "auth: profiles.avatar_url is missing — run "
            "database/migrations/003_google_auth.sql to enable Google profile pictures"
        )
        try:
            res = _select("id, full_name, gmail_token")
        except Exception as inner:
            print(f"auth: profile lookup failed: {inner}")
            raise HTTPException(status_code=500, detail="Could not load profile")

    row = res.data[0] if res.data else {}
    token = row.get("gmail_token") or {}
    return {
        "id": user_id,
        "full_name": row.get("full_name"),
        "avatar_url": row.get("avatar_url"),
        "gmail_linked": bool(token.get("refresh_token") or token.get("access_token")),
    }
