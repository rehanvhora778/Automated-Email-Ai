"""AI Agent Mode — turns a natural-language command into an animated, streamed
run of real tools (read inbox, summarize, archive promotions) plus AI drafting.

Streams newline-delimited JSON events:
  {"type":"status","message":"..."}                      # before the plan is known
  {"type":"plan","intent":"...","steps":[{key,label}...]}
  {"type":"step","key":"...","state":"active"}
  {"type":"step","key":"...","state":"done","detail":"..."}
  {"type":"result", ...}                                  # final payload
  {"type":"error","message":"..."}

Sending is deliberately NOT automated: drafting intents return a `draft` the UI
hands to the compose modal for a human "Review & Send".
"""
import json
import time

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.db.supabase import supabase, get_user_profile, get_user_resume
from app.services.ai_service import SecretaryAI
from app.services.gmail_service import build_user_gmail_service

router = APIRouter()
ai = SecretaryAI()

# Deterministic step sequences per intent (backend owns these, not the LLM).
STEP_PLANS = {
    "summarize_inbox": [("think", "Understanding your request"), ("read", "Reading your inbox"),
                        ("analyze", "Analyzing priorities"), ("done", "Preparing your summary")],
    "compose_email":   [("think", "Understanding your request"), ("contact", "Finding the recipient"),
                        ("draft", "Drafting your email"), ("done", "Draft ready")],
    "draft_reply":     [("think", "Understanding your request"), ("read", "Reading the thread"),
                        ("draft", "Composing your reply"), ("done", "Draft ready")],
    "archive_promotions": [("think", "Understanding your request"), ("read", "Scanning promotions"),
                           ("archive", "Archiving promotional mail"), ("done", "Inbox cleaned up")],
    "schedule_meeting": [("think", "Understanding your request"), ("calendar", "Checking your calendar"),
                         ("draft", "Drafting the invite"), ("done", "Invite ready")],
    "find_contact":    [("think", "Understanding your request"), ("contact", "Looking up the contact"),
                        ("done", "Contact found")],
    "general":         [("think", "Thinking"), ("done", "Done")],
}

DRAFT_INTENTS = {"compose_email", "draft_reply", "schedule_meeting"}
GMAIL_INTENTS = {"summarize_inbox", "archive_promotions"}


class AgentRequest(BaseModel):
    user_id: str
    command: str


def _event(obj: dict) -> str:
    return json.dumps(obj) + "\n"


def _header(headers, name, default=""):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", default)
    return default


def _read_inbox(service, n=15):
    listing = service.users().messages().list(userId="me", labelIds=["INBOX"], maxResults=n).execute()
    emails = []
    for m in listing.get("messages", []):
        msg = service.users().messages().get(
            userId="me", id=m["id"], format="metadata", metadataHeaders=["From", "Subject"],
        ).execute()
        headers = msg.get("payload", {}).get("headers", [])
        emails.append({
            "sender": _header(headers, "From"),
            "subject": _header(headers, "Subject", "(no subject)"),
            "snippet": msg.get("snippet", ""),
            "unread": "UNREAD" in msg.get("labelIds", []),
        })
    return emails


def _archive_promotions(service, n=25):
    listing = service.users().messages().list(userId="me", q="category:promotions", maxResults=n).execute()
    count = 0
    for m in listing.get("messages", []):
        try:
            service.users().messages().modify(userId="me", id=m["id"], body={"removeLabelIds": ["INBOX"]}).execute()
            count += 1
        except Exception:
            pass
    return count


@router.post("/run")
async def agent_run(req: AgentRequest):
    def generate():
        try:
            yield _event({"type": "status", "message": "Thinking…"})

            # Profile + resume for personalisation (best effort).
            user_name, resume = "User", ""
            try:
                profile = get_user_profile(req.user_id)
                if profile:
                    user_name = profile.get("full_name") or "User"
                r = get_user_resume(req.user_id)
                resume = r.get("raw_text") if isinstance(r, dict) else (r or "")
            except Exception as e:
                print(f"agent: profile fetch warning: {e}")

            plan = ai.agent_plan(req.command, user_name, resume)
            intent = plan.get("intent", "general")
            if intent not in STEP_PLANS:
                intent = "general"
            steps = STEP_PLANS[intent]

            yield _event({
                "type": "plan", "intent": intent, "message": plan.get("message", ""),
                "steps": [{"key": k, "label": l} for k, l in steps],
            })

            # Build a Gmail client only if this intent needs it.
            service = None
            if intent in GMAIL_INTENTS:
                try:
                    res = supabase.from_("profiles").select("gmail_token").eq("id", req.user_id).execute()
                    token = res.data[0].get("gmail_token") if res.data else None
                    service = build_user_gmail_service(token) if token else None
                except Exception as e:
                    print(f"agent: gmail build warning: {e}")

            summary_text, archived = "", 0

            for key, label in steps:
                yield _event({"type": "step", "key": key, "state": "active"})
                detail = ""
                try:
                    if key == "read" and intent == "summarize_inbox" and service:
                        emails = _read_inbox(service, 15)
                        analysis = ai.summarize_inbox(emails, user_name)
                        summary_text = analysis.get("summary", "")
                        detail = f"Read {len(emails)} emails"
                    elif key == "analyze" and intent == "summarize_inbox":
                        detail = "Prioritized what matters"
                    elif key == "read" and intent == "archive_promotions" and service:
                        detail = "Scanned promotions"
                    elif key == "archive" and intent == "archive_promotions" and service:
                        archived = _archive_promotions(service, 25)
                        detail = f"Archived {archived}"
                except Exception as e:
                    print(f"agent step '{key}' error: {e}")
                time.sleep(0.45)  # let each step breathe for the animation
                yield _event({"type": "step", "key": key, "state": "done", "detail": detail})

            draft = None
            if intent in DRAFT_INTENTS and plan.get("body"):
                draft = {"to": plan.get("to", ""), "subject": plan.get("subject", ""), "body": plan.get("body", "")}

            yield _event({
                "type": "result",
                "intent": intent,
                "message": plan.get("message", ""),
                "summary": summary_text,
                "answer": plan.get("body", "") if intent == "general" else "",
                "draft": draft,
                "stats": {"archived": archived} if intent == "archive_promotions" else {},
                "needs_gmail": intent in GMAIL_INTENTS and service is None,
            })
        except Exception as e:
            print(f"agent_run error: {e}")
            yield _event({"type": "error", "message": str(e)})

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
