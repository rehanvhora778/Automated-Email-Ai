"""Real notifications from Gmail — your latest unread inbox mail.

Each unread message becomes a notification, tagged with Gmail's own
category label and importance flag. "Mark all read" really removes the
UNREAD label via batchModify (needs the gmail.modify scope).
"""
from email.utils import parseaddr

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.api.deps import CurrentUser
from app.api.v1.inbox import _load_gmail
from app.services.gmail_service import NEEDS_REAUTH, RATE_LIMITED, describe_google_error

router = APIRouter()

CATEGORY_BY_LABEL = {
    "CATEGORY_SOCIAL": "social",
    "CATEGORY_PROMOTIONS": "promotions",
    "CATEGORY_UPDATES": "updates",
    "CATEGORY_FORUMS": "forums",
}


class ReadAllRequest(BaseModel):
    message_ids: list[str]


@router.get("/list")
def notifications_list(
    user_id: CurrentUser,
    # One metadata fetch per id goes into the batch below, so the ceiling keeps
    # a single request from asking Gmail for an unbounded page.
    max_results: int = Query(25, ge=1, le=100),
):
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
        # Only a dead or too-narrow grant is worth a re-link prompt; a quota
        # arrives with the same 403 and clears itself.
        kind, message = describe_google_error(e)
        return {"gmail_linked": True, "needs_reauth": kind == NEEDS_REAUTH,
                "rate_limited": kind == RATE_LIMITED, "error": message, "notifications": []}

    return {"gmail_linked": True, "needs_reauth": False, "notifications": items}


@router.post("/read_all")
def notifications_read_all(user_id: CurrentUser, req: ReadAllRequest):
    """Remove the UNREAD label from the given messages in one call."""
    service, _user_name, linked = _load_gmail(user_id)
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
        # A missing gmail.modify scope and a quota both come back as 403, so
        # the status here is chosen from the classification: the UI reads 403
        # as "re-link Gmail" and shows the message for anything else.
        print(f"notifications_read_all error: {e}")
        kind, message = describe_google_error(e)
        if kind == NEEDS_REAUTH:
            raise HTTPException(status_code=403, detail=message)
        if kind == RATE_LIMITED:
            raise HTTPException(status_code=429, detail=message)
        raise HTTPException(status_code=500, detail=message)
