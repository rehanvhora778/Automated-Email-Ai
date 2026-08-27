"""Read-only Gmail evidence extraction for the inbox briefing.

Everything in this module only READS. It never modifies, archives, deletes,
sends or marks anything — `messages.get` does not clear the UNREAD label, so a
briefing leaves the mailbox exactly as it found it.

The point of this layer is to hand the model *facts* instead of guesses. The
old briefing saw a 160-character snippet per email and had to invent the rest;
here every hard fact (who, when, which Gmail category, whether the message was
addressed to the user directly, why a delivery failed) is extracted from the
API and the headers, and only the judgement calls are left to the LLM.
"""
import base64
import html as html_lib
import re
from datetime import datetime, timezone
from email.parser import HeaderParser
from email.utils import getaddresses, parseaddr

# Headers worth the request. Gmail returns exactly these with format=metadata,
# so asking for more costs nothing beyond a little response size.
METADATA_HEADERS = [
    "From", "To", "Cc", "Subject", "Date", "Reply-To",
    "List-Unsubscribe", "List-Id", "Precedence", "Auto-Submitted",
    "X-Failed-Recipients", "Content-Type", "In-Reply-To", "References",
    "Return-Path",
]

# Gmail's own category labels — a real classifier we get for free.
CATEGORY_NAMES = {
    "CATEGORY_PERSONAL": "Primary",
    "CATEGORY_SOCIAL": "Social",
    "CATEGORY_PROMOTIONS": "Promotions",
    "CATEGORY_UPDATES": "Updates",
    "CATEGORY_FORUMS": "Forums",
}

# Keep at least this many messages in a briefing: with 2 unread emails the
# newest read mail is still useful context for "what is going on in here".
MIN_CONTEXT = 8

# Full bodies are fetched only for the messages whose classification actually
# depends on the body. Bulk mail is grouped from sender + subject alone.
BODY_BUDGET = 12
BODY_CHARS = 1400

# Gmail batches cap at 100 sub-requests.
BATCH_LIMIT = 100


# ---------------------------------------------------------------------------
# Small header / MIME helpers
# ---------------------------------------------------------------------------

def header(headers, name, default=""):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", default)
    return default


def split_sender(from_value):
    """Turn a raw From header into (display_name, email)."""
    name, addr = parseaddr(from_value or "")
    if not name:
        name = (addr.split("@")[0] if addr else from_value) or "Unknown"
    return name, addr


def _canonical(address):
    """Lower-case an address and drop any +tag, so plus-aliases still match."""
    address = (address or "").lower().strip()
    if "@" not in address:
        return address
    local, domain = address.rsplit("@", 1)
    return f"{local.split('+', 1)[0]}@{domain}"


def _addresses(raw):
    return {_canonical(a) for _n, a in getaddresses([raw or ""]) if a}


def _decode(data):
    if not data:
        return ""
    try:
        return base64.urlsafe_b64decode(data.encode()).decode("utf-8", "replace")
    except Exception:
        return ""


_TAG_BREAKS = re.compile(r"(?i)</?(?:br|p|div|tr|li|h[1-6]|table)[^>]*>")
_TAG_DROP = re.compile(r"(?is)<(script|style|head)[^>]*>.*?</\1>")
_TAGS = re.compile(r"(?s)<[^>]+>")
_INLINE_WS = re.compile(r"[ \t\r\f\v]+")
_BLANK_RUNS = re.compile(r"\n{3,}")
_QUOTE_MARKER = re.compile(r"\n\s*(On .{0,120}wrote:|-{2,} ?Forwarded message|_{10,})")


def html_to_text(raw):
    """Flatten an HTML email body into readable plain text."""
    if not raw:
        return ""
    text = _TAG_DROP.sub(" ", raw)
    text = _TAG_BREAKS.sub("\n", text)
    text = _TAGS.sub(" ", text)
    text = html_lib.unescape(text)
    text = _INLINE_WS.sub(" ", text)
    return _BLANK_RUNS.sub("\n\n", text).strip()


def _walk(part):
    yield part
    for child in part.get("parts") or []:
        yield from _walk(child)


def extract_body_text(payload, limit=BODY_CHARS):
    """Best plain-text rendering of a message payload, truncated to `limit`.

    Returns (text, truncated). Prefers a real text/plain part and falls back to
    flattening text/html. Attachment parts (those with a filename) are skipped.
    """
    plain, html_parts = [], []
    for part in _walk(payload or {}):
        if part.get("filename"):
            continue
        mime = part.get("mimeType", "")
        data = (part.get("body") or {}).get("data")
        if not data:
            continue
        if mime == "text/plain":
            plain.append(_decode(data))
        elif mime == "text/html":
            html_parts.append(_decode(data))

    text = "\n".join(t for t in plain if t).strip()
    if not text:
        text = html_to_text("\n".join(html_parts))

    # Quoted history rarely helps and eats the budget, so drop everything from
    # the first quote marker on — but only once there is real text before it.
    cut = _QUOTE_MARKER.search(text)
    if cut and cut.start() > 120:
        text = text[: cut.start()]

    text = _BLANK_RUNS.sub("\n\n", text).strip()
    if len(text) > limit:
        return text[:limit].rstrip() + " …", True
    return text, False


