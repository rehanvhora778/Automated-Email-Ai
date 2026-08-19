import os
import io
import json
import base64
import requests
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import RedirectResponse
from app.db.supabase import supabase  
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from pydantic import BaseModel
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders
from reportlab.pdfgen import canvas

router = APIRouter()

# Local testing bypass
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'

SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',  # AI Inbox Summary (read)
    'https://www.googleapis.com/auth/gmail.modify',    # Inbox actions: archive/trash/label/star/read
]
CALLBACK_PATH = "/api/v1/actions/callback"
LOCAL_REDIRECT_URI = f"http://localhost:8000{CALLBACK_PATH}"

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

google_creds_raw = os.getenv("GOOGLE_CREDENTIALS_JSON")

if google_creds_raw:
    # Production (Render) ke liye logic
    try:
        client_config = json.loads(google_creds_raw)['web']
        print("DEBUG: Loaded Google Credentials from Env Var")
    except Exception as e:
        print(f"DEBUG ERROR: Failed to parse Google JSON from Env: {e}")
        client_config = {}
else:
    # Local development ke liye logic
    try:
        with open("credentials.json", 'r') as f:
            client_config = json.load(f)['web']
            print("DEBUG: Loaded Google Credentials from local file")
    except FileNotFoundError:
        print("CRITICAL: credentials.json not found locally or in Env Var")
        client_config = {}

# Ab niche jahan 'auth_url' banta hai, usey check karein ki client_config khali toh nahi

@router.get("/login-google")
async def login_google(user_id: str):
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
        "state": user_id,
    }
    return {"url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)}

def _back_to_app(status: str, reason: str = "") -> RedirectResponse:
    """Send the browser back to the app with the outcome in the query string."""
    params = {"gmail": status}
    if reason:
        params["reason"] = reason[:200]
    return RedirectResponse(f"{FRONTEND_URL}/?{urlencode(params)}")


@router.get("/callback")
async def callback(code: str, state: str):
    user_id = state
    token_url = "https://oauth2.googleapis.com/token"

    # Token exchange has to repeat the identical redirect_uri.
    data = {
        "code": code,
        "client_id": client_config["client_id"],
        "client_secret": client_config["client_secret"],
        "redirect_uri": REDIRECT_URI,
        "grant_type": "authorization_code",
    }

    try:
        response = requests.post(token_url, data=data, timeout=20)
        token_data = response.json()
    except requests.exceptions.RequestException as e:
        print(f"actions: token exchange failed: {e}")
        return _back_to_app("error", "Could not reach Google to complete linking")

    if "error" in token_data:
        return _back_to_app("error", token_data.get("error_description") or token_data["error"])

    # Google omits refresh_token when it has already issued one for this client.
    # Dropping the stored value here would leave the account unable to refresh,
    # so carry the old one forward whenever the new response lacks it.
    if not token_data.get("refresh_token"):
        try:
            res = supabase.from_("profiles").select("gmail_token").eq("id", user_id).execute()
            if res.data:
                prior = (res.data[0].get("gmail_token") or {}).get("refresh_token")
                if prior:
                    token_data["refresh_token"] = prior
        except Exception as e:
            print(f"actions: could not read existing gmail_token: {e}")

    try:
        supabase.from_("profiles").update({"gmail_token": token_data}).eq("id", user_id).execute()
    except Exception as e:
        print(f"actions: failed to store gmail token: {e}")
        return _back_to_app("error", "Signed in with Google, but saving the token failed")

    return _back_to_app("linked")

# --- DYNAMIC SIDEBAR HISTORY ENDPOINT ---
@router.get("/history")
async def get_history(user_id: str):
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/send-email")
async def send_email(
    user_id: str = Form(...),
    to_email: str = Form(...),
    subject: str = Form(""),
    body: str = Form(""),
    file: UploadFile = File(None),   # optional user-picked attachment
):
    print(f"DEBUG: Email request received for user: {user_id}")

    # Read the optional uploaded file now (UploadFile read is async)
    extra_file_bytes = None
    extra_file_name = None
    extra_file_type = "application/octet-stream"
    if file is not None and file.filename:
        extra_file_bytes = await file.read()
        extra_file_name = file.filename
        extra_file_type = file.content_type or "application/octet-stream"
        print(f"DEBUG: Got attachment '{extra_file_name}' ({len(extra_file_bytes)} bytes, {extra_file_type})")

    # 1. Get Token
    res = supabase.from_("profiles").select("gmail_token").eq("id", user_id).execute()
    if not res.data or not res.data[0].get('gmail_token'):
        print("DEBUG ERROR: Gmail token not found in DB")
        raise HTTPException(status_code=401, detail="Gmail not linked")

    token_data = res.data[0]['gmail_token']
    creds = Credentials(
        token=token_data.get('access_token'),
        refresh_token=token_data.get('refresh_token'),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=client_config["client_id"],
        client_secret=client_config["client_secret"]
    )

    try:
        service = build('gmail', 'v1', credentials=creds)
        mime_msg = MIMEMultipart()
        mime_msg['to'] = to_email
        mime_msg['subject'] = subject
        mime_msg.attach(MIMEText(body, 'plain'))

        # 2. Attach the user-picked file (any type), if provided
        if extra_file_bytes is not None:
            maintype, _, subtype = extra_file_type.partition("/")
            part = MIMEBase(maintype or "application", subtype or "octet-stream")
            part.set_payload(extra_file_bytes)
            encoders.encode_base64(part)
            part.add_header('Content-Disposition', f'attachment; filename="{extra_file_name}"')
            mime_msg.attach(part)
            print(f"DEBUG: User file '{extra_file_name}' attached to MIME message")

        raw_string = base64.urlsafe_b64encode(mime_msg.as_bytes()).decode()
        service.users().messages().send(userId="me", body={'raw': raw_string}).execute()
        print("DEBUG: Email sent successfully!")
        return {"status": "success"}

    except Exception as e:
        print(f"DEBUG ERROR: Gmail API failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    
    