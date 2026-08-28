import os
import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build


def _load_client_config():
    """Load Google OAuth web client config from env var (prod) or credentials.json (local)."""
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


def build_user_gmail_service(token_data):
    """Build an authenticated Gmail API client from a stored OAuth token dict.

    Returns a googleapiclient service, or None if config/token is missing.
    Credentials carry the refresh_token + client secret so expired access
    tokens refresh automatically on the first call.
    """
    cfg = _load_client_config()
    if not cfg or not token_data:
        return None
    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=cfg.get("client_id"),
        client_secret=cfg.get("client_secret"),
    )
    return build("gmail", "v1", credentials=creds)
