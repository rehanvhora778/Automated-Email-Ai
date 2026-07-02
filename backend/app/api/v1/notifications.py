"""Real notifications from Gmail — your latest unread inbox mail.

Each unread message becomes a notification, tagged with Gmail's own
category label and importance flag. "Mark all read" really removes the
UNREAD label via batchModify (needs the gmail.modify scope).
"""
from email.utils import parseaddr

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.api.v1.inbox import _load_gmail

router = APIRouter()

CATEGORY_BY_LABEL = {
    "CATEGORY_SOCIAL": "social",
    "CATEGORY_PROMOTIONS": "promotions",
    "CATEGORY_UPDATES": "updates",
    "CATEGORY_FORUMS": "forums",
}


class ReadAllRequest(BaseModel):
    user_id: str
    message_ids: list[str]


@router.get("/list")
async def notifications_list(user_id: str, max_results: int = 25):
    service, _user_name, linked = _load_gmail(user_id)
    if not linked:
        return {"gmail_linked": False, "notifications": []}
    if service is None:
        return {"gmail_linked": True, "needs_reauth": True,
                "error": "Google credentials not configured", "notifications": []}

    try:
        listing = service.users().messages().list(
            userId="me", labelIds=["INBOX", "UNREAD"], maxResults=max_results
        ).execute()
        ids = [m["id"] for m in listing.get("messages", [])]

        items = []

        def _collect(_rid, msg, err):
            if err or not msg:
                return
            headers = msg.get("payload", {}).get("headers", [])
            labels = msg.get("labelIds", [])
            raw_from = next(
                (h.get("value", "") for h in headers if h.get("name", "").lower() == "from"), "")
            subject = next(
                (h.get("value", "") for h in headers if h.get("name", "").lower() == "subject"),
                "(no subject)")
            name, email = parseaddr(raw_from)
            category = next(
                (v for k, v in CATEGORY_BY_LABEL.items() if k in labels), "primary")
            items.append({
                "id": msg.get("id"),
                "sender_name": name or (email.split("@")[0] if email else "Unknown"),
                "sender_email": email,
                "subject": subject,
                "snippet": msg.get("snippet", ""),
                "time_ms": int(msg.get("internalDate", 0)),
                "category": category,
                "important": "IMPORTANT" in labels,
                "starred": "STARRED" in labels,
            })

        batch = service.new_batch_http_request(callback=_collect)
        for mid in ids:
            batch.add(service.users().messages().get(
                userId="me", id=mid, format="metadata", metadataHeaders=["From", "Subject"]
            ))
        if ids:
            batch.execute()

        items.sort(key=lambda n: n["time_ms"], reverse=True)

    except Exception as e:
        print(f"notifications_list error: {e}")
        return {"gmail_linked": True, "needs_reauth": True, "error": str(e), "notifications": []}

    return {"gmail_linked": True, "needs_reauth": False, "notifications": items}


@router.post("/read_all")
async def notifications_read_all(req: ReadAllRequest):
    """Remove the UNREAD label from the given messages in one call."""
    service, _user_name, linked = _load_gmail(req.user_id)
    if not linked or service is None:
        raise HTTPException(status_code=401, detail="Gmail not linked")
    if not req.message_ids:
        return {"status": "success", "marked": 0}

    try:
        service.users().messages().batchModify(
            userId="me",
            body={"ids": req.message_ids[:1000], "removeLabelIds": ["UNREAD"]},
        ).execute()
        return {"status": "success", "marked": len(req.message_ids[:1000])}
    except Exception as e:
        detail = str(e)
        low = detail.lower()
        if "insufficient" in low or "scope" in low or "permission" in low or "403" in low:
            raise HTTPException(status_code=403, detail="Gmail needs re-link for modify access")
        print(f"notifications_read_all error: {e}")
        raise HTTPException(status_code=500, detail=detail)