# ---------------------------------------------------------------------------
# Listing + metadata
# ---------------------------------------------------------------------------

def _list_ids(service, query, limit):
    if limit <= 0:
        return []
    resp = service.users().messages().list(
        userId="me", q=query, maxResults=min(limit, BATCH_LIMIT)
    ).execute()
    return [m["id"] for m in resp.get("messages", [])][:limit]


def _batch_get(service, ids, **params):
    """Fetch many messages in one HTTP batch. Returns {id: message}."""
    out = {}
    if not ids:
        return out

    def collect(_request_id, resp, err):
        if err or not resp:
            if err:
                print(f"inbox_reader: batch item failed: {err}")
            return
        out[resp.get("id")] = resp

    for start in range(0, len(ids), BATCH_LIMIT):
        batch = service.new_batch_http_request(callback=collect)
        for mid in ids[start:start + BATCH_LIMIT]:
            batch.add(service.users().messages().get(userId="me", id=mid, **params))
        batch.execute()
    return out


def my_address(service):
    """The signed-in mailbox address — lets us tell 'to me' from 'to a list'."""
    try:
        profile = service.users().getProfile(userId="me").execute()
        return _canonical(profile.get("emailAddress"))
    except Exception as e:
        print(f"inbox_reader: profile lookup warning: {e}")
        return ""


def unread_total(service, fallback=0):
    """Mailbox-wide unread count from the UNREAD label."""
    try:
        label = service.users().labels().get(userId="me", id="UNREAD").execute()
        return label.get("messagesUnread", fallback)
    except Exception:
        return fallback


# ---------------------------------------------------------------------------
# Evidence records
# ---------------------------------------------------------------------------

_FAILURE_SUBJECTS = re.compile(
    r"(?i)\b(delivery status notification|undeliverable|undelivered mail|"
    r"delivery has failed|mail delivery (failed|subsystem)|returned to sender|"
    r"failure notice|message not delivered|delivery incomplete)\b"
)
_DAEMON = re.compile(r"(?i)^(mailer-daemon|postmaster|mail-daemon)@")


def _looks_like_bounce(headers, sender_email, subject, labels):
    """Header-level test for a delivery status notification.

    Deliberately generous: a false positive costs one extra body fetch, and the
    real DSN parse afterwards is what decides whether anything gets reported.
    """
    if header(headers, "X-Failed-Recipients"):
        return True
    if "multipart/report" in header(headers, "Content-Type").lower():
        return True
    if _DAEMON.match(sender_email or ""):
        return True
    if header(headers, "Auto-Submitted").lower().startswith("auto-replied") \
            and _FAILURE_SUBJECTS.search(subject or ""):
        return True
    return bool(_FAILURE_SUBJECTS.search(subject or "")) and "SENT" not in labels


def _record(msg, ref, me):
    payload = msg.get("payload") or {}
    headers = payload.get("headers") or []
    labels = msg.get("labelIds") or []
    sender_name, sender_email = split_sender(header(headers, "From"))
    subject = header(headers, "Subject", "(no subject)")

    try:
        date_ms = int(msg.get("internalDate") or 0)
    except (TypeError, ValueError):
        date_ms = 0

    to_addrs, cc_addrs = _addresses(header(headers, "To")), _addresses(header(headers, "Cc"))
    if me and me in to_addrs:
        addressing = "direct"
    elif me and me in cc_addrs:
        addressing = "cc"
    elif to_addrs or cc_addrs:
        addressing = "list"
    else:
        addressing = "unknown"

    category = next((CATEGORY_NAMES[l] for l in labels if l in CATEGORY_NAMES), "")
    # A List-Id means a real subscribed mailing list, which is a stronger and
    # narrower signal than List-Unsubscribe (marketing blasts carry that too).
    list_mail = bool(header(headers, "List-Id"))
    bulk = bool(
        list_mail
        or header(headers, "List-Unsubscribe")
        or header(headers, "Precedence").lower() in {"bulk", "list", "junk"}
        or category == "Promotions"
    )

    return {
        "ref": ref,
        "id": msg.get("id", ""),
        "thread_id": msg.get("threadId", ""),
        "sender_name": sender_name,
        "sender_email": sender_email,
        "subject": subject,
        "date": header(headers, "Date"),
        "date_ms": date_ms,
        "snippet": html_lib.unescape(msg.get("snippet") or ""),
        "unread": "UNREAD" in labels,
        "starred": "STARRED" in labels,
        "important": "IMPORTANT" in labels,
        "category": category,
        "addressing": addressing,
        "bulk": bulk,
        "list_mail": list_mail,
        "automated": header(headers, "Auto-Submitted").lower().startswith("auto"),
        "in_thread": bool(header(headers, "In-Reply-To") or header(headers, "References")),
        "bounce_candidate": _looks_like_bounce(headers, sender_email, subject, labels),
        "failed_recipients": header(headers, "X-Failed-Recipients"),
        "body": "",
        "body_truncated": False,
        "bounce": None,
    }


