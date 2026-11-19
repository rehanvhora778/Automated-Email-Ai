"""Linking a Google mailbox, and sending mail through it.

The link is a three-step handshake rather than the usual two, and the extra
step is the point.

A plain OAuth round trip has a gap: the browser that *finishes* consent is not
necessarily the browser that *started* it. This flow used to carry the account
id itself in the `state` parameter and write Google's tokens onto whatever id
came back, which made that gap exploitable in both directions — hand someone a
consent link minted for your own account and their mailbox lands on your
profile; forge a bare `GET /callback?code=…&state=<their id>` and your mailbox
lands on theirs. Neither needed a password or a session.

So: `/login-google` mints an unguessable, single-use, expiring `state` bound
server-side to the signed-in user. Google returns it to `/callback`, which
exchanges the code and parks the token against that state without attaching it
to anybody. The browser is then sent back to the app, which recognises the
state as one it started (it kept a copy) and calls `/complete-link` with its
own session. Only there, with both halves agreeing, is the token written to a
profile. A consent completed by the wrong person reaches the last step and
stops, having linked nothing.
"""
import datetime
import os
import base64
import secrets
import requests
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from app.api.deps import CurrentUser
from app.db.supabase import supabase
from app.services.gmail_service import (
    GMAIL_SCOPES,
    build_user_gmail_service,
    credentials_to_token_data,
    describe_google_error,
    load_client_config,
    NEEDS_REAUTH,
    RATE_LIMITED,
)
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email.header import Header
from email import encoders

router = APIRouter()

# Local testing bypass
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

SCOPES = GMAIL_SCOPES
CALLBACK_PATH = "/api/v1/actions/callback"
LOCAL_REDIRECT_URI = f"http://localhost:8000{CALLBACK_PATH}"

# How long a started link attempt stays valid. Long enough to read Google's
# unverified-app warning, pick an account and tick the boxes; short enough that
# an abandoned attempt is not a token waiting to be claimed.
LINK_STATE_TTL_MINUTES = 15

# Gmail caps a whole message at 25 MB and base64 inflates the payload by about
# a third, so this is the practical ceiling for a single attachment. Without a
# limit, one request could exhaust the memory of a free-tier container.
MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

# Must exactly match an Authorized redirect URI on the Google OAuth client.
#
# Order matters. An explicit OAUTH_REDIRECT_URI always wins. Otherwise, when
# running on Render, derive it from RENDER_EXTERNAL_URL — Render injects that
# automatically, so a deploy that forgets to set OAUTH_REDIRECT_URI still sends
# Google to this service instead of to the developer's laptop. Only when
# neither exists do we fall back to localhost, which is correct for local dev
# and wrong (loudly — see login_google) anywhere else.
_RENDER_EXTERNAL_URL = os.getenv("RENDER_EXTERNAL_URL", "").strip().rstrip("/")
REDIRECT_URI = (
    os.getenv("OAUTH_REDIRECT_URI", "").strip().rstrip("/")
    or (f"{_RENDER_EXTERNAL_URL}{CALLBACK_PATH}" if _RENDER_EXTERNAL_URL else "")
    or LOCAL_REDIRECT_URI
)

# Where to send the browser once Google has handed back the code. Landing the
# user back in the app beats stranding them on a bare text response served from
# the API domain.
FRONTEND_URL = (
    os.getenv("FRONTEND_URL", "").strip().rstrip("/")
    or next(
        (o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()),
        "",
    )
    or "http://localhost:5173"
)

# True when this process is running somewhere public but still pointing OAuth at
# localhost — a combination that can only end in a dead "page not found" tab.
_REDIRECT_IS_LOCAL = "localhost" in REDIRECT_URI or "127.0.0.1" in REDIRECT_URI
_IS_DEPLOYED = bool(_RENDER_EXTERNAL_URL or os.getenv("RENDER") or os.getenv("PORT_IS_MANAGED"))

print(f"OAuth redirect URI: {REDIRECT_URI}")
print(f"OAuth post-login redirect: {FRONTEND_URL}")

