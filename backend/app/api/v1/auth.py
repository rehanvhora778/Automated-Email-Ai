import os
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_KEY = os.getenv("SUPABASE_KEY")  # service_role key


class SignupRequest(BaseModel):
    email: str
    password: str
    full_name: str | None = None


@router.post("/signup")
async def signup(req: SignupRequest):
    """
    Create a user that is already email-confirmed, so they can log in
    immediately. Uses the service_role key (admin API). This sidesteps the
    project's "Confirm email" setting for this personal-use app.
    """
    if not SUPABASE_URL or not SERVICE_KEY:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    full_name = req.full_name or req.email.split("@")[0]

    resp = requests.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers={
            "apikey": SERVICE_KEY,
            "Authorization": f"Bearer {SERVICE_KEY}",
            "Content-Type": "application/json",
        },
        json={
            "email": req.email,
            "password": req.password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name},
        },
        timeout=20,
    )

    data = resp.json()

    if resp.status_code in (200, 201):
        return {"status": "success", "message": "Account created. You can sign in now."}

    # Supabase returns a useful message/error code we can surface to the user.
    detail = data.get("msg") or data.get("error_description") or data.get("message") or "Signup failed"
    raise HTTPException(status_code=resp.status_code, detail=detail)
