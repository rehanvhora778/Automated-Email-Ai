import os
import json
from mistralai import Mistral
from dotenv import load_dotenv

load_dotenv()

# Smart Reply styles. Keys are stable API identifiers; the frontend picks which
# to request. The first six preserve the original set (backward compatible).
REPLY_STYLE_GUIDE = {
    "professional": "Polished, clear and courteous standard business tone.",
    "friendly": "Warm, personable and approachable, while still professional.",
    "formal": "Highly formal, traditional business etiquette and full phrasing.",
    "short": "1-2 sentences only. Crisp and straight to the point.",
    "negotiation": "Politely pushes back or proposes alternatives; protects the writer's interests while staying collaborative.",
    "apology": "Gracious, accountable and sincere; owns the issue and offers a remedy.",
    "ceo": "Executive brevity — decisive, high-level and confident, very few words.",
    "sales": "Persuasive and benefit-led with an enthusiastic, clear call to action.",
    "support": "Empathetic customer-support tone; reassuring and solution-oriented.",
    "technical": "Precise and specific; uses correct technical terms and concrete details.",
    "detailed": "Thorough and comprehensive; addresses every point with clear structure.",
    "persuasive": "Compelling and confident; builds a strong, well-reasoned case.",
    "casual": "Relaxed, conversational, everyday language (still respectful).",
}
DEFAULT_REPLY_STYLES = list(REPLY_STYLE_GUIDE.keys())


