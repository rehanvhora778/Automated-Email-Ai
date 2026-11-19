from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone
from app.api.deps import CurrentUser
from app.models.chat import ChatRequest
from app.services.ai_service import SecretaryAI
from app.db.supabase import supabase

router = APIRouter()
ai_secretary = SecretaryAI()

@router.post("/")
async def chat_with_secretary(req: ChatRequest, user_id: CurrentUser):
    profile_data = {"full_name": "User", "signature": ""}
    chat_history = []

    # 0. Ensure we have a conversation thread to write into
    conversation_id = req.conversation_id
    if conversation_id:
        # The id arrives as an opaque string in the request body, so it has to
        # be matched against the caller before it becomes the model's memory or
        # receives their messages -- otherwise any id would open someone else's
        # thread and drop this exchange into it.
        try:
            owned = supabase.table("conversations") \
                .select("id") \
                .eq("id", conversation_id) \
                .eq("user_id", user_id) \
                .limit(1) \
                .execute()
            belongs_to_caller = bool(owned.data)
        except Exception as e:
            # An id that is not even a uuid makes PostgREST raise rather than
            # return zero rows, which answers the same question: this is not
            # one of the caller's conversations.
            print(f"DEBUG: conversation ownership check failed: {e}")
            belongs_to_caller = False

        if not belongs_to_caller:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        title = (req.message or "New conversation").strip()[:40] or "New conversation"
        # Unlike the reads below, this one cannot degrade into a warning: with
        # no thread row there is nowhere to store the exchange. An insert that
        # comes back without a row surfaces here as an IndexError.
        try:
            conv = supabase.table("conversations").insert({
                "user_id": user_id,
                "title": title,
            }).execute()
            conversation_id = conv.data[0]["id"]
        except Exception as e:
            print(f"DEBUG: conversation insert failed: {e}")
            raise HTTPException(status_code=503, detail="Could not start a new conversation. Please try again.")
        print(f"DEBUG: Started new conversation {conversation_id}")

    try:
        # 1. Profile
        # The whole row is rendered into the system prompt below, and the row
        # carries `gmail_token` -- a long-lived Google refresh token. Only the
        # two columns the assistant actually writes with are read, so nothing
        # that grants access to the mailbox can reach the model provider.
        profile_res = supabase.table("profiles").select("full_name, signature").eq("id", user_id).execute()
        if profile_res.data:
            profile_data = profile_res.data[0]
            print(f"DEBUG: Profile Found - {profile_data.get('full_name')}")
        else:
            print(f"DEBUG: No Profile found for ID: {user_id}")

        # 2. Load memory for THIS conversation only (not all of the user's chats)
        history_res = supabase.table("chat_messages") \
            .select("role", "content") \
            .eq("conversation_id", conversation_id) \
            .eq("user_id", user_id) \
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
            client_date=req.client_date,
            user_input=req.message,
            profile_data=profile_data,
            chat_history=chat_history
        )

        # 4. Save both messages under this conversation
        new_msgs = [
            {"user_id": user_id, "role": "user", "content": req.message, "conversation_id": conversation_id},
            {"user_id": user_id, "role": "assistant", "content": ai_response.get("content", ""), "conversation_id": conversation_id},
        ]
        supabase.table("chat_messages").insert(new_msgs).execute()

        # 5. Bump the conversation so it sorts to the top of the sidebar
        try:
            supabase.table("conversations").update(
                {"updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", conversation_id).eq("user_id", user_id).execute()
        except Exception as bump_err:
            print(f"DEBUG: updated_at bump failed: {bump_err}")

        # Return the conversation id so the frontend can keep the thread active
        ai_response["conversation_id"] = conversation_id
        return ai_response

    except Exception as e:
        print(f"AI ERROR: {e}")
        raise HTTPException(status_code=500, detail=str(e))
