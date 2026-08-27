"""Assembles the inbox briefing: Gmail evidence -> LLM judgement -> checked output.

Three layers, deliberately separated:

1. `inbox_reader` pulls the facts out of Gmail (read-only).
2. `SecretaryAI.analyze_inbox` reasons over them and returns judgements only.
3. This module puts the two back together and *verifies* the result: every
   sender, subject and date is re-attached from Gmail rather than taken from the
   model, unknown references are dropped, categories and urgencies are checked
   against the allowed sets, and a stated deadline survives only if the model
   could quote the words that state it. Anything the model failed to classify
   becomes "Needs Review" instead of a guess.

Nothing here writes to the mailbox. Summarizing never archives, deletes,
replies or sends — those live behind their own explicit endpoints.
"""
import re

from app.services import inbox_reader

# Detailed cards, in the order they should be worked through.
CATEGORY_ORDER = {"Requires Action": 0, "Requires Reply": 1, "Important": 2, "Needs Review": 3}
# Rolled up into groups rather than listed one by one.
GROUPED_CATEGORIES = {"Promotional", "Newsletter", "Low Priority"}
ALL_CATEGORIES = set(CATEGORY_ORDER) | GROUPED_CATEGORIES

URGENCY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
ACTION_TYPES = {"reply", "action", "review", "read", "cleanup", "fix_delivery"}

# Tolerate the shapes a model actually returns for the category field.
_CATEGORY_ALIASES = {
    "requires action": "Requires Action", "action required": "Requires Action",
    "action": "Requires Action", "requires_action": "Requires Action",
    "requires reply": "Requires Reply", "reply required": "Requires Reply",
    "reply": "Requires Reply", "requires_reply": "Requires Reply",
    "important": "Important",
    "promotional": "Promotional", "promotion": "Promotional", "promo": "Promotional",
    "marketing": "Promotional", "spam": "Promotional",
    "newsletter": "Newsletter", "newsletters": "Newsletter", "digest": "Newsletter",
    "low priority": "Low Priority", "low_priority": "Low Priority", "low": "Low Priority",
    "needs review": "Needs Review", "needs_review": "Needs Review",
    "review": "Needs Review", "unclear": "Needs Review", "ambiguous": "Needs Review",
}

MAX_ACTIONS = 8
_REF = re.compile(r"^e?(\d+)$", re.I)
_WS = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# Coercion helpers — the model's output is untrusted structure
# ---------------------------------------------------------------------------

def _text(value, limit=400):
    if not isinstance(value, str):
        return ""
    return _WS.sub(" ", value).strip()[:limit]


def _ref(value):
    """'e3' / 'E3' / '3' -> 'E3'. Anything else -> ''."""
    m = _REF.match(str(value or "").strip())
    return f"E{int(m.group(1))}" if m else ""


def _category(value):
    key = _WS.sub(" ", str(value or "")).strip().lower()
    if key in _CATEGORY_ALIASES:
        return _CATEGORY_ALIASES[key]
    title = key.title()
    return title if title in ALL_CATEGORIES else ""


def _urgency(value, default="medium"):
    key = str(value or "").strip().lower()
    return key if key in URGENCY_ORDER else default


def _bool(value):
    """Strict enough that a model answering the string "false" means False."""
    if isinstance(value, str):
        return value.strip().lower() not in {"", "false", "no", "0", "none", "null"}
    return bool(value)


def _tags(value, limit=5):
    if not isinstance(value, list):
        return []
    seen = []
    for tag in value:
        cleaned = _text(tag, 24).lower().replace(" ", "_")
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return seen[:limit]


def _quote_supported(quote, record):
    """True when the model can point at the words it based a deadline on.

    A deadline the model could not quote from the email is exactly the kind of
    detail that gets confidently invented, so it is dropped rather than shown.
    """
    needle = _WS.sub(" ", (quote or "").strip().lower())
    if len(needle) < 4:
        return False
    haystack = _WS.sub(" ", " ".join([
        record.get("subject") or "", record.get("snippet") or "", record.get("body") or "",
    ]).lower())
    return needle in haystack


# ---------------------------------------------------------------------------
# Deterministic classification — used for leftovers and when the LLM is down
# ---------------------------------------------------------------------------

def _fallback_category(record):
    """What Gmail's own signals alone can support. Never guesses at content.

    Only two labels are actually evidenced without reading the mail: Gmail's
    Promotions category, and a List-Id header, which means a real subscribed
    mailing list. Everything else bulk is filed as Low Priority rather than
    asserted to be marketing, and anything that is not bulk at all is left for
    a human to look at.
    """
    if record.get("category") == "Promotions":
        return "Promotional"
    if record.get("list_mail"):
        return "Newsletter"
    if record.get("bulk") or record.get("category") in ("Social", "Forums", "Updates"):
        return "Low Priority"
    return "Needs Review"