class SecretaryAI:
    def __init__(self):
        api_key = os.getenv("MISTRAL_API_KEY")
        self.model = "mistral-medium-latest" 
        self.client = Mistral(api_key=api_key)

    def generate_response(self, user_input, profile_data, resume_context, chat_history=[]):
        # User details setup
        user_name = profile_data.get('full_name', 'User')
        signature = profile_data.get('signature') or f"Best regards,\n{user_name}"
        
        system_instructions = f"""
        You are an Smart Email Assistant. 
        USER PROFILE: {json.dumps(profile_data)}
        RESUME: {resume_context[:1000]}

        CORE LOGIC:
        1. IDENTIFY INTENT: Determine the user's LATEST request goal (e.g., writing a specific email).
        2. TASK ISOLATION: Focus ONLY on the latest request. Ignore specific data requirements (like flight numbers or dates) from previous, unrelated tasks in the chat history.
        3. DATA VALIDATION: 
           - If the current task needs specific details (names, dates, numbers) that are NOT in the message or profile, set "status": "missing_info".
           - Do NOT use placeholders like [Company Name] or [Date]. If you don't have them, ASK for them.
        4. DRAFTING: If all info is present, generate a high-quality draft using the user's resume for personalization.
        5. SIGNATURE: End the draft strictly with:
        {signature}

        RESPONSE FORMAT (Strict JSON):
        {{
            "status": "ready" | "missing_info",
            "content": "Final draft OR a polite request for missing details",
            "metadata": {{ "subject": "...", "type": "..." }}
        }}
        """
        # ... baaki code same ...
        # ... baaki messages aur client.chat.complete wala code same rahega ...

        # --- MEMORY LOGIC START ---
        # 1. Sabse pehle System Instructions daalo
        messages = [{"role": "system", "content": system_instructions}]

        # 2. Phir purani chat history add karo (taaki AI ko pichli baatein yaad rahein)
        for msg in chat_history:
            messages.append({
                "role": msg["role"], 
                "content": msg["content"]
            })

        # 3. Sabse aakhiri mein user ka naya sawal daalo
        messages.append({"role": "user", "content": user_input})
        # --- MEMORY LOGIC END ---

        try:
            # Mistral API call
            response = self.client.chat.complete(
                model=self.model,
                messages=messages,
                response_format={"type": "json_object"}
            )
            
            raw_content = response.choices[0].message.content
            return json.loads(raw_content)

        except json.JSONDecodeError:
            print("AI ne JSON format nahi diya.")
            return {
                "status": "ready",
                "content": response.choices[0].message.content,
                "metadata": {}
            }
            
        except Exception as e:
            print(f"MISTRAL API ERROR: {e}")
            return {
                "status": "error",
                "content": "Mistral AI is busy. Try again.",
                "metadata": {}
            }

    # =====================================================================
    # Copilot capabilities (Smart Reply, Inbox Summary, Writing Tools)
    # =====================================================================

    def _chat_json(self, system_prompt, user_prompt):
        """Call Mistral expecting a strict JSON object; returns a parsed dict."""
        response = self.client.chat.complete(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)

    def _chat_text(self, system_prompt, user_prompt):
        """Call Mistral for a plain-text completion."""
        response = self.client.chat.complete(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        return response.choices[0].message.content

    def generate_replies(self, original_email, tone="", context="", user_name="User", signature="", styles=None):
        """Produce distinct reply drafts (one per requested style) for a pasted email.

        `styles` is an optional list of style keys (see REPLY_STYLE_GUIDE);
        defaults to the full set. Returns {style_key: reply_text}. The response
        shape (a flat dict of strings) is unchanged from the original 6-style
        version, so existing callers keep working.
        """
        sign = signature or f"Best regards,\n{user_name}"
        keys = [s for s in (styles or DEFAULT_REPLY_STYLES) if s in REPLY_STYLE_GUIDE] or DEFAULT_REPLY_STYLES
        guide_lines = "\n".join(f'- "{k}": {REPLY_STYLE_GUIDE[k]}' for k in keys)
        keys_json = ", ".join(f'"{k}": "..."' for k in keys)
        system_prompt = f"""You are an elite email assistant writing replies on behalf of {user_name}.
You are given an ORIGINAL email that {user_name} RECEIVED. Write one reply draft per style below.
Return STRICT JSON with EXACTLY these keys, each value a ready-to-send reply body (plain text, no subject line):
{{{keys_json}}}
STYLE GUIDE (make each reply clearly distinct):
{guide_lines}
Rules:
- Reply AS the recipient (respond to the original sender).
- Never use bracket placeholders like [Name] or [Date]; write naturally around anything unknown.
- Respect the requested tone/context when provided.
- End every draft with this signature exactly:
{sign}"""
        user_prompt = (
            f"ORIGINAL EMAIL:\n{original_email}\n\n"
            f"TONE PREFERENCE: {tone or 'balanced/default'}\n"
            f"EXTRA CONTEXT: {context or 'none'}"
        )
        try:
            data = self._chat_json(system_prompt, user_prompt)
            return {k: (data.get(k) or "").strip() for k in keys}
        except Exception as e:
            print(f"generate_replies error: {e}")
            return {k: "" for k in keys}

    def summarize_inbox(self, emails, user_name="there"):
        """Turn a list of recent emails into a structured inbox briefing."""
        compact = "\n".join(
            f"- FROM: {e.get('sender', '')} | SUBJECT: {e.get('subject', '')} | "
            f"{'UNREAD' if e.get('unread') else 'read'} | SNIPPET: {(e.get('snippet') or '')[:160]}"
            for e in emails
        ) or "(inbox is empty)"
        system_prompt = """You are an AI inbox analyst. Analyze the user's recent emails and return STRICT JSON:
{
  "summary": "1-2 sentence natural-language overview of the inbox",
  "important": [{"sender": "Name", "subject": "...", "insight": "one short line on why it matters"}],
  "spam": {"count": 0, "note": "short note"},
  "newsletters": {"count": 0, "note": "short note"},
  "action_items": ["short actionable task"],
  "suggestions": [{"title": "Reply to Aman", "type": "reply"}],
  "meetings_today": 0,
  "high_priority": 0
}
Classification: promotional/marketing => spam; digests/newsletters => newsletters; genuine work/personal => important.
suggestion "type" must be one of: reply, follow_up, respond, thank_you. Keep every list to at most 6 items. Be concise and specific (use real names/subjects from the emails)."""
        user_prompt = f"USER: {user_name}\nRECENT EMAILS (newest first):\n{compact}"
        try:
            data = self._chat_json(system_prompt, user_prompt)
        except Exception as e:
            print(f"summarize_inbox error: {e}")
            data = {}
        data.setdefault("summary", "")
        data.setdefault("important", [])
        data.setdefault("spam", {"count": 0, "note": ""})
        data.setdefault("newsletters", {"count": 0, "note": ""})
        data.setdefault("action_items", [])
        data.setdefault("suggestions", [])
        data.setdefault("meetings_today", 0)
        data.setdefault("high_priority", len(data.get("important", [])))
        return data

    def _build_tool_prompts(self, action, input_text, context="", user_name="User", resume="", signature=""):
        """Shared prompt construction for the writing tools (used by run_tool + stream_tool)."""
        sign = signature or f"Best regards,\n{user_name}"
        instructions = {
            "cover_letter": f"Write a compelling, concise cover letter for {user_name}. Use the resume for personalization. End with:\n{sign}",
            "cold_email": f"Write a persuasive, concise cold outreach email for {user_name}. Strong hook, one clear ask. End with:\n{sign}",
            "translate": "Translate the user's INPUT. If CONTEXT names a target language use it, otherwise translate to English. Preserve tone and formatting. Return only the translation.",
            "improve": "Improve the INPUT's clarity, grammar, tone and impact without changing its meaning or language. Return only the improved text.",
            "rewrite": "Rewrite the INPUT in a fresh way, preserving meaning. If CONTEXT specifies a tone, apply it. Return only the rewritten text.",
        }
        instruction = instructions.get(action, "Complete the user's request using INPUT and CONTEXT. Return only the result text.")
        system_prompt = f"You are an elite writing assistant. {instruction}"
        resume_bit = f"\n\nUSER RESUME (for personalization):\n{resume[:1500]}" if resume and action in ("cover_letter", "cold_email") else ""
        user_prompt = f"CONTEXT: {context or 'none'}\n\nINPUT:\n{input_text}{resume_bit}"
        return system_prompt, user_prompt

    def run_tool(self, action, input_text, context="", user_name="User", resume="", signature=""):
        """Generic single-output writing tool (cover letter, cold email, translate, etc.)."""
        system_prompt, user_prompt = self._build_tool_prompts(action, input_text, context, user_name, resume, signature)
        try:
            return {"content": (self._chat_text(system_prompt, user_prompt) or "").strip()}
        except Exception as e:
            print(f"run_tool error: {e}")
            return {"content": "", "error": str(e)}

    def stream_tool(self, action, input_text, context="", user_name="User", resume="", signature=""):
        """Same as run_tool, but yields text deltas as they arrive from Mistral."""
        system_prompt, user_prompt = self._build_tool_prompts(action, input_text, context, user_name, resume, signature)
        stream = self.client.chat.stream(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        for event in stream:
            delta = event.data.choices[0].delta.content
            if delta:
                yield delta

    def agent_plan(self, command, user_name="User", resume=""):
        """Classify an agent command and prepare any content it needs.

        Returns {intent, message, to, subject, body}. For drafting intents the
        `body` holds a complete, ready-to-send draft; for read/action intents
        (summarize/archive) body stays empty and the backend does the work.
        """
        system_prompt = f"""You are an autonomous email assistant acting for {user_name}.
Classify the user's COMMAND and prepare what is needed. Return STRICT JSON:
{{
  "intent": one of ["summarize_inbox","compose_email","draft_reply","archive_promotions","schedule_meeting","find_contact","general"],
  "message": "one short sentence describing what you will do",
  "to": "recipient email or name if one is mentioned, else empty",
  "subject": "a fitting subject line if drafting an email, else empty",
  "body": "the full text if drafting/answering, else empty"
}}
Rules:
- compose_email / draft_reply / schedule_meeting: write a complete, polished, ready-to-send draft in "body" (natural sign-off with {user_name}), plus a "subject". For schedule_meeting, draft a message proposing specific times.
- summarize_inbox / archive_promotions / find_contact: leave "subject" and "body" empty; the app performs these.
- general: put a helpful answer in "body".
- Never use bracket placeholders like [Name]. Personalise with the resume when drafting.
RESUME (for personalisation): {resume[:800]}"""
        try:
            data = self._chat_json(system_prompt, f"COMMAND: {command}")
        except Exception as e:
            print(f"agent_plan error: {e}")
            return {"intent": "general", "message": "Helping with your request.",
                    "to": "", "subject": "", "body": "Sorry, I couldn't process that. Please try again."}
        data.setdefault("intent", "general")
        for k in ("message", "to", "subject", "body"):
            data.setdefault(k, "")
        return data