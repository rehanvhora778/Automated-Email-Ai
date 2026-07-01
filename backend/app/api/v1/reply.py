"""Smart Reply Generator — turns a pasted email into multiple reply styles."""
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.ai_service import SecretaryAI
from app.db.supabase import get_user_profile

router = APIRouter()
ai = SecretaryAI()


class ReplyRequest(BaseModel):
    user_id: Optional[str] = None
    original_email: str = Field(..., min_length=1)
    tone: Optional[str] = ""
    context: Optional[str] = ""
    # Optional subset of style keys to generate; defaults to the full set.
    styles: Optional[List[str]] = None


@router.post("/generate")
async def generate_reply(req: ReplyRequest):
    if not req.original_email.strip():
        raise HTTPException(status_code=400, detail="original_email is required")

    user_name, signature = "User", ""
    if req.user_id:
        try:
            profile = get_user_profile(req.user_id)
            if profile:
                user_name = profile.get("full_name") or "User"
                signature = profile.get("signature") or ""
        except Exception as e:
            print(f"reply: profile fetch warning: {e}")

    replies = ai.generate_replies(
        original_email=req.original_email,
        tone=req.tone or "",
        context=req.context or "",
        user_name=user_name,
        signature=signature,
        styles=req.styles,
    )
    return {"replies": replies}
