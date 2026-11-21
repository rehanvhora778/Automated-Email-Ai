from fastapi import APIRouter, HTTPException
from datetime import datetime, timedelta, timezone
from app.api.deps import CurrentUser
from app.models.chat import ChatRequest
from app.services.ai_service import SecretaryAI
from app.services.llm import LLMError
from app.db.supabase import supabase

router = APIRouter()
ai_secretary = SecretaryAI()


# Declared `def`, not `async def`: every call below (Supabase, the LLM) is a
# blocking HTTP request, and FastAPI runs sync routes in a worker thread. As
# `async def` they ran on the event loop and froze every other request on the
# server — inbox, analytics, sign-in — for as long as the model took to answer.
@router.post("/")
def chat_with_secretary(req: ChatRequest, user_id: CurrentUser):
    profile_data = {"full_name": "User", "signature": ""}
    chat_history = []

    # 0. An existing thread has to belong to the caller before it becomes the
    # model's memory or receives their messages. A new thread is only created
    # once there is an answer to put in it, so a failed request leaves no
    # empty conversation behind in the sidebar.
    conversation_id = req.conversation_id
    if conversation_id:
        # The id arrives as an opaque string in the request body, so it has to
        # be matched against the caller -- otherwise any id would open someone
        # else's thread and drop this exchange into it.
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

    try:
        # 1. Profile
        # The whole row is rendered into the system prompt, and the row
        # carries `gmail_token` -- a long-lived Google refresh token. Only the
        # two columns the assistant actually writes with are read, so nothing
        # that grants access to the mailbox can reach the model provider.
        profile_res = supabase.table("profiles").select("full_name, signature").eq("id", user_id).execute()
        if profile_res.data:
            profile_data = profile_res.data[0]
        else:
            print(f"DEBUG: No Profile found for ID: {user_id}")

        # 2. Memory for THIS conversation only (not all of the user's chats)
        if conversation_id:
            history_res = supabase.table("chat_messages") \
                .select("role", "content") \
                .eq("conversation_id", conversation_id) \
                .eq("user_id", user_id) \
                .order("created_at", desc=True) \
                .limit(10) \
                .execute()
            if history_res.data:
                chat_history = history_res.data[::-1]
    except Exception as e:
        print(f"Database Warning: {e}")

    # 3. AI response. A failure is an HTTP error, not a reply: it must not be
    # rendered as the assistant's answer, offered for sending, or stored as
    # memory that the model would read back on the next turn.
    try:
        ai_response = ai_secretary.generate_response(
            client_date=req.client_date,
            user_input=req.message,
            profile_data=profile_data,
            chat_history=chat_history,
        )
    except LLMError as e:
        print(f"chat: AI unavailable ({e.kind}): {e.detail}")
        raise HTTPException(status_code=503, detail=e.user_message)

    # 4. Persist. The draft is already written, so a storage failure costs the
    # user their history for this turn, never the answer itself.
    if not conversation_id:
        title = (req.message or "New conversation").strip()[:40] or "New conversation"
        try:
            conv = supabase.table("conversations").insert({
                "user_id": user_id,
                "title": title,
            }).execute()
            conversation_id = conv.data[0]["id"]
        except Exception as e:
            print(f"DEBUG: conversation insert failed: {e}")
            conversation_id = None

    if conversation_id:
        # Explicit, ordered timestamps: inserted together, both rows would get
        # the same now() and history could replay the answer before the question.
        asked_at = datetime.now(timezone.utc)
        answered_at = asked_at + timedelta(milliseconds=1)
        try:
            supabase.table("chat_messages").insert([
                {"user_id": user_id, "role": "user", "content": req.message,
                 "conversation_id": conversation_id, "created_at": asked_at.isoformat()},
                {"user_id": user_id, "role": "assistant", "content": ai_response.get("content", ""),
                 "conversation_id": conversation_id, "created_at": answered_at.isoformat()},
            ]).execute()
        except Exception as e:
            print(f"DEBUG: chat_messages insert failed: {e}")

        # 5. Bump the conversation so it sorts to the top of the sidebar
        try:
            supabase.table("conversations").update(
                {"updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", conversation_id).eq("user_id", user_id).execute()
        except Exception as bump_err:
            print(f"DEBUG: updated_at bump failed: {bump_err}")

    # The conversation id lets the frontend keep the thread active.
    ai_response["conversation_id"] = conversation_id
    return ai_response