client_config = load_client_config()
if client_config:
    print("DEBUG: Google client config loaded")
else:
    print("CRITICAL: no Google client config (set GOOGLE_CREDENTIALS_JSON or add credentials.json)")


class CompleteLinkRequest(BaseModel):
    """The state nonce the browser kept when it started the link."""
    state: str = Field(..., min_length=16, max_length=256)


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _purge_expired_states():
    """Drop link attempts nobody came back for.

    Called opportunistically rather than on a schedule: these rows hold a
    Google token between the callback and the confirmation, so leaving the
    abandoned ones lying around is the one thing worth avoiding, and the free
    tier has no cron to do it properly.
    """
    try:
        supabase.from_("oauth_states").delete().lt("expires_at", _now().isoformat()).execute()
    except Exception as e:
        print(f"actions: could not purge expired oauth states: {e}")


def _normalise_newlines(text: str) -> str:
    """Collapse every line-ending convention down to a single \n.

    A browser sends multipart/form-data field values with CRLF line endings —
    that is what the spec requires — so a body typed with single line breaks
    arrives here full of \r\n. Python's email generator then emits those
    bytes as-is inside a message whose own structure uses \n, and the
    receiving mail client is left with mixed endings it renders as doubled blank
    lines. The text goes out looking nothing like what was typed.

    Normalising here means the message carries exactly the breaks the author
    wrote, and the generator adds the CRLF the wire format needs on its own.
    """
    return text.replace("\r\n", "\n").replace("\r", "\n")


def _clean_header(value: str) -> str:
    """A header value with line breaks stripped out.

    A newline inside a header ends it, so a recipient or subject carrying one
    would let the caller append headers of their own — a second Bcc, a forged
    Reply-To — to a message the mail server then sends with the account's real
    signature on it.
    """
    return "".join(ch for ch in (value or "") if ch not in "\r\n").strip()


def _back_to_app(status: str, reason: str = "", state: str = "") -> RedirectResponse:
    """Send the browser back to the app with the outcome in the query string."""
    params = {"gmail": status}
    if reason:
        params["reason"] = reason[:200]
    if state:
        params["state"] = state
    return RedirectResponse(f"{FRONTEND_URL}/?{urlencode(params)}")


