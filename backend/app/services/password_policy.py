"""Shared password rules.

One definition, applied everywhere a password is set — signup and reset both go
through the backend, so neither can drift from the other or be bypassed by
calling the API directly. The frontend mirrors these rules for live feedback,
but this module is what actually decides.
"""
import re

MIN_LENGTH = 8
# Long enough to be a passphrase, short enough that bcrypt's 72-byte input
# limit is never reached.
MAX_LENGTH = 72

# Ordered as they are shown to the user, so the checklist and the error agree.
RULES: list[tuple[str, str]] = [
    (rf"^.{{{MIN_LENGTH},}}$", f"at least {MIN_LENGTH} characters"),
    (r"[A-Z]", "an uppercase letter"),
    (r"[a-z]", "a lowercase letter"),
    (r"[0-9]", "a number"),
    (r"[^A-Za-z0-9]", "a special character"),
]


def unmet(password: str) -> list[str]:
    """Which requirements this password fails, in display order."""
    value = password or ""
    return [label for pattern, label in RULES if not re.search(pattern, value, re.DOTALL)]


def describe_failure(password: str) -> str | None:
    """A single sentence naming what is missing, or None when it passes."""
    if len(password or "") > MAX_LENGTH:
        return f"Password must be at most {MAX_LENGTH} characters."

    missing = unmet(password)
    if not missing:
        return None

    if len(missing) == 1:
        return f"Password must contain {missing[0]}."
    return "Password must contain " + ", ".join(missing[:-1]) + f" and {missing[-1]}."