def _email_card(record, category, **judgement):
    """A briefing card: facts from Gmail, judgement from the model."""
    return {
        "id": record["id"],
        "thread_id": record["thread_id"],
        "ref": record["ref"],
        "category": category,
        "sender": record["sender_name"],
        "sender_email": record["sender_email"],
        "subject": record["subject"],
        "date": record["date"],
        "date_ms": record["date_ms"],
        "unread": record["unread"],
        "summary": judgement.get("summary", ""),
        "why_it_matters": judgement.get("why_it_matters", ""),
        "required_action": judgement.get("required_action", ""),
        "urgency": judgement.get("urgency", "low"),
        "needs_reply": bool(judgement.get("needs_reply", False)),
        "deadline": judgement.get("deadline", ""),
        "tags": judgement.get("tags", []),
        "review_reason": judgement.get("review_reason", ""),
    }


def _sort_emails(cards):
    cards.sort(key=lambda c: (
        URGENCY_ORDER.get(c["urgency"], 2),
        CATEGORY_ORDER.get(c["category"], 4),
        -(c["date_ms"] or 0),
    ))
    return cards


def _bulk_groups(records):
    """Fallback grouping for records the model did not place anywhere."""
    buckets = {}
    for record in records:
        category = _fallback_category(record)
        if category not in GROUPED_CATEGORIES:
            continue
        buckets.setdefault(category, []).append(record)

    labels = {
        "Promotional": ("Promotional mail", "Offers and marketing — nothing here was read in detail."),
        "Newsletter": ("Newsletters and digests", "Subscribed reading — nothing here was read in detail."),
        "Low Priority": ("Notifications and updates", "Automated mail — nothing here was read in detail."),
    }
    groups = []
    for category, items in buckets.items():
        label, note = labels[category]
        groups.append({
            "label": label,
            "category": category,
            "count": len(items),
            "senders": _sender_names(items),
            "subjects": [r["subject"] for r in items[:6]],
            "note": note,
        })
    return groups


def _sender_names(records, limit=6):
    names = []
    for record in records:
        name = record["sender_name"]
        if name and name not in names:
            names.append(name)
    return names[:limit]


# ---------------------------------------------------------------------------
# Recommended actions
# ---------------------------------------------------------------------------

def _failure_covered(actions, failure):
    """Has the model already recommended something about this bounce?"""
    needles = [n.lower() for n in (failure.get("failed_recipient"), failure.get("original_subject")) if n]
    if not needles:
        return any(a["type"] == "fix_delivery" for a in actions)
    for action in actions:
        text = f"{action['action']} {action['reason']}".lower()
        if any(n in text for n in needles):
            return True
    return False


def _failure_action(failure):
    """A recommendation built only from what the bounce notice actually said."""
    who = failure.get("failed_recipient") or "the recipient"
    subject = failure.get("original_subject")
    what = f'"{subject}"' if subject else "your message"
    if failure.get("permanent") is False:
        return {
            "action": f"Check whether {what} eventually reached {who}",
            "reason": failure.get("reason") or "delivery was deferred, not refused — servers normally retry on their own",
            "urgency": "low",
            "type": "fix_delivery",
            "refs": [],
        }
    return {
        "action": f"Resend {what} to {who} once the address is corrected",
        "reason": failure.get("reason") or "the message was returned undelivered and will not arrive on its own",
        "urgency": "high",
        "type": "fix_delivery",
        "refs": [],
    }


def _renumber(actions):
    """Order by urgency, cap the list and stamp 1..n.

    The sort is stable, so the model's own ranking survives inside each
    urgency band while the bands themselves are enforced here.
    """
    actions.sort(key=lambda a: URGENCY_ORDER.get(a["urgency"], 2))
    del actions[MAX_ACTIONS:]
    for i, action in enumerate(actions, start=1):
        action["priority"] = i
    return actions