@router.get("/login-google")
async def login_google(user_id: CurrentUser):
    """Start a Gmail link: mint a one-time state and hand back Google's URL."""
    if not client_config:
        raise HTTPException(status_code=500, detail="Google Credentials not configured")

    # Fail here, with something the user can act on, rather than handing back a
    # URL that sends them to http://localhost:8000 on a machine where nothing is
    # listening — which is what produced the "page not found" tab.
    if _REDIRECT_IS_LOCAL and _IS_DEPLOYED:
        raise HTTPException(
            status_code=500,
            detail=(
                "Gmail linking is misconfigured on the server: the OAuth redirect "
                f"is still {REDIRECT_URI}. Set OAUTH_REDIRECT_URI to this service's "
                "public /api/v1/actions/callback URL and add that same URL under "
                "'Authorized redirect URIs' in the Google Cloud console."
            ),
        )

    _purge_expired_states()

    # 32 bytes of urandom: the whole security of the round trip rests on this
    # value being unguessable, since it is what proves a returning callback
    # belongs to a link this server actually started.
    state = secrets.token_urlsafe(32)
    expires_at = _now() + datetime.timedelta(minutes=LINK_STATE_TTL_MINUTES)
    try:
        supabase.from_("oauth_states").insert({
            "state": state,
            "user_id": user_id,
            "expires_at": expires_at.isoformat(),
        }).execute()
    except Exception as e:
        print(f"actions: could not record oauth state: {e}")
        raise HTTPException(
            status_code=503,
            detail="Could not start Gmail linking right now. Please try again.",
        )

    # urlencode matters: scope is space-delimited and redirect_uri contains ':'
    # and '/', all of which have to be percent-encoded for Google to match the
    # value against its registered list.
    params = {
        "client_id": client_config["client_id"],
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return {
        "url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params),
        "state": state,
    }


@router.get("/callback")
async def callback(
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    """Google's return leg.

    Every parameter is optional because Google does not always send the same
    ones: pressing Cancel on the consent screen produces `error` and no `code`
    at all. Declaring `code` as required made FastAPI answer that with a raw
    422 JSON body on the API domain — a dead end on a page the user cannot get
    out of, for the most ordinary thing a person can do.
    """
    if error:
        reason = (
            "You cancelled the Google permission request."
            if error == "access_denied"
            else f"Google refused the request ({error})."
        )
        if state:
            try:
                supabase.from_("oauth_states").delete().eq("state", state).execute()
            except Exception as e:
                print(f"actions: could not clear abandoned oauth state: {e}")
        return _back_to_app("error", reason)

    if not code or not state:
        return _back_to_app("error", "Google's response was incomplete. Please try linking again.")

    try:
        res = supabase.from_("oauth_states").select("*").eq("state", state).execute()
    except Exception as e:
        print(f"actions: could not look up oauth state: {e}")
        return _back_to_app("error", "Could not verify the link request. Please try again.")

    row = res.data[0] if res.data else None
    if not row:
        # Either a forged callback, or a genuine one replayed after the link
        # already completed and the row was consumed. Both are safe to refuse.
        return _back_to_app("error", "This link request is no longer valid. Please try again.")

    try:
        expires_at = datetime.datetime.fromisoformat(str(row["expires_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        expires_at = _now()
    if expires_at <= _now():
        supabase.from_("oauth_states").delete().eq("state", state).execute()
        return _back_to_app("error", "The link request timed out. Please try again.")

    # A browser that reloads the callback, or a double-click that fires it
    # twice, must not try to redeem the same authorization code again — Google
    # accepts a code exactly once and answers the second attempt with
    # invalid_grant. The first exchange already parked its result here, so just
    # send the browser on to the confirmation step it was heading for anyway.
    if row.get("token_data"):
        return _back_to_app("pending", state=state)

    data = {
        "code": code,
        "client_id": client_config.get("client_id"),
        "client_secret": client_config.get("client_secret"),
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }

    try:
        response = requests.post("https://oauth2.googleapis.com/token", data=data, timeout=20)
        token_data = response.json()
    except requests.exceptions.RequestException as e:
        print(f"actions: token exchange failed: {e}")
        return _back_to_app("error", "Could not reach Google to complete linking")
    except ValueError:
        print(f"actions: token endpoint returned non-JSON ({response.status_code})")
        return _back_to_app("error", "Google returned an unexpected response. Please try again.")

    if "error" in token_data:
        # Google's description is written for developers but names the actual
        # problem (a redirect_uri mismatch, an expired code), which beats a
        # generic failure the user can do nothing with.
        return _back_to_app("error", token_data.get("error_description") or token_data["error"])

    # Record when this access token dies, so the Gmail client can refresh ahead
    # of a call instead of discovering it mid-request.
    expires_in = token_data.get("expires_in")
    if isinstance(expires_in, int):
        token_data["expires_at"] = (_now() + datetime.timedelta(seconds=expires_in)).isoformat()

    try:
        supabase.from_("oauth_states").update({"token_data": token_data}).eq("state", state).execute()
    except Exception as e:
        print(f"actions: could not park exchanged token: {e}")
        return _back_to_app("error", "Google approved the link, but saving it failed")

    return _back_to_app("pending", state=state)


@router.post("/complete-link")
async def complete_link(payload: CompleteLinkRequest, user_id: CurrentUser):
    """Attach a parked Google token to the account that started the attempt.

    The two checks here are the whole point of the handshake: the state must be
    one this server minted, and it must have been minted for the caller. A
    consent completed by someone the link was not meant for arrives with a
    perfectly valid token and still links nothing.
    """
    try:
        res = supabase.from_("oauth_states").select("*").eq("state", payload.state).execute()
    except Exception as e:
        print(f"actions: could not look up oauth state: {e}")
        raise HTTPException(status_code=503, detail="Could not finish linking. Please try again.")

    row = res.data[0] if res.data else None
    if not row or not row.get("token_data"):
        raise HTTPException(
            status_code=400,
            detail="This link request has already been used or has expired. Please link Gmail again.",
        )

    if row.get("user_id") != user_id:
        # Someone finished a consent that was started for a different account.
        # Burn the attempt rather than leave a live token parked for a retry.
        supabase.from_("oauth_states").delete().eq("state", payload.state).execute()
        raise HTTPException(
            status_code=403,
            detail="That Gmail link was started by a different account and was not applied.",
        )

    token_data = dict(row["token_data"])

    # Google omits refresh_token when it has already issued one for this client.
    # Dropping the stored value here would leave the account unable to refresh,
    # so carry the old one forward whenever the new response lacks it.
    if not token_data.get("refresh_token"):
        try:
            prior_res = supabase.from_("profiles").select("gmail_token").eq("id", user_id).execute()
            if prior_res.data:
                prior = (prior_res.data[0].get("gmail_token") or {}).get("refresh_token")
                if prior:
                    token_data["refresh_token"] = prior
        except Exception as e:
            print(f"actions: could not read existing gmail_token: {e}")

    # Which mailbox did they actually connect? Worth one extra call: the UI can
    # then name the account, and a user who linked the wrong Google identity
    # finds out immediately instead of wondering why the inbox looks unfamiliar.
    linked_email = None
    try:
        service = build_user_gmail_service(token_data)
        if service is not None:
            linked_email = service.users().getProfile(userId="me").execute().get("emailAddress")
            if linked_email:
                token_data["email"] = linked_email
    except Exception as e:
        print(f"actions: could not read linked mailbox address: {e}")

    try:
        # upsert so a profile row that was never created still receives the
        # token — an update would quietly match nothing and lose the link.
        supabase.from_("profiles").upsert({"id": user_id, "gmail_token": token_data}).execute()
    except Exception as e:
        print(f"actions: failed to store gmail token: {e}")
        raise HTTPException(status_code=500, detail="Google approved the link, but saving it failed")

    try:
        supabase.from_("oauth_states").delete().eq("state", payload.state).execute()
    except Exception as e:
        print(f"actions: could not clear consumed oauth state: {e}")

    return {
        "linked": bool(token_data.get("refresh_token")),
        "email": linked_email,
        "scope": token_data.get("scope", ""),
    }


@router.post("/unlink-google")
async def unlink_google(user_id: CurrentUser):
    """Disconnect the mailbox here and withdraw the grant at Google.

    Clearing the stored row alone left the grant live: the app kept appearing
    in the user's third-party access list, and any copy of the refresh token
    that had leaked beforehand still opened the mailbox. Telling someone their
    mailbox is unlinked should mean it is.
    """
    token = {}
    try:
        res = supabase.from_("profiles").select("gmail_token").eq("id", user_id).execute()
        if res.data:
            token = res.data[0].get("gmail_token") or {}
    except Exception as e:
        print(f"actions: could not read gmail_token for unlink: {e}")

    revoked = False
    secret = token.get("refresh_token") or token.get("access_token")
    if secret:
        try:
            # Revoking a refresh token invalidates every access token derived
            # from it, so this one call retires the whole grant.
            resp = requests.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": secret},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15,
            )
            # 400 here usually means the token was already dead, which is the
            # outcome we wanted anyway.
            revoked = resp.status_code in (200, 400)
        except requests.exceptions.RequestException as e:
            print(f"actions: could not reach Google to revoke: {e}")

    try:
        supabase.from_("profiles").update({"gmail_token": None}).eq("id", user_id).execute()
    except Exception as e:
        print(f"actions: failed to clear gmail token: {e}")
        raise HTTPException(status_code=500, detail="Could not unlink Gmail. Please try again.")

    return {"unlinked": True, "revoked": revoked}


# --- DYNAMIC SIDEBAR HISTORY ENDPOINT ---
@router.get("/history")
async def get_history(user_id: CurrentUser):
    try:
        # User ki pichli 10 unique queries uthao
        res = supabase.from_("chat_messages") \
            .select("content") \
            .eq("user_id", user_id) \
            .eq("role", "user") \
            .order("created_at", desc=True) \
            .limit(10) \
            .execute()
        return res.data
    except Exception as e:
        # The raw database error names tables and columns, which is more than a
        # caller needs and more than we should volunteer.
        print(f"actions: history lookup failed: {e}")
        raise HTTPException(status_code=500, detail="Could not load your history")


@router.post("/send-email")
async def send_email(
    user_id: CurrentUser,
    to_email: str = Form(...),
    subject: str = Form(""),
    body: str = Form(""),
    file: UploadFile = File(None),   # optional user-picked attachment
):
    to_email = _clean_header(to_email)
    subject = _clean_header(subject)
    if not to_email:
        raise HTTPException(status_code=400, detail="A recipient address is required")

    # Read the optional uploaded file now (UploadFile read is async)
    extra_file_bytes = None
    extra_file_name = None
    extra_file_type = "application/octet-stream"
    if file is not None and file.filename:
        # Read with a ceiling rather than file.read(): an unbounded read would
        # pull however many megabytes the caller sent straight into the memory
        # of a container that has very little of it.
        extra_file_bytes = await file.read(MAX_ATTACHMENT_BYTES + 1)
        if len(extra_file_bytes) > MAX_ATTACHMENT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"Attachments are limited to {MAX_ATTACHMENT_BYTES // (1024 * 1024)} MB.",
            )
        extra_file_name = _clean_header(file.filename) or "attachment"
        extra_file_type = file.content_type or "application/octet-stream"

    # 1. Get Token
    res = supabase.from_("profiles").select("gmail_token").eq("id", user_id).execute()
    if not res.data or not res.data[0].get('gmail_token'):
        raise HTTPException(status_code=401, detail="Gmail not linked")

    token_data = res.data[0]['gmail_token']

    def _save_refreshed(creds, previous=token_data):
        supabase.from_("profiles").update(
            {"gmail_token": credentials_to_token_data(creds, previous)}
        ).eq("id", user_id).execute()

    service = build_user_gmail_service(token_data, on_refresh=_save_refreshed)
    if service is None:
        raise HTTPException(status_code=500, detail="Google credentials are not configured")

    try:
        mime_msg = MIMEMultipart()
        mime_msg['to'] = to_email
        # Header() so a subject containing anything outside ASCII — an accent, a
        # dash pasted from a document, an emoji — is encoded rather than sent as
        # raw 8-bit bytes that some servers mangle or reject.
        mime_msg['subject'] = Header(subject, 'utf-8') if subject else ''
        mime_msg.attach(MIMEText(_normalise_newlines(body), 'plain', 'utf-8'))

        # 2. Attach the user-picked file (any type), if provided
        if extra_file_bytes is not None:
            maintype, _, subtype = extra_file_type.partition("/")
            part = MIMEBase(maintype or "application", subtype or "octet-stream")
            part.set_payload(extra_file_bytes)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename="{extra_file_name}"')
            mime_msg.attach(part)

        raw_string = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode()
        service.users().messages().send(userId="me", body={'raw': raw_string}).execute()
        return {"status": "success"}

    except Exception as e:
        # Google's own text can carry quota details and internal ids, so the
        # user gets a sentence that names the real problem and the raw error
        # goes to the log. A dead grant is a 401 so the UI can offer re-linking
        # rather than presenting it as a server fault.
        kind, message = describe_google_error(e)
        print(f"actions: gmail send failed ({kind}): {e}")
        status = 401 if kind == NEEDS_REAUTH else 429 if kind == RATE_LIMITED else 502
        raise HTTPException(status_code=status, detail=message)
