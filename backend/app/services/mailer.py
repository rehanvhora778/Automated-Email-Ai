"""Outbound transactional email, over an HTTP API or SMTP.

This is only for mail the *system* sends about itself — verification codes and
the like. Mail sent on a user's behalf still goes through the Gmail API in
gmail_service, so it appears in their Sent folder under their own address.

Four transports, picked by whichever credential is present, in this order:

  * **Resend**     — `RESEND_API_KEY`
  * **Brevo**      — `BREVO_API_KEY`
  * **Gmail API**  — a linked Gmail account already stored in `profiles`
  * **SMTP**       — `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM`

Gmail API outranks SMTP deliberately. This is a Gmail application, so a
send-scoped token is usually already on hand, and it reaches Google over HTTPS
rather than a port the host is likely to block — which makes it the transport
that works with no extra account anywhere. `EMAIL_PROVIDER` overrides the order.

SMTP is the obvious choice and the wrong default on much of today's hosting.
Render's free tier — and many other PaaS providers — block outbound connections
on ports 25, 465 and 587 to stop their address space being used for spam, so a
perfectly valid Gmail app password fails with "Network is unreachable" and looks
exactly like a credentials problem. The HTTP providers are ordinary HTTPS calls,
which nothing blocks. SMTP stays supported for local development and for hosts
that permit it.
"""
import os
import re
import base64
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

import requests

RESEND_API_KEY = os.getenv("RESEND_API_KEY", "").strip()
BREVO_API_KEY = os.getenv("BREVO_API_KEY", "").strip()
# Which linked account sends system mail. Unset, the oldest profile holding a
# send-scoped token is used — deterministic, so the sender does not drift as
# new people sign up.
MAIL_GMAIL_PROFILE_ID = os.getenv("MAIL_GMAIL_PROFILE_ID", "").strip()

SMTP_HOST = os.getenv("SMTP_HOST", "").strip()
SMTP_PORT = int(os.getenv("SMTP_PORT", "587") or 587)
SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "").strip() or SMTP_USER
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Smart Email Agent").strip()
# STARTTLS on 587 is the common case; 465 is implicit TLS.
SMTP_USE_SSL = os.getenv("SMTP_USE_SSL", "").strip().lower() in {"1", "true", "yes"} or SMTP_PORT == 465
# Nearly every hosted provider wants STARTTLS, but local relays and capture
# tools such as MailHog offer no TLS at all and abort the send when it is
# demanded unconditionally.
SMTP_STARTTLS = os.getenv("SMTP_STARTTLS", "true").strip().lower() not in {"0", "false", "no"}


# The visible From address. Falls back to the SMTP identity so an SMTP-only
# deployment needs no extra variable.
MAIL_FROM = os.getenv("MAIL_FROM", "").strip() or SMTP_FROM
MAIL_FROM_NAME = os.getenv("MAIL_FROM_NAME", "").strip() or SMTP_FROM_NAME


class MailerNotConfigured(RuntimeError):
    """Raised when no transport is configured."""


_gmail_sender_cache: dict | None = None


def _gmail_candidates() -> list[dict]:
    """Every stored token that could plausibly send, oldest profile first.

    Ordered rather than arbitrary so the sending address is stable as people
    sign up, and so an explicit MAIL_GMAIL_PROFILE_ID always wins.
    """
    try:
        from app.db.supabase import supabase

        query = supabase.from_("profiles").select("id, full_name, gmail_token")
        if MAIL_GMAIL_PROFILE_ID:
            query = query.eq("id", MAIL_GMAIL_PROFILE_ID)
        rows = query.order("created_at").execute().data or []
    except Exception as e:
        print(f"mailer: could not look up a Gmail sender: {e}")
        return []

    out = []
    for row in rows:
        token = row.get("gmail_token") or {}
        # A refresh token is what makes this durable; without the send scope
        # Google rejects the call regardless.
        if token.get("refresh_token") and "gmail.send" in (token.get("scope") or ""):
            out.append({"id": row["id"], "name": row.get("full_name"), "token": token})
    return out


