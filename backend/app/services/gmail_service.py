import os
import json
import base64
from email.message import EmailMessage
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


class GmailService:
    @staticmethod
    def send_email(subject, body, to_email):
        # Note: Asli app mein hum token database se uthayenge.
        # Abhi testing ke liye hum token.json file use karenge jo pehli baar login pe banegi.
        if not os.path.exists('token.json'):
            return "Error: Please authenticate with Google first."

        creds = Credentials.from_authorized_user_file('token.json')
        service = build('gmail', 'v1', credentials=creds)

        message = EmailMessage()
        message.set_content(body)
        message['To'] = to_email
        message['Subject'] = subject

        encoded_message = base64.urlsafe_b64encode(message.as_bytes()).decode()
        create_message = {'raw': encoded_message}

        try:
            service.users().messages().send(userId="me", body=create_message).execute()
            return "Success"
        except Exception as e:
            return f"Error: {e}"