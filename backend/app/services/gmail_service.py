"""Building an authenticated Gmail client out of a stored OAuth token.

Three things live here because every mailbox-backed route needs all three:
loading the Google client config, turning a stored token into a working API
client, and deciding what a Google failure actually means to the user.

That last one matters more than it sounds. "Your token no longer works" and
"you are going too fast" and "that message id does not exist" all surface from
the Gmail API as exceptions, and the app used to answer every one of them with
`needs_reauth`. Being told to re-link a mailbox that is perfectly healthy is a
dead end: the user re-links, nothing changes, and the real cause — a quota, a
stale message id — stays invisible. `classify_google_error` separates them.
"""
import datetime
import json
import os

from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

TOKEN_URI = "https://oauth2.googleapis.com/token"

#: Mailbox permissions this app asks for. The single source of truth — the
#: Link Gmail flow in `api/v1/actions.py` imports these rather than keeping a
#: second copy that could drift.
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",  # AI Inbox Summary (read)
    "https://www.googleapis.com/auth/gmail.modify",    # archive / trash / label / star / read
]


def load_client_config():
    """Google OAuth web client config, from the env var (prod) or credentials.json (local).

    Render has no repo file to read, so production pastes the whole JSON into
    GOOGLE_CREDENTIALS_JSON. Locally the downloaded credentials.json is used
    as-is, which keeps the file gitignored and out of the deployment.
    """
    raw = os.getenv("GOOGLE_CREDENTIALS_JSON")
    if raw:
        try:
            return json.loads(raw)["web"]
        except Exception as e:
            print(f"Google config env parse error: {e}")
            return {}
    try:
        with open("credentials.json") as f:
            return json.load(f)["web"]
    except FileNotFoundError:
        print("credentials.json not found (and no GOOGLE_CREDENTIALS_JSON)")
        return {}


# Kept as the old private name too: other modules imported it that way.
_load_client_config = load_client_config


class _PersistingCredentials(Credentials):
    """Credentials that tell someone when they have just refreshed themselves.

    An access token lasts about an hour; a stored one is therefore expired far
    more often than not. Without this hook every single request repeated the
    same dance — call Gmail, get 401, refresh, retry — because the fresh access
    token was thrown away the moment the request finished. Handing it back to
    the caller to store turns that into one refresh an hour.
    """

    def __init__(self, *args, on_refresh=None, **kwargs):
        super().__init__(*args, **kwargs)
        self._on_refresh = on_refresh

    def refresh(self, request):
        super().refresh(request)
        if self._on_refresh:
            try:
                self._on_refresh(self)
            except Exception as e:  # persistence must never break the API call
                print(f"gmail: could not persist refreshed token: {e}")


def _parse_expiry(token_data):
    """Expiry as a naive UTC datetime, which is what google-auth compares against."""
    raw = token_data.get("expires_at")
    if not raw:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return parsed


def credentials_to_token_data(creds, previous=None):
    """The stored token shape, refreshed from a live Credentials object.

    Keeps every field the rest of the app reads (`scope`, `refresh_token`,
    `source`) and updates only what the refresh actually changed.
    """
    merged = dict(previous or {})
    merged["access_token"] = creds.token
    if creds.refresh_token:
        merged["refresh_token"] = creds.refresh_token
    if creds.expiry:
        merged["expires_at"] = creds.expiry.replace(
            tzinfo=datetime.timezone.utc
        ).isoformat()
    if creds.scopes:
        merged["scope"] = " ".join(creds.scopes)
    merged.setdefault("token_type", "Bearer")
    return merged


def build_user_gmail_service(token_data, on_refresh=None):
    """Build an authenticated Gmail API client from a stored OAuth token dict.

    Returns a googleapiclient service, or None when the client config or the
    token is missing. `on_refresh` is called with the live Credentials right
    after a successful token refresh, so the caller can store the new access
    token instead of refreshing again on the next request.
    """
    cfg = load_client_config()
    if not cfg or not token_data:
        return None

    scope_str = token_data.get("scope") or ""
    creds = _PersistingCredentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri=TOKEN_URI,
        client_id=cfg.get("client_id"),
        client_secret=cfg.get("client_secret"),
        # Without scopes and expiry google-auth cannot tell that a stored token
        # has lapsed (`expired` is False whenever expiry is unset), so it never
        # refreshes ahead of a call and every request pays a 401-then-retry.
        scopes=scope_str.split() or None,
        expiry=_parse_expiry(token_data),
        on_refresh=on_refresh,
    )
    # cache_discovery=False: the file-backed discovery cache is unwritable on
    # a read-only container and only ever produces a warning here.
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


# --- Reading a Gmail failure -------------------------------------------

#: The grant is gone or too narrow — the user has to link Gmail again.
NEEDS_REAUTH = "needs_reauth"
#: Google is throttling us. Trying again later works; re-linking does not.
RATE_LIMITED = "rate_limited"
#: Anything else.
GENERIC = "error"

_REAUTH_REASONS = {
    "insufficientPermissions",
    "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
    "authError",
    "forbidden",
}
_RATE_LIMIT_REASONS = {
    "rateLimitExceeded",
    "userRateLimitExceeded",
    "quotaExceeded",
    "dailyLimitExceeded",
    "backendError",
}


def _http_error_reason(exc):
    """Google's machine-readable `reason`, which the status code alone hides.

    Gmail answers both "your token lacks this scope" and "you are sending too
    fast" with HTTP 403. Only the reason string tells them apart, so a status
    check on its own sends throttled users off to re-link a healthy mailbox.
    """
    try:
        body = json.loads(exc.content.decode("utf-8") if isinstance(exc.content, bytes) else exc.content)
    except Exception:
        return ""
    error = (body or {}).get("error") or {}
    details = error.get("errors") or []
    if details and isinstance(details, list):
        return details[0].get("reason") or ""
    return error.get("status") or ""


def classify_google_error(exc):
    """Map an exception from the Gmail API onto one of the constants above."""
    # A refresh that fails is almost always `invalid_grant`: the user revoked
    # the app at myaccount.google.com, changed their password, or the refresh
    # token expired because the Google project is still in Testing mode (those
    # expire after 7 days). All of them mean the same thing to the user.
    if isinstance(exc, RefreshError):
        return NEEDS_REAUTH

    if isinstance(exc, HttpError):
        status = getattr(getattr(exc, "resp", None), "status", None)
        reason = _http_error_reason(exc)
        if status == 401:
            return NEEDS_REAUTH
        if status == 429 or reason in _RATE_LIMIT_REASONS:
            return RATE_LIMITED
        if status == 403:
            return NEEDS_REAUTH if reason in _REAUTH_REASONS else RATE_LIMITED
        return GENERIC

    text = str(exc).lower()
    if "invalid_grant" in text or "invalid credentials" in text:
        return NEEDS_REAUTH
    if "insufficient" in text and "permission" in text:
        return NEEDS_REAUTH
    if "rate limit" in text or "quota" in text:
        return RATE_LIMITED
    return GENERIC


#: What to actually show someone, per classification.
ERROR_MESSAGES = {
    NEEDS_REAUTH: (
        "Google no longer accepts this connection. Link Gmail again to restore access."
    ),
    RATE_LIMITED: (
        "Google is rate-limiting this account right now. Please try again in a minute."
    ),
    GENERIC: "Gmail could not complete that request.",
}


def describe_google_error(exc):
    """`(classification, message)` — a message safe to show a user.

    Google's own text can carry internal ids and quota details, so the user
    sees a fixed sentence and the raw error goes to the server log instead.
    """
    kind = classify_google_error(exc)
    return kind, ERROR_MESSAGES[kind]
