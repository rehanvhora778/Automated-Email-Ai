"""Generic AI writing tools — powers the dashboard Quick Actions.

Exposes both a buffered endpoint (/tool) and a token-streaming endpoint
(/tool/stream) so the UI can render output as it is generated.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.ai_service import SecretaryAI
from app.db.supabase import get_user_profile, get_user_resume

router = APIRouter()
ai = SecretaryAI()

ALLOWED_ACTIONS = {
    "cover_letter", "cold_email", "translate", "improve", "rewrite", "custom",
    "grammar_fix", "summarize", "tone_detection", "spam_detection", "phishing_detection",
    "subject_generator", "follow_up", "linkedin_outreach", "interview_email",
}


class ToolRequest(BaseModel):
    user_id: Optional[str] = None
    action: str
    input: str = ""
    context: Optional[str] = ""


def _resolve_user(user_id: Optional[str]):
    """Look up the user's name, signature and resume text (best-effort)."""
    user_name, signature, resume = "User", "", ""
    if user_id:
        try:
            profile = get_user_profile(user_id)
            if profile:
                user_name = profile.get("full_name") or "User"
                signature = profile.get("signature") or ""
            resume_row = get_user_resume(user_id)
            if isinstance(resume_row, dict):
                resume = resume_row.get("raw_text") or ""
            elif isinstance(resume_row, str):
                resume = resume_row
        except Exception as e:
            print(f"tool: profile/resume fetch warning: {e}")
    return user_name, signature, resume


@router.post("/tool")
async def run_tool(req: ToolRequest):
    if req.action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")

    user_name, signature, resume = _resolve_user(req.user_id)
    result = ai.run_tool(
        action=req.action,
        input_text=req.input,
        context=req.context or "",
        user_name=user_name,
        resume=resume,
        signature=signature,
    )
    if result.get("error"):
        raise HTTPException(status_code=502, detail=result["error"])
    return result


@router.post("/tool/stream")
async def run_tool_stream(req: ToolRequest):
    if req.action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")

    user_name, signature, resume = _resolve_user(req.user_id)

    def generate():
        try:
            for chunk in ai.stream_tool(
                action=req.action,
                input_text=req.input,
                context=req.context or "",
                user_name=user_name,
                resume=resume,
                signature=signature,
            ):
                yield chunk
        except Exception as e:
            print(f"tool stream error: {e}")
            yield f"\n\n[stream error] {e}"

    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