def gmail_sender(validate: bool = False) -> dict | None:
    """The stored token this deployment sends system mail through, or None.

    Having a refresh token on file does not mean it still works — users revoke
    access, and Google expires grants on unverified apps. With `validate` the
    candidates are tried in turn and the first one Google still accepts is
    chosen, so one dead token does not take email down while a live one sits
    behind it. Resolved once per process; the answer only changes when someone
    links or unlinks an account.
    """
    global _gmail_sender_cache
    if _gmail_sender_cache is not None:
        return _gmail_sender_cache or None

    candidates = _gmail_candidates()
    if not candidates:
        _gmail_sender_cache = {}
        return None

    if not MAIL_GMAIL_PROFILE_ID and candidates:
        # Worth saying out loud: without a pinned profile this picks somebody's
        # personal mailbox to send system mail from, and which mailbox depends
        # on who signed up first. Fine as a last resort, wrong as a silent
        # default — set MAIL_GMAIL_PROFILE_ID, or configure a mail provider.
        print(
            "mailer: no MAIL_GMAIL_PROFILE_ID set — falling back to a linked "
            f"user's Gmail ({candidates[0]['id'][:8]}…) to send system mail"
        )

    if not validate:
        # Cheap path for "is this transport available at all".
        return candidates[0]

    from app.services.gmail_service import build_user_gmail_service

    for candidate in candidates:
        service = build_user_gmail_service(candidate["token"])
        if service is None:
            continue
        try:
            profile = service.users().getProfile(userId="me").execute()
        except Exception as e:
            print(f"mailer: token for {candidate['id'][:8]} unusable: {e}")
            continue
        candidate["address"] = profile.get("emailAddress")
        _gmail_sender_cache = candidate
        return candidate

    print("mailer: every stored Gmail token was rejected")
    _gmail_sender_cache = {}
    return None


def active_provider() -> str:
    """Which transport will be used: 'resend', 'brevo', 'smtp' or 'none'."""
    forced = os.getenv("EMAIL_PROVIDER", "").strip().lower()
    if forced in {"resend", "brevo", "gmail_api", "smtp"}:
        return forced
    if RESEND_API_KEY:
        return "resend"
    if BREVO_API_KEY:
        return "brevo"
    if gmail_sender():
        return "gmail_api"
    if SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM:
        return "smtp"
    return "none"


def is_configured() -> bool:
    provider = active_provider()
    if provider in {"resend", "brevo"}:
        return bool(MAIL_FROM)
    if provider == "gmail_api":
        return gmail_sender() is not None
    if provider == "smtp":
        return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)
    return False


def _require_config() -> None:
    provider = active_provider()
    if provider == "none":
        raise MailerNotConfigured(
            "Email sending is not configured. Set RESEND_API_KEY (or BREVO_API_KEY) "
            "and MAIL_FROM, or the SMTP_* variables if this host allows outbound SMTP."
        )
    if provider in {"resend", "brevo"} and not MAIL_FROM:
        raise MailerNotConfigured(f"{provider} is configured but MAIL_FROM is not set.")
    if provider == "gmail_api" and not gmail_sender():
        raise MailerNotConfigured(
            "No linked Gmail account with send permission is available to send from. "
            "Link Gmail from Settings, or configure BREVO_API_KEY / RESEND_API_KEY."
        )
    if provider == "smtp":
        missing = [
            name
            for name, value in (
                ("SMTP_HOST", SMTP_HOST),
                ("SMTP_USER", SMTP_USER),
                ("SMTP_PASSWORD", SMTP_PASSWORD),
                ("SMTP_FROM", SMTP_FROM),
            )
            if not value
        ]
        if missing:
            raise MailerNotConfigured(
                "SMTP is selected but incomplete. Missing: " + ", ".join(missing)
            )


class MailSendError(RuntimeError):
    """A transport rejected the message, carrying the provider's own wording."""


def _send_resend(to: str, subject: str, text_body: str, html_body: str | None) -> None:
    payload = {
        "from": f"{MAIL_FROM_NAME} <{MAIL_FROM}>",
        "to": [to],
        "subject": subject,
        "text": text_body,
    }
    if html_body:
        payload["html"] = html_body
    try:
        resp = requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json=payload,
            timeout=20,
        )
    except requests.exceptions.RequestException as e:
        raise MailSendError(f"Could not reach Resend: {e}")
    if resp.status_code >= 300:
        raise MailSendError(f"Resend rejected the message ({resp.status_code}): {resp.text[:300]}")


def _send_brevo(to: str, subject: str, text_body: str, html_body: str | None) -> None:
    payload = {
        "sender": {"email": MAIL_FROM, "name": MAIL_FROM_NAME},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": text_body,
    }
    if html_body:
        payload["htmlContent"] = html_body
    try:
        resp = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={"api-key": BREVO_API_KEY, "Content-Type": "application/json"},
            json=payload,
            timeout=20,
        )
    except requests.exceptions.RequestException as e:
        raise MailSendError(f"Could not reach Brevo: {e}")
    if resp.status_code >= 300:
        raise MailSendError(f"Brevo rejected the message ({resp.status_code}): {resp.text[:300]}")


def _send_gmail_api(to: str, subject: str, text_body: str, html_body: str | None) -> None:
    """Send through the Gmail API, as the linked account.

    HTTPS to googleapis.com, so it survives hosts that block the SMTP ports.
    google-auth refreshes the access token on the first call, so an expired one
    in the stored blob is not a problem.
    """
    sender = gmail_sender(validate=True)
    if not sender:
        raise MailSendError(
            "Every linked Gmail account was rejected by Google — re-link Gmail from "
            "Settings, or configure BREVO_API_KEY / RESEND_API_KEY."
        )

    from app.services.gmail_service import build_user_gmail_service

    service = build_user_gmail_service(sender["token"])
    if service is None:
        raise MailSendError("Google client credentials are not configured on the server.")

    message = EmailMessage()
    message["To"] = to
    message["Subject"] = subject
    # No From header: the Gmail API sends as the authenticated account, and a
    # mismatched From is rejected outright.
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    try:
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
    except Exception as e:
        raise MailSendError(f"Gmail API rejected the message: {e}")