def _clean_actions(raw, by_ref, failures):
    """Validate, de-duplicate, ground and order the recommendations."""
    actions, seen = [], set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text, reason = _text(item.get("action"), 160), _text(item.get("reason"), 200)
        # An action without a stated reason is exactly what the briefing is
        # supposed to avoid, so it is dropped rather than shown bare.
        if not text or not reason or text.lower() in seen:
            continue
        seen.add(text.lower())
        kind = str(item.get("type") or "").strip().lower()
        refs = [r for r in (_ref(x) for x in item.get("refs") or []) if r in by_ref]
        actions.append({
            "action": text,
            "reason": reason,
            "urgency": _urgency(item.get("urgency")),
            "type": kind if kind in ACTION_TYPES else "action",
            "refs": refs,
            "email_ids": [by_ref[r]["id"] for r in refs],
        })

    for failure in failures:
        if not _failure_covered(actions, failure):
            entry = _failure_action(failure)
            entry["email_ids"] = [failure["message_id"]] if failure.get("message_id") else []
            actions.append(entry)

    return _renumber(actions)


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def _assemble(records, failures, analysis, degraded=False):
    """Merge model judgements onto Gmail facts, dropping anything unsupported."""
    by_ref = {r["ref"]: r for r in records}
    seen, placed, cards, groups = set(), set(), [], []

    for item in (analysis.get("emails") if isinstance(analysis.get("emails"), list) else []):
        if not isinstance(item, dict):
            continue
        ref = _ref(item.get("ref"))
        record = by_ref.get(ref)
        if not record or ref in seen:
            continue  # a reference the model invented, or a duplicate
        seen.add(ref)

        category = _category(item.get("category")) or "Needs Review"
        deadline = _text(item.get("deadline"), 120)
        if deadline and not _quote_supported(item.get("deadline_quote"), record):
            print(f"inbox_briefing: dropped unquotable deadline on {ref}: {deadline!r}")
            deadline = ""

        judgement = {
            "summary": _text(item.get("summary"), 320),
            "why_it_matters": _text(item.get("why_it_matters"), 200),
            "required_action": _text(item.get("required_action"), 200),
            "urgency": _urgency(item.get("urgency"), "low" if category in GROUPED_CATEGORIES else "medium"),
            "needs_reply": _bool(item.get("needs_reply")),
            "deadline": deadline,
            "tags": _tags(item.get("tags")),
            "review_reason": _text(item.get("review_reason"), 200),
        }
        # Bulk mail listed individually is left unplaced so the grouping pass
        # below folds it in — the briefing lists one card per bulk email only
        # when the model has nothing better to say about it.
        if category in GROUPED_CATEGORIES:
            continue
        placed.add(ref)
        cards.append(_email_card(record, category, **judgement))

    for item in (analysis.get("groups") if isinstance(analysis.get("groups"), list) else []):
        if not isinstance(item, dict):
            continue
        members = []
        for raw_ref in item.get("refs") or []:
            ref = _ref(raw_ref)
            if ref in by_ref and ref not in placed:
                placed.add(ref)
                members.append(by_ref[ref])
        if not members:
            continue
        groups.append({
            "label": _text(item.get("label"), 60) or "Other mail",
            "category": _category(item.get("category")) or "Low Priority",
            "count": len(members),
            "senders": _sender_names(members),
            "subjects": [m["subject"] for m in members[:6]],
            "note": _text(item.get("note"), 200),
        })

    # Anything the model skipped is reported, not silently dropped: bulk mail
    # falls back to Gmail's own signals, real mail becomes Needs Review.
    leftovers = [r for r in records if r["ref"] not in placed]
    reviewable = [r for r in leftovers if _fallback_category(r) not in GROUPED_CATEGORIES]
    reason = ("AI analysis was unavailable, so this email has not been read."
              if degraded else "The analyst returned no classification for this email.")
    for record in reviewable:
        cards.append(_email_card(record, "Needs Review", review_reason=reason, urgency="medium"))
    review_refs = {r["ref"] for r in reviewable}
    groups.extend(_bulk_groups([r for r in leftovers if r["ref"] not in review_refs]))

    _sort_emails(cards)
    actions = _clean_actions(analysis.get("recommended_actions"), by_ref, failures)
    if reviewable and not any(a["type"] == "review" for a in actions):
        actions = _renumber([{
            "action": f"Open the {len(reviewable)} email{'s' if len(reviewable) != 1 else ''} marked Needs Review",
            "reason": "they could not be classified from the evidence available, so nothing is known about what they ask for",
            "urgency": "medium",
            "type": "review",
            "refs": sorted(review_refs),
            "email_ids": [r["id"] for r in reviewable],
        }] + actions)

    grouped_total = sum(g["count"] for g in groups)
    counts = {
        "analyzed": len(records) + len(failures),
        "needs_reply": sum(1 for c in cards if c["needs_reply"]),
        "action_required": sum(1 for c in cards if c["category"] == "Requires Action"),
        "important": sum(1 for c in cards if c["category"] == "Important"),
        "needs_review": sum(1 for c in cards if c["category"] == "Needs Review"),
        "high_priority": sum(1 for c in cards if c["urgency"] in ("critical", "high")),
        "promotional": sum(g["count"] for g in groups if g["category"] == "Promotional"),
        "newsletters": sum(g["count"] for g in groups if g["category"] == "Newsletter"),
        "low_priority": sum(g["count"] for g in groups if g["category"] == "Low Priority"),
        "grouped": grouped_total,
        "delivery_failures": len(failures),
    }

    return {
        "overview": _text(analysis.get("overview"), 600),
        "emails": cards,
        "groups": sorted(groups, key=lambda g: -g["count"]),
        "delivery_failures": failures,
        "recommended_actions": actions,
        "counts": counts,
        "degraded": degraded,
    }


