import os
import io
import json
import base64
import requests
from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
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

SCOPES = ['https://www.googleapis.com/auth/gmail.send']
# Purani 2-3 lines hata kar ye naya block paste karo
REDIRECT_URI = "http://localhost:8000/api/v1/actions/callback"

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
        
    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth?"
        f"client_id={client_config['client_id']}&"
        f"redirect_uri={REDIRECT_URI}&" # <--- Fixed URI
        "response_type=code&"
        f"scope={' '.join(SCOPES)}&"
        "access_type=offline&"
        "prompt=consent&"
        f"state={user_id}" 
    )
    return {"url": auth_url}

@router.get("/callback")
async def callback(code: str, state: str):
    user_id = state
    token_url = "https://oauth2.googleapis.com/token"
    
    # Token mangne ke liye bhi wahi fixed redirect_uri chahiye
    data = {
        "code": code,
        "client_id": client_config["client_id"],
        "client_secret": client_config["client_secret"],
        "redirect_uri": REDIRECT_URI, # <--- Fixed URI
        "grant_type": "authorization_code",
    }
    
    response = requests.post(token_url, data=data)
    token_data = response.json()
    
    if "error" in token_data:
        raise HTTPException(status_code=400, detail=token_data.get("error_description"))

    try:
        # Token ko database mein user ki ID par save karna
        supabase.from_("profiles").update({"gmail_token": token_data}).eq("id", user_id).execute()
        return "Login Successful! Your Gmail is now linked. You can close this tab and go back to the app."
    except Exception as e:
        return f"DB Error: {e}"

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
    attach_resume: bool = Form(False),
    file: UploadFile = File(None),   # optional user-picked attachment
):
    print(f"DEBUG: Email request received for user: {user_id}")
    print(f"DEBUG: Attach resume flag is: {attach_resume}")

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

        # 2. Attach ORIGINAL PDF resume (optional)
        if attach_resume:
            print("DEBUG: Attempting to attach resume...")
            resume_res = supabase.table("resumes").select("file_path").eq("user_id", user_id).execute()

            if resume_res.data and resume_res.data[0].get('file_path'):
                file_path = resume_res.data[0]['file_path']
                print(f"DEBUG: File path found in DB: {file_path}")

                try:
                    # Download bytes
                    file_bytes = supabase.storage.from_("resumes").download(file_path)
                    print(f"DEBUG: Successfully downloaded {len(file_bytes)} bytes from storage")

                    part = MIMEBase('application', 'pdf')
                    part.set_payload(file_bytes)
                    encoders.encode_base64(part)
                    part.add_header('Content-Disposition', f'attachment; filename="Resume.pdf"')
                    mime_msg.attach(part)
                    print("DEBUG: Resume attached to MIME message")
                except Exception as storage_err:
                    print(f"DEBUG ERROR: Storage download failed: {storage_err}")
            else:
                print("DEBUG ERROR: No file_path found in resumes table. Did you re-upload?")

        # 3. Attach the user-picked file (any type), if provided
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
    
    
    