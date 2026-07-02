"""Real contacts derived from Gmail — the people you actually email.

Aggregates senders from recent inbox mail and recipients from recent sent
mail (one batched metadata request each), so counts, names and last-contact
times are all real.
"""
from email.utils import getaddresses, parseaddr

from fastapi import APIRouter

from app.api.v1.inbox import _load_gmail

router = APIRouter()


def _batch_headers(service, message_ids, headers):
    """Batched metadata fetch. Returns a list of message resources."""
    results = []

    def _collect(_rid, resp, err):
        if not err and resp:
            results.append(resp)

    batch = service.new_batch_http_request(callback=_collect)
    for mid in message_ids:
        batch.add(service.users().messages().get(
            userId="me", id=mid, format="metadata", metadataHeaders=headers
        ))
    batch.execute()
    return results


def _header(msg, name):
    for h in msg.get("payload", {}).get("headers", []):
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


@router.get("/list")
async def contacts_list(user_id: str, max_results: int = 100):
    service, _user_name, linked = _load_gmail(user_id)
    if not linked:
        return {"gmail_linked": False, "contacts": []}
    if service is None:
        return {"gmail_linked": True, "needs_reauth": True,
                "error": "Google credentials not configured", "contacts": []}

    try:
        own_email = service.users().getProfile(userId="me").execute().get("emailAddress", "").lower()

        inbox_ids = [m["id"] for m in service.users().messages().list(
            userId="me", labelIds=["INBOX"], maxResults=max_results
        ).execute().get("messages", [])]
        sent_ids = [m["id"] for m in service.users().messages().list(
            userId="me", labelIds=["SENT"], maxResults=min(max_results, 50)
        ).execute().get("messages", [])]

        contacts = {}  # email -> {name, received, sent, last_ms}

        def _touch(name, email, kind, ts_ms):
            email = (email or "").lower().strip()
            if not email or email == own_email:
                return
            c = contacts.setdefault(email, {"name": "", "received": 0, "sent": 0, "last_ms": 0})
            c[kind] += 1
            c["last_ms"] = max(c["last_ms"], ts_ms)
            if name and not c["name"]:
                c["name"] = name

        for msg in _batch_headers(service, inbox_ids, ["From"]):
            ts = int(msg.get("internalDate", 0))
            name, email = parseaddr(_header(msg, "From"))
            _touch(name, email, "received", ts)

        for msg in _batch_headers(service, sent_ids, ["To"]):
            ts = int(msg.get("internalDate", 0))
            for name, email in getaddresses([_header(msg, "To")]):
                _touch(name, email, "sent", ts)

    except Exception as e:
        print(f"contacts_list error: {e}")
        return {"gmail_linked": True, "needs_reauth": True, "error": str(e), "contacts": []}

    ranked = sorted(
        contacts.items(),
        # People you've written to first, then by how much you hear from them.
        key=lambda kv: (kv[1]["sent"] > 0, kv[1]["received"] + kv[1]["sent"], kv[1]["last_ms"]),
        reverse=True,
    )[:24]

    return {
        "gmail_linked": True,
        "needs_reauth": False,
        "contacts": [
            {
                "name": c["name"] or email.split("@")[0],
                "email": email,
                "domain": email.split("@")[-1],
                "received": c["received"],
                "sent": c["sent"],
                "count": c["received"] + c["sent"],
                "last_ms": c["last_ms"],
            }
            for email, c in ranked
        ],
    }
