"""Outbound transactional email over SMTP.

Deliberately plain SMTP rather than a provider SDK: it works with Gmail app
passwords, Brevo, Mailgun, Amazon SES and anything else the deployment cares to
point it at, without another dependency or vendor account to manage.

This is only for mail the *system* sends about itself — verification codes and
the like. Mail sent on a user's behalf still goes through the Gmail API in
gmail_service, so it appears in their Sent folder under their own address.
"""
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

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


class MailerNotConfigured(RuntimeError):
    """Raised when no SMTP credentials are present."""


def is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASSWORD and SMTP_FROM)


def _require_config() -> None:
    if not is_configured():
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
        raise MailerNotConfigured(
            "Email sending is not configured on the server. Missing: " + ", ".join(missing)
        )


def send_email(to: str, subject: str, text_body: str, html_body: str | None = None) -> None:
    """Send one message. Raises on failure so callers can report it honestly."""
    _require_config()

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
