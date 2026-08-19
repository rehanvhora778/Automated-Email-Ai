"""Parse the SpamAssassin public corpus into a single tidy CSV.

Raw input : ml/data/raw/{easy_ham,hard_ham,spam,spam_2}/<message files>
Output    : ml/data/emails.csv  with columns [text, label, source]

`label` is 1 for spam, 0 for ham. `source` keeps the original folder so the
notebook can report accuracy on `hard_ham` separately -- those are genuine
opt-in marketing emails that look like spam, and they are where naive models
actually fail.
"""
import email
import email.policy
import re
from pathlib import Path

import pandas as pd

RAW = Path(__file__).parent / "data" / "raw"
OUT = Path(__file__).parent / "data" / "emails.csv"

# folder -> label (1 = spam)
FOLDERS = {"easy_ham": 0, "hard_ham": 0, "spam": 1, "spam_2": 1}

_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _body_text(msg) -> str:
    """Best-effort plain-text body, preferring text/plain over text/html."""
    plain, html = [], []
    for part in msg.walk():
        if part.get_content_maintype() != "text":
            continue
        try:
            payload = part.get_payload(decode=True)
        except Exception:
            continue
        if not payload:
            continue
        # Spam frequently declares a bogus/unknown charset on purpose, so fall
        # back to latin-1 (which never raises) instead of dropping the message.
        charset = part.get_content_charset() or "latin-1"
        try:
            text = payload.decode(charset, errors="replace")
        except (LookupError, TypeError):
            text = payload.decode("latin-1", errors="replace")
        (plain if part.get_content_subtype() == "plain" else html).append(text)

    body = "\n".join(plain) if plain else "\n".join(html)
    if not plain and html:
        body = _TAG.sub(" ", body)          # crude de-HTML; keeps the words
    return body


def parse_file(path: Path) -> str | None:
    """Return 'subject + body' for one raw message file, or None if unusable."""
    try:
        raw = path.read_bytes()
    except OSError:
        return None
    try:
        msg = email.message_from_bytes(raw, policy=email.policy.default)
    except Exception:
        return None

    subject = str(msg.get("Subject", "") or "")
    text = f"{subject}\n\n{_body_text(msg)}"
    text = _WS.sub(" ", text).strip()
    return text or None


def main() -> None:
    rows = []
    for folder, label in FOLDERS.items():
        d = RAW / folder
        if not d.is_dir():
            print(f"  ! missing folder: {d}")
            continue
        kept = 0
        for f in sorted(d.iterdir()):
            if not f.is_file() or f.name == "cmds":   # corpus ships a 'cmds' script
                continue
            text = parse_file(f)
            if text:
                rows.append({"text": text, "label": label, "source": folder})
                kept += 1
        print(f"  {folder:10s} -> {kept:5d} messages (label={label})")

    df = pd.DataFrame(rows).drop_duplicates(subset="text").reset_index(drop=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)

    print(f"\nwrote {OUT}")
    print(f"  total : {len(df)}")
    print(f"  ham   : {(df.label == 0).sum()}")
    print(f"  spam  : {(df.label == 1).sum()}")


if __name__ == "__main__":
    main()
