"""AI Inbox Summary — reads recent Gmail and returns a structured briefing.

Requires the gmail.readonly scope. Users who linked Gmail before the read
scope was added will get needs_reauth=True until they re-link.

Summarizing is strictly read-only: `/summary` never archives, deletes, replies
or sends. Mutations live behind `/action`, which the user triggers explicitly.
"""
from email.utils import parseaddr

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.db.supabase import supabase
from app.services.ai_service import SecretaryAI
from app.services.gmail_service import (
    NEEDS_REAUTH,
    RATE_LIMITED,
    build_user_gmail_service,
    credentials_to_token_data,
    describe_google_error,
)
from app.services.inbox_briefing import build_briefing
from app.services.inbox_reader import DEFAULT_ANALYZE, MAX_ANALYZE

router = APIRouter()
ai = SecretaryAI()


def _header(headers, name, default=""):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", default)
    return default


def _split_sender(from_value):
    """Turn a raw From header into (display_name, email)."""
    name, email = parseaddr(from_value or "")
    if not name:
        name = (email.split("@")[0] if email else from_value) or "Unknown"
    return name, email


def _load_gmail(user_id):
    """Return (service, user_name, linked) or raise HTTPException. service may be None."""
    try:
        res = supabase.from_("profiles").select("gmail_token, full_name").eq("id", user_id).execute()
    except Exception as e:
        # e.g. a malformed (non-UUID) id — surface a clean 400 instead of a 500.
        raise HTTPException(status_code=400, detail="Invalid user id") from e
    if not res.data:
        raise HTTPException(status_code=404, detail="Profile not found")
    profile = res.data[0]
    token = profile.get("gmail_token")
    if not token:
        return None, profile.get("full_name") or "there", False

    def _save(creds, user_id=user_id, previous=token):
        # A Google access token lives about an hour, so a stored one is stale
        # far more often than not. Writing the refreshed token back turns the
        # refresh into an hourly event instead of something every request pays
        # for, and the row keeps the refresh token and scopes it already had.
        supabase.from_("profiles").update(
            {"gmail_token": credentials_to_token_data(creds, previous)}
        ).eq("id", user_id).execute()

    service = build_user_gmail_service(token, on_refresh=_save)
    return service, profile.get("full_name") or "there", True


# Tab -> Gmail search query. These mirror Gmail's own categories (Primary,
# Social, Promotions, Updates, Forums) and views (Important, Starred, Unread);
# newsletters is the one keyword-based convenience filter.
TAB_QUERIES = {
    "primary": "in:inbox category:primary",
    "important": "is:important",
    "starred": "is:starred",
    "unread": "in:inbox is:unread",
    "social": "category:social",
    "promotions": "category:promotions",
    "updates": "category:updates",
    "forums": "category:forums",
    "newsletters": "unsubscribe OR newsletter OR digest",
}

# Action -> Gmail label modifications. "trash" is handled separately.
ACTION_LABELS = {
    "archive": {"remove": ["INBOX"]},
    "mark_important": {"add": ["IMPORTANT"]},
    "mark_unimportant": {"remove": ["IMPORTANT"]},
    "mark_read": {"remove": ["UNREAD"]},
    "mark_unread": {"add": ["UNREAD"]},
    "star": {"add": ["STARRED"]},
    "unstar": {"remove": ["STARRED"]},
}


class InboxActionRequest(BaseModel):
    message_id: str
    action: str


@router.get("/summary")
async def inbox_summary(
    user_id: CurrentUser,
    max_results: int = Query(DEFAULT_ANALYZE, ge=1, le=MAX_ANALYZE),
):
    """Classify the unread inbox and return a decision-ready briefing.

    `max_results` caps how many unread messages are analysed in one pass, and
    is the dial to turn if the briefing feels slow. The response's `scope`
    block reports how many were covered out of the mailbox total, so the UI
    never implies more was read than actually was.
    """
    service, user_name, linked = _load_gmail(user_id)
    if not linked:
        return {"gmail_linked": False, "user_name": user_name}
    if service is None:
        return {"gmail_linked": True, "needs_reauth": True,
                "error": "Google credentials not configured", "user_name": user_name}

    try:
        briefing = build_briefing(service, ai, user_name, max_results)
    except Exception as e:
        # What went wrong decides what the UI may offer. Re-linking repairs a
        # dead or too-narrow grant, but a throttled mailbox is perfectly
        # healthy and re-linking it changes nothing, so the two must not share
        # an answer. Google's own wording can name quotas and internal ids, so
        # it goes to the log and the caller gets the fixed sentence.
        print(f"inbox_summary read error: {e}")
        kind, message = describe_google_error(e)
        return {"gmail_linked": True, "needs_reauth": kind == NEEDS_REAUTH,
                "rate_limited": kind == RATE_LIMITED, "error": message,
                "user_name": user_name}

    counts, scope = briefing["counts"], briefing["scope"]
    return {
        "gmail_linked": True,
        "needs_reauth": False,
        "user_name": user_name,
        "stats": {
            "unread": scope["unread_total"],
            "analyzed": scope["analyzed"],
            "high_priority": counts["high_priority"],
            "needs_reply": counts["needs_reply"],
            "action_required": counts["action_required"],
            "delivery_failures": counts["delivery_failures"],
            "grouped": counts["grouped"],
        },
        **briefing,
    }


