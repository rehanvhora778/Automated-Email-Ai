from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone
from app.models.chat import ChatRequest
from app.services.ai_service import SecretaryAI
from app.db.supabase import supabase

router = APIRouter()
ai_secretary = SecretaryAI()

@router.post("/")
async def chat_with_secretary(req: ChatRequest):
    profile_data = {"full_name": "User", "signature": ""}
    resume_context = ""
    chat_history = []

    # 0. Ensure we have a conversation thread to write into
    conversation_id = req.conversation_id
    if not conversation_id:
        title = (req.message or "New conversation").strip()[:40] or "New conversation"
        conv = supabase.table("conversations").insert({
            "user_id": req.user_id,
            "title": title,
        }).execute()
        conversation_id = conv.data[0]["id"]
        print(f"DEBUG: Started new conversation {conversation_id}")

    try:
        # 1. Profile & Resume
        profile_res = supabase.table("profiles").select("*").eq("id", req.user_id).execute()
        if profile_res.data:
            profile_data = profile_res.data[0]
            print(f"DEBUG: Profile Found - {profile_data.get('full_name')}")
        else:
            print(f"DEBUG: No Profile found for ID: {req.user_id}")

        resume_res = supabase.table("resumes").select("raw_text").eq("user_id", req.user_id).execute()
        if resume_res.data and resume_res.data[0].get('raw_text'):
            resume_context = resume_res.data[0]['raw_text'][:1000]

        # 2. Load memory for THIS conversation only (not all of the user's chats)
        history_res = supabase.table("chat_messages") \
            .select("role", "content") \
            .eq("conversation_id", conversation_id) \
            .order("created_at", desc=True) \
            .limit(10) \
            .execute()

        if history_res.data:
            chat_history = history_res.data[::-1]
            print(f"DEBUG: Memory loaded - {len(chat_history)} messages found.")

    except Exception as e:
        print(f"Database Warning: {e}")

    # 3. AI Response
    try:
        ai_response = ai_secretary.generate_response(
            user_input=req.message,
            profile_data=profile_data,
            resume_context=resume_context,
            chat_history=chat_history
        )

        # 4. Save both messages under this conversation
        new_msgs = [
            {"user_id": req.user_id, "role": "user", "content": req.message, "conversation_id": conversation_id},
            {"user_id": req.user_id, "role": "assistant", "content": ai_response.get("content", ""), "conversation_id": conversation_id},
        ]
        supabase.table("chat_messages").insert(new_msgs).execute()

        # 5. Bump the conversation so it sorts to the top of the sidebar
        try:
            supabase.table("conversations").update(
                {"updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", conversation_id).execute()
        except Exception as bump_err:
            print(f"DEBUG: updated_at bump failed: {bump_err}")

        # Return the conversation id so the frontend can keep the thread active
        ai_response["conversation_id"] = conversation_id
        return ai_response

    except Exception as e:
        print(f"AI ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))