def _need_body_score(rec):
    """How much this message's classification depends on reading its body."""
    if rec["bounce_candidate"]:
        return 1000
    base = {"Promotions": 8, "Social": 25, "Forums": 25, "Updates": 55, "Primary": 80}
    score = base.get(rec["category"], 70)
    if rec["bulk"] and rec["category"] != "Updates":
        score = min(score, 20)
    if rec["addressing"] == "direct":
        score += 15
    if rec["in_thread"]:
        score += 10
    if rec["important"]:
        score += 20
    if rec["starred"]:
        score += 15
    if rec["unread"]:
        score += 5
    return score


def read_inbox(service, max_results=25, top_up=True):
    """Collect the evidence a briefing needs. Returns (records, unread_total).

    Unread mail comes first and is what the briefing is about; when there is
    very little of it the newest read messages are added so the picture still
    makes sense. Records come back newest first.
    """
    max_results = max(1, min(int(max_results or 25), 50))
    ids = _list_ids(service, "in:inbox is:unread", max_results)
    unread_ids = set(ids)

    if top_up and len(ids) < MIN_CONTEXT:
        for mid in _list_ids(service, "in:inbox", MIN_CONTEXT + len(ids)):
            if mid not in unread_ids and len(ids) < MIN_CONTEXT:
                ids.append(mid)

    me = my_address(service)
    fetched = _batch_get(service, ids, format="metadata", metadataHeaders=METADATA_HEADERS)

    records = [_record(fetched[mid], "", me) for mid in ids if mid in fetched]
    records.sort(key=lambda r: r["date_ms"], reverse=True)
    assign_refs(records)

    _attach_bodies(service, records)
    return records, unread_total(service, fallback=len(unread_ids))


def assign_refs(records):
    """Number records E1..En. Re-run after filtering so there are no gaps —
    a missing key in the middle of the list only confuses the model."""
    for i, record in enumerate(records, start=1):
        record["ref"] = f"E{i}"
    return records


def _attach_bodies(service, records):
    """Fetch and attach full text for the messages that need it (one batch)."""
    ranked = sorted(records, key=_need_body_score, reverse=True)
    wanted = [r for r in ranked if _need_body_score(r) > 20][:BODY_BUDGET]
    wanted_ids = {r["id"] for r in wanted}
    wanted += [r for r in ranked if r["bounce_candidate"] and r["id"] not in wanted_ids]
    if not wanted:
        return

    full = _batch_get(service, [r["id"] for r in wanted], format="full")
    for rec in wanted:
        msg = full.get(rec["id"])
        if not msg:
            continue
        rec["body"], rec["body_truncated"] = extract_body_text(msg.get("payload") or {})
        if rec["bounce_candidate"]:
            rec["bounce"] = parse_bounce(msg, rec)


# ---------------------------------------------------------------------------
# Delivery failures (bounces)
# ---------------------------------------------------------------------------

# Ordered longest-prefix-first — the first matching prefix wins.
_DSN_GUIDANCE = [
    ("5.1.1", "The address does not exist on the receiving server.",
     "Check the address for a typo and resend. If it looks right, the account may have been closed — confirm the correct address another way."),
    ("5.1.", "The recipient address was rejected as invalid.",
     "Verify the recipient address and resend to a corrected one."),
    ("5.2.2", "The recipient's mailbox is full.",
     "Nothing to fix on your side — ask the recipient to clear space or reach them another way, then resend."),
    ("5.2.", "The recipient's mailbox could not accept the message.",
     "Resend later, or contact the recipient another way if it keeps failing."),
    ("5.3.4", "The message was too large for the recipient's server.",
     "Resend with the attachment shared as a link instead of a file."),
    ("5.4.", "The receiving mail server could not be reached.",
     "The recipient's domain may be misconfigured or down — confirm the domain is right and try again later."),
    ("5.7.1", "The receiving server blocked the message (policy or spam filter).",
     "Ask the recipient to allow-list you, or send from a different address — resending as-is will fail the same way."),
    ("5.7.", "The receiving server rejected the message for policy reasons.",
     "Contact the recipient another way and ask them to release or allow-list your mail."),
    ("5.5.", "The receiving server rejected the message as malformed.",
     "Resend the message; if it fails again, simplify the recipient list or attachments."),
    ("5.", "The receiving server permanently rejected the message.",
     "It will not arrive on a retry — confirm the address, then resend or reach the recipient another way."),
    ("4.", "A temporary problem stopped delivery.",
     "No action needed yet — the sending server normally retries on its own. Resend only if a permanent failure follows."),
]