@router.get("/messages")
async def inbox_messages(
    user_id: CurrentUser,
    tab: str = "important",
    max_results: int = Query(20, ge=1, le=100),
):
    """List messages for a given inbox tab with their read/star/important flags."""
    service, _user_name, linked = _load_gmail(user_id)
    if not linked:
        return {"gmail_linked": False, "messages": []}
    if service is None:
        return {"gmail_linked": True, "needs_reauth": True,
                "error": "Google credentials not configured", "messages": []}

    try:
        if tab in TAB_QUERIES:
            listing = service.users().messages().list(
                userId="me", q=TAB_QUERIES[tab], maxResults=max_results
            ).execute()
        else:  # overview / unknown -> plain inbox
            listing = service.users().messages().list(
                userId="me", labelIds=["INBOX"], maxResults=max_results
            ).execute()

        messages = []
        for m in listing.get("messages", []):
            mid = m["id"]
            msg = service.users().messages().get(
                userId="me", id=mid, format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            ).execute()
            headers = msg.get("payload", {}).get("headers", [])
            labels = msg.get("labelIds", [])
            name, email = _split_sender(_header(headers, "From"))
            messages.append({
                "id": mid,
                "thread_id": msg.get("threadId"),
                "sender_name": name,
                "sender_email": email,
                "subject": _header(headers, "Subject", "(no subject)"),
                "snippet": msg.get("snippet", ""),
                "date": _header(headers, "Date"),
                "unread": "UNREAD" in labels,
                "starred": "STARRED" in labels,
                "important": "IMPORTANT" in labels,
            })
        return {"gmail_linked": True, "needs_reauth": False, "messages": messages}

    except Exception as e:
        print(f"inbox_messages error: {e}")
        # Only a dead or too-narrow grant is worth a re-link prompt; a quota
        # answers with the same 403 and needs patience instead.
        kind, message = describe_google_error(e)
        return {"gmail_linked": True, "needs_reauth": kind == NEEDS_REAUTH,
                "rate_limited": kind == RATE_LIMITED, "error": message, "messages": []}


@router.post("/action")
async def inbox_action(user_id: CurrentUser, req: InboxActionRequest):
    """Perform a single Gmail action (archive/trash/label/star/read) on a message.

    Requires the gmail.modify scope; users linked before it was added get a
    403 so the UI can prompt a re-link.
    """
    service, _user_name, linked = _load_gmail(user_id)
    if not linked or service is None:
        raise HTTPException(status_code=401, detail="Gmail not linked")

    try:
        if req.action == "trash":
            service.users().messages().trash(userId="me", id=req.message_id).execute()
        elif req.action in ACTION_LABELS:
            spec = ACTION_LABELS[req.action]
            body = {}
            if spec.get("add"):
                body["addLabelIds"] = spec["add"]
            if spec.get("remove"):
                body["removeLabelIds"] = spec["remove"]
            service.users().messages().modify(userId="me", id=req.message_id, body=body).execute()
        else:
            raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")
        return {"status": "success", "action": req.action, "message_id": req.message_id}

    except HTTPException:
        raise
    except Exception as e:
        # Gmail answers both "this token lacks gmail.modify" and "you are
        # going too fast" with a 403, so neither the status nor the exception
        # text tells them apart on its own. The status chosen here is the UI's
        # whole signal: it reads 403 as "re-link Gmail" and shows the message
        # as it stands for anything else.
        print(f"inbox_action error: {e}")
        kind, message = describe_google_error(e)
        if kind == NEEDS_REAUTH:
            raise HTTPException(status_code=403, detail=message)
        if kind == RATE_LIMITED:
            raise HTTPException(status_code=429, detail=message)
        raise HTTPException(status_code=500, detail=message)