def _plural(n, one, many=None):
    return one if n == 1 else (many or one + "s")


def _degraded_overview(total, failures):
    parts = [
        f"AI analysis is unavailable right now, so no email has been read or classified by content. "
        f"{total} {_plural(total, 'message')} are listed from Gmail's own signals only."
    ]
    if failures:
        parts.append(
            f"{len(failures)} delivery {_plural(len(failures), 'failure')} "
            f"{_plural(len(failures), 'was', 'were')} still detected from the message headers, "
            f"which does not depend on AI."
        )
    return " ".join(parts)


def _plain_overview(briefing):
    """A factual overview built from the counts, if the model returned none."""
    c = briefing["counts"]
    attention = len(briefing["emails"])
    if not attention and not c["grouped"] and not c["delivery_failures"]:
        return "No unread mail to report."

    parts = []
    if attention:
        bits = []
        if c["needs_reply"]:
            bits.append(f"{c['needs_reply']} needing a reply")
        if c["action_required"]:
            bits.append(f"{c['action_required']} needing an action")
        if c["needs_review"]:
            bits.append(f"{c['needs_review']} to review")
        detail = f" — {', '.join(bits)}" if bits else ""
        parts.append(
            f"{attention} {_plural(attention, 'email')} "
            f"{_plural(attention, 'needs', 'need')} attention{detail}."
        )
    if c["delivery_failures"]:
        parts.append(
            f"{c['delivery_failures']} {_plural(c['delivery_failures'], 'message')} you sent "
            f"{_plural(c['delivery_failures'], 'was', 'were')} returned undelivered."
        )
    if c["grouped"]:
        parts.append(f"{c['grouped']} promotional, newsletter and notification {_plural(c['grouped'], 'email')} were grouped.")
    return " ".join(parts)


def build_briefing(service, ai, user_name="there", max_results=inbox_reader.DEFAULT_ANALYZE):
    """Read the inbox and return the full briefing. Read-only end to end."""
    records, unread_count = inbox_reader.read_inbox(service, max_results=max_results)
    return analyze_records(ai, records, unread_count, user_name)


def analyze_records(ai, records, unread_count, user_name="there"):
    """The judgement half of a briefing, over already-read evidence.

    Split out so Agent Mode can show "reading" and "analyzing" as the two
    separate steps they actually are.
    """
    failures = inbox_reader.collect_delivery_failures(records)

    # Bounces are reported from their parsed headers in their own section, so
    # the model is not asked to describe them (and cannot get them wrong).
    # Re-numbering afterwards keeps the reference keys gap-free.
    to_analyze = inbox_reader.assign_refs([r for r in records if not r.get("bounce")])

    degraded = False
    analysis = {}
    if to_analyze or failures:
        try:
            analysis = ai.analyze_inbox(to_analyze, failures, user_name)
            if not isinstance(analysis, dict):
                raise ValueError(f"expected a JSON object, got {type(analysis).__name__}")
        except Exception as e:
            print(f"build_briefing: analysis unavailable ({e}) — falling back to Gmail signals")
            analysis, degraded = {}, True

    briefing = _assemble(to_analyze, failures, analysis, degraded=degraded)
    if degraded:
        briefing["overview"] = _degraded_overview(len(records), failures)
    elif not briefing["overview"]:
        briefing["overview"] = _plain_overview(briefing)

    analyzed_unread = sum(1 for r in records if r["unread"])
    briefing["scope"] = {
        "analyzed": len(records),
        "unread_analyzed": analyzed_unread,
        "unread_total": unread_count,
        "read_included": len(records) - analyzed_unread,
        "capped": unread_count > analyzed_unread,
        "bodies_read": sum(1 for r in records if r["body"]),
    }
    # Kept so older clients (and Agent Mode) still get a plain-text overview.
    briefing["summary"] = briefing["overview"]
    return briefing
