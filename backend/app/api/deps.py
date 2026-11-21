"""Shared FastAPI dependencies — chiefly "who is calling?".

Every route that touches a user's data or mailbox used to take the account id
straight off the request (`?user_id=`, or a field in the body) and look it up
with the service-role Supabase client, which bypasses row-level security. A
Supabase user id is not a secret: it travelled in query strings, so it sat in
browser history, Referer headers and the host's access logs. Anyone holding one
could read that person's inbox, enumerate their contacts, trash their mail, and
send mail from their Gmail address — with no session, token or password.

The fix is one dependency used everywhere: the caller proves who they are with
the Supabase access token their browser already holds, and the route uses the id
that token resolves to. A client-supplied id is never trusted again.

Verification asks Supabase itself (`GET /auth/v1/user`) rather than checking a
signature locally. That costs a round trip, but it works with every Supabase key
scheme — legacy HS256 secrets and the asymmetric signing keys new projects get
by default — needs no extra dependency, and honours revocation immediately. The
round trip is paid once per token per minute: results are cached briefly, which
matters because one dashboard load fires several of these at once.
"""
import hashlib
import os
import threading
import time
from typing import Annotated

import requests
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException

load_dotenv()

SUPABASE_URL = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/")
SERVICE_KEY = os.getenv("SUPABASE_KEY")  # service_role key

# How long a successful verification is trusted without re-asking Supabase.
# Short enough that a sign-out or a revoked user stops working almost at once,
# long enough that the four or five parallel requests behind a single page load
# cost one lookup rather than five.
_CACHE_TTL_SECONDS = 60.0
_CACHE_MAX_ENTRIES = 512

# token digest -> (user_id, expires_at). Keyed by digest so a raw access token
# is never held as a dictionary key that might end up in a traceback or a dump.
_verified: dict[str, tuple[str, float]] = {}
_verified_lock = threading.Lock()


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _cached_user_id(key: str) -> str | None:
    now = time.monotonic()
    with _verified_lock:
        hit = _verified.get(key)
        if not hit:
            return None
        user_id, expires_at = hit
        if expires_at <= now:
            _verified.pop(key, None)
            return None
        return user_id


def _remember(key: str, user_id: str) -> None:
    now = time.monotonic()
    with _verified_lock:
        if len(_verified) >= _CACHE_MAX_ENTRIES:
            # Cheap sweep rather than an LRU: entries are tiny and expire in a
            # minute, so dropping what has already lapsed is enough. If nothing
            # has lapsed, start over rather than grow without bound.
            for k, (_, exp) in list(_verified.items()):
                if exp <= now:
                    _verified.pop(k, None)
            if len(_verified) >= _CACHE_MAX_ENTRIES:
                _verified.clear()
        _verified[key] = (user_id, now + _CACHE_TTL_SECONDS)


def forget_token(token: str) -> None:
    """Drop a cached verification — used after an action invalidates a session."""
    with _verified_lock:
        _verified.pop(_digest(token), None)


def bearer_token(authorization: str | None) -> str:
    """Pull the raw token out of an Authorization header, or 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


def resolve_user_id(authorization: str | None) -> str:
    """Resolve the caller's Supabase user id from their access token.

    Raises 401 when the token is missing, malformed, expired or rejected, and
    503 when Supabase itself cannot be reached — the two are different problems
    and the frontend reacts to them differently (sign in again vs. try later).
    """
    token = bearer_token(authorization)
    key = _digest(token)

    cached = _cached_user_id(key)
    if cached:
        return cached

    if not SUPABASE_URL or not SERVICE_KEY:
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase is not configured on the server. Set SUPABASE_URL and "
                "SUPABASE_KEY (service_role) in the backend environment."
            ),
        )

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
                "Could not reach Supabase to verify your session. The project may "
                "be paused or deleted — check https://supabase.com/dashboard."
            ),
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user_id = (resp.json() or {}).get("id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Could not identify the signed-in user")

    _remember(key, user_id)
    return user_id


# Declared `def`, not `async def`, on purpose: the Supabase lookup is a blocking
# HTTP call, and FastAPI runs sync dependencies in a worker thread instead of
# stalling the event loop for every other request in flight.
def current_user_id(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: the signed-in caller's user id, or 401."""
    return resolve_user_id(authorization)


#: Annotate a route parameter with this to receive the verified caller's id.
#: `def inbox_summary(user_id: CurrentUser)` replaces the old
#: `def inbox_summary(user_id: str)` that trusted the query string.
CurrentUser = Annotated[str, Depends(current_user_id)]