_DSN_FIELD = re.compile(
    r"(?im)^(final-recipient|original-recipient|action|status|diagnostic-code)"
    r"\s*:\s*(.*(?:\n[ \t].*)*)"
)


def _dsn_fields(text):
    """First occurrence of each DSN field across all per-recipient blocks."""
    out = {}
    for name, value in _DSN_FIELD.findall(text or ""):
        key = name.lower()
        value = " ".join(value.split())
        if value and key not in out:
            out[key] = value
    return out


def _strip_addr_type(value):
    """'rfc822; someone@example.com' -> 'someone@example.com'."""
    if not value:
        return ""
    tail = value.split(";", 1)[1] if ";" in value else value
    _name, addr = parseaddr(tail.strip())
    return (addr or tail.strip()).strip("<> ")


def parse_bounce(msg, rec):
    """Extract what actually failed from a delivery status notification.

    Returns a dict of facts, or None when the message turns out not to be a
    real DSN. Every field comes from the notification itself — nothing here is
    inferred — so the briefing can report it verbatim.
    """
    payload = msg.get("payload") or {}
    dsn_text, original_headers = "", ""

    for part in _walk(payload):
        mime = (part.get("mimeType") or "").lower()
        data = (part.get("body") or {}).get("data")
        if mime == "message/delivery-status" and data:
            dsn_text += _decode(data) + "\n"
        elif mime in ("text/rfc822-headers", "message/rfc822"):
            if data:
                original_headers += _decode(data) + "\n"
            for nested in part.get("parts") or []:
                original_headers += "\n".join(
                    f"{h.get('name')}: {h.get('value')}" for h in (nested.get("headers") or [])
                ) + "\n"

    fields = _dsn_fields(dsn_text)
    status = fields.get("status", "")
    if not re.match(r"^[45]\.\d+\.\d+$", status):
        status = ""

    recipient = _strip_addr_type(fields.get("final-recipient") or fields.get("original-recipient", ""))
    if not recipient and rec.get("failed_recipients"):
        recipient = _strip_addr_type(rec["failed_recipients"].split(",")[0])

    original_subject, original_to = "", ""
    if original_headers:
        try:
            parsed = HeaderParser().parsestr(original_headers)
            original_subject = (parsed.get("Subject") or "").strip()
            original_to = ", ".join(a for _n, a in getaddresses([parsed.get("To") or ""]) if a)
        except Exception as e:
            print(f"inbox_reader: bounce header parse warning: {e}")

    # Not a DSN after all — a marketing mail about "delivery", an auto-reply, …
    if not status and not recipient and not original_subject:
        return None

    reason, advice = "", ""
    for prefix, why, what in _DSN_GUIDANCE:
        if status.startswith(prefix):
            reason, advice = why, what
            break

    return {
        "message_id": rec["id"],
        "date": rec["date"],
        "date_ms": rec["date_ms"],
        "reported_by": rec["sender_name"],
        "failed_recipient": recipient or original_to,
        "original_subject": original_subject,
        "status": status,
        "permanent": status.startswith("5") if status else None,
        "reason": reason,
        "what_to_do": advice,
        "diagnostic": fields.get("diagnostic-code", "")[:240].strip(),
        "notice_subject": rec["subject"],
    }


def collect_delivery_failures(records):
    """Every confirmed bounce among the records, newest first."""
    failures = [r["bounce"] for r in records if r.get("bounce")]
    failures.sort(key=lambda f: f.get("date_ms") or 0, reverse=True)
    return failures


def relative_age(date_ms, now=None):
    """'2h ago' / '3d ago' — gives the model a sense of how stale a mail is."""
    if not date_ms:
        return ""
    now = now or datetime.now(timezone.utc)
    minutes = int((now - datetime.fromtimestamp(date_ms / 1000, tz=timezone.utc)).total_seconds() // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes}m ago"
    if minutes < 60 * 24:
        return f"{minutes // 60}h ago"
    return f"{minutes // (60 * 24)}d ago"
