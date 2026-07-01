"""AI Inbox Summary — reads recent Gmail and returns a structured briefing.

Requires the gmail.readonly scope. Users who linked Gmail before the read
scope was added will get needs_reauth=True until they re-link.
"""
from fastapi import APIRouter, HTTPException

from app.db.supabase import supabase
from app.services.ai_service import SecretaryAI
from app.services.gmail_service import build_user_gmail_service

router = APIRouter()
ai = SecretaryAI()


def _header(headers, name, default=""):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", default)
    return default


@router.get("/summary")
async def inbox_summary(user_id: str, max_results: int = 15):
    # 1. Load the user's Gmail token + name
    res = supabase.from_("profiles").select("gmail_token, full_name").eq("id", user_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    profile = res.data[0]
    token = profile.get("gmail_token")
    user_name = profile.get("full_name") or "there"

    if not token:
        return {"gmail_linked": False, "user_name": user_name}

    # 2. Read recent inbox messages
    try:
        service = build_user_gmail_service(token)
        if service is None:
            return {"gmail_linked": True, "needs_reauth": True,
                    "error": "Google credentials not configured", "user_name": user_name}

        listing = service.users().messages().list(
            userId="me", labelIds=["INBOX"], maxResults=max_results
        ).execute()
        message_ids = [m["id"] for m in listing.get("messages", [])]

        emails, sample_unread = [], 0
        for mid in message_ids:
            msg = service.users().messages().get(
                userId="me", id=mid, format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()
            headers = msg.get("payload", {}).get("headers", [])
            labels = msg.get("labelIds", [])
            is_unread = "UNREAD" in labels
            sample_unread += 1 if is_unread else 0
            emails.append({
                "sender": _header(headers, "From"),
                "subject": _header(headers, "Subject", "(no subject)"),
                "snippet": msg.get("snippet", ""),
                "unread": is_unread,
            })

        # Accurate total unread count from the UNREAD label
        try:
            unread_label = service.users().labels().get(userId="me", id="UNREAD").execute()
            total_unread = unread_label.get("messagesUnread", sample_unread)
        except Exception:
            total_unread = sample_unread

    except Exception as e:
        # Most commonly: old token lacks the readonly scope -> user must re-link.
        print(f"inbox_summary read error: {e}")
        return {"gmail_linked": True, "needs_reauth": True, "error": str(e), "user_name": user_name}

    # 3. Summarize with the LLM
    analysis = ai.summarize_inbox(emails, user_name)

    stats = {
        "unread": total_unread,
        "high_priority": analysis.get("high_priority") or len(analysis.get("important", [])),
        "meetings_today": analysis.get("meetings_today", 0),
        "pending_followups": len(analysis.get("action_items", [])),
        "total": len(emails),
    }

    return {
        "gmail_linked": True,
        "needs_reauth": False,
        "user_name": user_name,
        "stats": stats,
        "summary": analysis.get("summary", ""),
        "important": analysis.get("important", []),
        "spam": analysis.get("spam", {"count": 0, "note": ""}),
        "newsletters": analysis.get("newsletters", {"count": 0, "note": ""}),
        "action_items": analysis.get("action_items", []),
        "suggestions": analysis.get("suggestions", []),
    }