def send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    """Send one message. Raises on failure so callers can report it honestly."""
    _require_config()

    provider = active_provider()
    if provider == "gmail_api":
        return _send_gmail_api(to, subject, text_body, html_body)
    if provider == "resend":
        return _send_resend(to, subject, text_body, html_body)
    if provider == "brevo":
        return _send_brevo(to, subject, text_body, html_body)

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((SMTP_FROM_NAME, SMTP_FROM))
    message["To"] = to
    message.set_content(text_body)
    if html_body:
        message.add_alternative(html_body, subtype="html")

    context = ssl.create_default_context()
    if SMTP_USE_SSL:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=20) as server:
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)
    else:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as server:
            server.ehlo()
            if SMTP_STARTTLS:
                server.starttls(context=context)
                server.ehlo()
            if SMTP_USER and SMTP_PASSWORD:
                server.login(SMTP_USER, SMTP_PASSWORD)
            server.send_message(message)


def send_otp(to: str, code: str, purpose: str) -> None:
    """Send a verification code, worded for what it is being used for."""
    if purpose == "signup":
        subject = f"{code} is your verification code"
        headline = "Confirm your email"
        lead = "Enter this code to finish creating your account."
    else:
        subject = f"{code} is your password reset code"
        headline = "Reset your password"
        lead = "Enter this code to choose a new password."

    text_body = (
        f"{headline}\n\n{lead}\n\n"
        f"    {code}\n\n"
        "This code expires in 10 minutes.\n"
        "If you did not request it, you can ignore this email — nothing has changed.\n"
    )

    # Inline styles only: every mail client strips <style> blocks, and several
    # drop external stylesheets entirely.
    html_body = f"""\
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#111">
  <h2 style="margin:0 0 8px;font-size:20px;font-weight:700">{headline}</h2>
  <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#555">{lead}</p>
  <div style="font-size:32px;font-weight:700;letter-spacing:10px;text-align:center;
              padding:18px;border-radius:12px;background:#f4f4f5;border:1px solid #e4e4e7">
    {code}
  </div>
  <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#71717a">
    This code expires in 10 minutes. If you did not request it you can ignore this
    email &mdash; nothing has changed.
  </p>
</div>"""

    send_email(to, subject, text_body, html_body)


def check_connection() -> tuple[bool, str]:
    """Connect and authenticate without sending, for diagnostics.

    Returns (ok, detail). The detail is the server's own words on failure —
    "Username and Password not accepted" and friends — which is the difference
    between a fixable report and a shrug. It never contains the password.
    """
    try:
        _require_config()
    except MailerNotConfigured as e:
        return False, str(e)

    provider = active_provider()
    if provider == "gmail_api":
        sender = gmail_sender(validate=True)
        if not sender:
            return False, (
                "No linked Gmail account was accepted by Google. Re-link Gmail from "
                "Settings, or set BREVO_API_KEY / RESEND_API_KEY."
            )
        return True, f"Sending as {sender.get('address')}."

    if provider in {"resend", "brevo"}:
        url, headers = (
            ("https://api.resend.com/domains", {"Authorization": f"Bearer {RESEND_API_KEY}"})
            if provider == "resend"
            else ("https://api.brevo.com/v3/account", {"api-key": BREVO_API_KEY})
        )
        try:
            resp = requests.get(url, headers=headers, timeout=15)
        except requests.exceptions.RequestException as e:
            return False, f"Could not reach {provider}: {e}"
        if resp.status_code == 401:
            return False, f"{provider} rejected the API key."
        if resp.status_code >= 300:
            return False, f"{provider} returned {resp.status_code}: {resp.text[:200]}"
        return True, f"{provider} API key accepted."

    context = ssl.create_default_context()
    try:
        if SMTP_USE_SSL:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=context, timeout=15) as server:
                server.login(SMTP_USER, SMTP_PASSWORD)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
                server.ehlo()
                if SMTP_STARTTLS:
                    server.starttls(context=context)
                    server.ehlo()
                server.login(SMTP_USER, SMTP_PASSWORD)
    except smtplib.SMTPAuthenticationError as e:
        detail = e.smtp_error.decode(errors="replace") if isinstance(e.smtp_error, bytes) else str(e.smtp_error)
        return False, f"Authentication rejected by {SMTP_HOST}: {detail}"
    except (OSError, smtplib.SMTPException) as e:
        return False, f"{type(e).__name__}: {e}"
    return True, "Connected and authenticated."


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def looks_like_email(value: str) -> bool:
    return bool(EMAIL_RE.match(value or ""))
