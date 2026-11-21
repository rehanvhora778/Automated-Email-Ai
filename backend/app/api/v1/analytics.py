"""Real Gmail analytics — volume, daily trend, category mix, top senders.

Every number comes straight from the Gmail API: message counts are exact
(ids listed per query, capped for safety), category/unread counts come from
label metadata, and lifetime totals from the user's Gmail profile.
"""
from collections import Counter
from datetime import datetime, timedelta
from email.utils import parseaddr

from fastapi import APIRouter
from googleapiclient.errors import HttpError

from app.api.deps import CurrentUser
from app.api.v1.inbox import _load_gmail
from app.services.gmail_service import NEEDS_REAUTH, RATE_LIMITED, describe_google_error

router = APIRouter()

# Stop paginating count queries past this many messages.
COUNT_CAP = 1000

# Gmail's five inbox categories with the display name + chart color.
CATEGORY_LABELS = [
    ("CATEGORY_PERSONAL", "Primary", "#6366f1"),
    ("CATEGORY_SOCIAL", "Social", "#10b981"),
    ("CATEGORY_PROMOTIONS", "Promotions", "#f43f5e"),
    ("CATEGORY_UPDATES", "Updates", "#f59e0b"),
    ("CATEGORY_FORUMS", "Forums", "#22d3ee"),
]


def _count(service, query, cap=COUNT_CAP):
    """Exact message count for a Gmail query. Returns (count, hit_cap)."""
    total, page_token = 0, None
    while True:
        kwargs = {"userId": "me", "q": query, "maxResults": 500}
        if page_token:
            kwargs["pageToken"] = page_token
        resp = service.users().messages().list(**kwargs).execute()
        total += len(resp.get("messages", []))
        page_token = resp.get("nextPageToken")
        if not page_token:
            return total, False
        if total >= cap:
            return total, True


def _label_total(service, label_id, field="messagesTotal"):
    """Message count carried by one Gmail system label.

    A label the mailbox does not have is honestly zero — Gmail only creates a
    category label once something lands in it. Every other failure means the
    number is unknown, not nought, so it travels up to the route's handler
    instead of being dressed up as an empty mailbox.
    """
    try:
        label = service.users().labels().get(userId="me", id=label_id).execute()
    except HttpError as e:
        if getattr(getattr(e, "resp", None), "status", None) == 404:
            return 0
        raise
    return label.get(field, 0)


def _top_senders(service, max_messages=50, top_n=5):
    """Most frequent senders across the latest inbox messages (one batched call)."""
    listing = service.users().messages().list(
        userId="me", labelIds=["INBOX"], maxResults=max_messages
    ).execute()
    ids = [m["id"] for m in listing.get("messages", [])]
    if not ids:
        return []

    froms = []

    def _collect(_rid, resp, err):
        if err or not resp:
            return
        for h in resp.get("payload", {}).get("headers", []):
            if h.get("name", "").lower() == "from":
                froms.append(h.get("value", ""))

    batch = service.new_batch_http_request(callback=_collect)
    for mid in ids:
        batch.add(service.users().messages().get(
            userId="me", id=mid, format="metadata", metadataHeaders=["From"]
        ))
    batch.execute()

    counts, names = Counter(), {}
    for raw in froms:
        name, email = parseaddr(raw or "")
        email = (email or "").lower()
        if not email:
            continue
        counts[email] += 1
        if name and email not in names:
            names[email] = name

    return [
        {"email": email, "name": names.get(email) or email.split("@")[0], "count": n}
        for email, n in counts.most_common(top_n)
    ]


@router.get("/overview")
def analytics_overview(user_id: CurrentUser):
    service, _user_name, linked = _load_gmail(user_id)
    if not linked:
        return {"gmail_linked": False}
    if service is None:
        return {"gmail_linked": True, "needs_reauth": True,
                "error": "Google credentials not configured"}

    try:
        profile = service.users().getProfile(userId="me").execute()

        unread = _label_total(service, "UNREAD", "messagesUnread")
        inbox_total = _label_total(service, "INBOX")
        categories = [
            {"name": name, "count": _label_total(service, label_id), "color": color}
            for label_id, name, color in CATEGORY_LABELS
        ]

        # Exact sent/received volume over the last 30 days.
        now = datetime.now()
        since_30d = int((now - timedelta(days=30)).timestamp())
        sent_30d, sent_capped = _count(service, f"in:sent after:{since_30d}")
        received_30d, recv_capped = _count(service, f"in:inbox after:{since_30d}")

        # Per-day sent/received for the last 7 days (epoch bounds = exact windows).
        midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
        daily = []
        for i in range(6, -1, -1):
            start = midnight - timedelta(days=i)
            end = start + timedelta(days=1)
            window = f"after:{int(start.timestamp())} before:{int(end.timestamp())}"
            sent, _ = _count(service, f"in:sent {window}", cap=500)
            received, _ = _count(service, f"in:inbox {window}", cap=500)
            daily.append({"label": start.strftime("%a"), "sent": sent, "received": received})

        top_senders = _top_senders(service)

    except Exception as e:
        # A quota and a revoked grant both arrive here, and only one of them is
        # fixed by linking Gmail again, so the answer says which it was. The
        # raw text can carry internal ids and stays in the log.
        print(f"analytics_overview error: {e}")
        kind, message = describe_google_error(e)
        return {"gmail_linked": True, "needs_reauth": kind == NEEDS_REAUTH,
                "rate_limited": kind == RATE_LIMITED, "error": message}

    return {
        "gmail_linked": True,
        "needs_reauth": False,
        "email_address": profile.get("emailAddress", ""),
        "totals": {
            "messages": profile.get("messagesTotal", 0),
            "threads": profile.get("threadsTotal", 0),
            "inbox": inbox_total,
            "unread": unread,
        },
        "sent_30d": sent_30d,
        "sent_30d_capped": sent_capped,
        "received_30d": received_30d,
        "received_30d_capped": recv_capped,
        "daily": daily,
        "categories": categories,
        "top_senders": top_senders,
    }
