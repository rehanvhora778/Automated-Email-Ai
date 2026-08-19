"""Build the phishing dataset from two corpora.

Positive class (phishing)
    Jose Nazario's phishing corpus -- mbox archives of real phishing mail
    collected in the wild.  ml/data/raw/phishing/*.mbox

Negative class (not phishing)
    The SpamAssassin folders already downloaded for the spam model:
      easy_ham + hard_ham -> ordinary legitimate mail
      spam + spam_2       -> ordinary junk mail

Including SpamAssassin *spam* in the negative class is deliberate. Phishing is
not the same thing as spam: a detector that shouts "phishing!" at every
promotional email is useless. Keeping junk mail on the negative side forces the
model to separate "unwanted" from "actively trying to steal from you", and the
per-source breakdown in training reports exactly how well it manages that.

Output: ml/data/phishing.csv  with columns [text, label, source]
        label 1 = phishing, 0 = not phishing.

Unlike prepare_data.py this keeps URLs inline: anchor hrefs are spliced into the
text before tags are stripped, so a link that displays "click here" still leaves
its real destination in the text where the URL features can see it.
"""
import email
import email.policy

import re
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw"
PHISH_DIR = RAW / "phishing"
OUT = HERE / "data" / "phishing.csv"

SA_FOLDERS = {"easy_ham": "ham", "hard_ham": "hard_ham", "spam": "spam", "spam_2": "spam"}

_ANCHOR = re.compile(r"""<a\s[^>]*href\s*=\s*["']?([^"'\s>]+)["']?[^>]*>""", re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")
# Cap very long messages: a few phishing mbox entries carry megabytes of
# base64 payload that would dominate TF-IDF without adding signal.
MAX_CHARS = 20_000


def _body_text(msg) -> str:
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
        charset = part.get_content_charset() or "latin-1"
        try:
            text = payload.decode(charset, errors="replace")
        except (LookupError, TypeError):
            text = payload.decode("latin-1", errors="replace")
        (plain if part.get_content_subtype() == "plain" else html).append(text)

    if plain:
        return "\n".join(plain)
    body = "\n".join(html)
    # Splice each link's true destination in beside its anchor, then de-tag.
    body = _ANCHOR.sub(lambda m: f" {m.group(1)} ", body)
    return _TAG.sub(" ", body)


def _clean(subject: str, body: str) -> str | None:
    text = _WS.sub(" ", f"{subject}\n\n{body}").strip()
    return text[:MAX_CHARS] if text else None


def _from_message(msg) -> str | None:
    return _clean(str(msg.get("Subject", "") or ""), _body_text(msg))


def split_mbox(path: Path):
    """Yield raw message bytes from an mbox file, opened READ-ONLY.

    `mailbox.mbox` is the obvious tool but it opens the file 'rb+' -- it wants
    write access so it can lock and rewrite the mailbox. These archives are
    read-only inputs (and live antivirus scanning of a real phishing corpus can
    hold a handle on them), so that call fails with EINVAL on Windows.
    Splitting on the mbox 'From ' separator ourselves needs read access only.
    """
    data = path.read_bytes()
    # Messages start at a line beginning with "From ". Keep the first one too.
    parts = re.split(rb"(?:\r?\n)(?=From \S+)", data)
    for raw in parts:
        raw = raw.strip(b"\r\n")
        if raw.startswith(b"From "):
            raw = raw.split(b"\n", 1)[1] if b"\n" in raw else b""
        if raw.strip():
            yield raw


def load_phishing() -> list[dict]:
    rows = []
    if not PHISH_DIR.is_dir():
        print(f"  ! missing {PHISH_DIR}")
        return rows
    for path in sorted(PHISH_DIR.glob("*.mbox")):
        kept = 0
        try:
            for raw in split_mbox(path):
                try:
                    msg = email.message_from_bytes(raw, policy=email.policy.default)
                    text = _from_message(msg)
                except Exception:
                    continue
                if text:
                    rows.append({"text": text, "label": 1, "source": "phishing"})
                    kept += 1
        except OSError as e:
            print(f"  ! {path.name}: {e}")
            continue
        print(f"  {path.name:24s} -> {kept:5d} phishing")
    return rows


def load_spamassassin() -> list[dict]:
    rows = []
    for folder, source in SA_FOLDERS.items():
        d = RAW / folder
        if not d.is_dir():
            print(f"  ! missing {d}")
            continue
        kept = 0
        for f in sorted(d.iterdir()):
            if not f.is_file() or f.name == "cmds":
                continue
            try:
                msg = email.message_from_bytes(f.read_bytes(), policy=email.policy.default)
                text = _from_message(msg)
            except Exception:
                continue
            if text:
                rows.append({"text": text, "label": 0, "source": source})
                kept += 1
        print(f"  {folder:24s} -> {kept:5d} not-phishing ({source})")
    return rows


def main() -> None:
    print("phishing corpus (Nazario):")
    rows = load_phishing()
    print("\nnegative class (SpamAssassin):")
    rows += load_spamassassin()

    df = pd.DataFrame(rows).drop_duplicates(subset="text").reset_index(drop=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)

    print(f"\nwrote {OUT}")
    print(f"  total        : {len(df)}")
    print(f"  phishing     : {(df.label == 1).sum()}")
    print(f"  not phishing : {(df.label == 0).sum()}")
    print("\nby source:")
    print(df.groupby(["source", "label"]).size().to_string())


if __name__ == "__main__":
    main()
