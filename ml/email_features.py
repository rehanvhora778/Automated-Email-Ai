"""Hand-engineered phishing features, shared by training and serving.

This module is imported by BOTH `ml/train_phishing.py` and the FastAPI backend.
That is deliberate: the fitted pipeline pickles a reference to
`email_features.PhishingFeatures`, so the class must be importable under the
same name in both processes or `joblib.load` fails. Keeping one copy also
removes the usual source of train/serve skew -- features computed one way
during training and a subtly different way in production.

Design constraint: every feature here is computable from the email TEXT ALONE.
Header-derived signals (Reply-To mismatch, SPF/DKIM results, sender domain age)
are genuinely strong phishing indicators, but the API receives whatever the user
pasted into the box -- usually a body with no headers. Training on signals that
are absent at inference time would inflate offline metrics and quietly degrade
in production, so they are deliberately excluded. See ml/README.md.
"""
import re
from urllib.parse import urlparse

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin

# --- lexicons -------------------------------------------------------------

URGENCY = (
    "urgent", "immediately", "act now", "as soon as possible", "expire",
    "expires", "expiring", "deadline", "within 24 hours", "last chance",
    "final notice", "time sensitive", "promptly", "right away",
)
CREDENTIAL = (
    "password", "username", "user name", "login", "log in", "sign in",
    "credentials", "pin number", "social security", "ssn", "credit card",
    "card number", "account number", "cvv", "billing information",
    "verify your account", "confirm your identity", "update your details",
)
THREAT = (
    "suspend", "suspended", "suspension", "terminate", "terminated",
    "deactivate", "disabled", "locked", "restricted", "unauthorized",
    "unusual activity", "security alert", "fraud", "violation", "closed",
)
ACTION = (
    "click here", "click below", "click the link", "follow the link",
    "verify now", "confirm now", "update now", "log in now", "download now",
)
GENERIC_GREETING = (
    "dear customer", "dear user", "dear member", "dear client",
    "dear valued customer", "dear account holder", "dear sir/madam",
    "valued customer", "dear friend",
)
# Brands impersonated in phishing far more often than they appear in normal mail.
BRANDS = (
    "paypal", "ebay", "amazon", "apple", "microsoft", "netflix", "chase",
    "wells fargo", "bank of america", "citibank", "hsbc", "barclays",
    "irs", "dhl", "fedex", "ups", "docusign", "office365", "outlook",
)
SHORTENERS = (
    "bit.ly", "tinyurl.com", "goo.gl", "t.co", "ow.ly", "is.gd", "buff.ly",
    "adf.ly", "tiny.cc", "cutt.ly", "rebrand.ly", "shorturl.at",
)
# TLDs that are free or near-free to register, heavily abused for phishing.
SUSPICIOUS_TLD = (
    ".tk", ".ml", ".ga", ".cf", ".gq", ".xyz", ".top", ".work", ".click",
    ".link", ".review", ".country", ".kim", ".science", ".zip", ".mov",
)

# The signature of a LEGITIMATE security email: it tells you not to share
# secrets, and points at a route you already trust instead of supplying a link.
# Phishing almost never says these things -- it needs you to hand something over.
REASSURANCE = (
    "never ask you for your password", "never ask for your password",
    "we will never ask", "never request your credentials",
    "do not need to send your password", "do not need to send",
    "never ask you to share", "will never request",
    "do not share your", "never share your password",
    "we never ask for passwords", "report it to security",
)
SAFE_ROUTE = (
    "bookmarked link", "your usual bookmark", "from your bookmarks",
    "rather than following a link", "navigate to the portal yourself",
    "sign in the way you normally do", "via the intranet", "desktop shortcut",
    "directly from the app", "type the address yourself",
)
NO_ACTION = (
    "no further action is required", "no action is needed", "nothing further to do",
    "no response is needed", "you can ignore this message", "requires no action",
    "if this was you", "this is a routine",
)

_URL_RE = re.compile(r"https?://[^\s<>\"')]+", re.I)
_IP_HOST_RE = re.compile(r"^\d{1,3}(\.\d{1,3}){3}$")
_HEX_HOST_RE = re.compile(r"0x[0-9a-f]+", re.I)

# Every feature this transformer emits, in output-column order.
FEATURE_NAMES = [
    "n_urls", "n_unique_domains", "has_ip_url", "has_shortener",
    "has_suspicious_tld", "has_at_in_url", "has_hex_host", "max_url_len",
    "n_urgency", "n_credential", "n_threat", "n_action",
    "has_generic_greeting", "n_brands", "brand_domain_mismatch",
    "n_exclamations", "caps_ratio", "n_digits_ratio",
    "has_password_input", "has_form", "log_len",
    # legitimacy signals -- these push AWAY from phishing
    "n_reassurance", "has_safe_route", "has_no_action_needed",
]


def _domains(urls):
    out = []
    for u in urls:
        try:
            host = (urlparse(u).hostname or "").lower()
        except ValueError:
            continue
        if host:
            out.append(host)
    return out


def extract_one(text: str) -> list[float]:
    """Compute the feature vector for a single email. Never raises."""
    text = text or ""
    low = text.lower()
    n_chars = max(len(text), 1)

    urls = _URL_RE.findall(text)
    hosts = _domains(urls)
    uniq_hosts = set(hosts)

    n_urls = len(urls)
    n_unique_domains = len(uniq_hosts)
    has_ip_url = float(any(_IP_HOST_RE.match(h) for h in hosts))
    has_shortener = float(any(any(s in h for s in SHORTENERS) for h in hosts))
    has_suspicious_tld = float(any(h.endswith(t) for h in hosts for t in SUSPICIOUS_TLD))
    # user@host in a URL hides the real destination after the '@'
    has_at_in_url = float(any("@" in u.split("://", 1)[-1].split("/", 1)[0] for u in urls))
    has_hex_host = float(any(_HEX_HOST_RE.search(h) for h in hosts))
    max_url_len = float(max((len(u) for u in urls), default=0))

    n_urgency = sum(low.count(w) for w in URGENCY)
    n_credential = sum(low.count(w) for w in CREDENTIAL)
    n_threat = sum(low.count(w) for w in THREAT)
    n_action = sum(low.count(w) for w in ACTION)
    has_generic_greeting = float(any(g in low for g in GENERIC_GREETING))

    brands_present = [b for b in BRANDS if b in low]
    n_brands = float(len(brands_present))
    # The classic tell: the email says "PayPal" but no link points at paypal.com.
    brand_domain_mismatch = 0.0
    if brands_present and uniq_hosts:
        token = brands_present[0].replace(" ", "")
        brand_domain_mismatch = float(not any(token in h for h in uniq_hosts))

    n_exclamations = float(text.count("!"))
    letters = [c for c in text if c.isalpha()]
    caps_ratio = (sum(c.isupper() for c in letters) / len(letters)) if letters else 0.0
    n_digits_ratio = sum(c.isdigit() for c in text) / n_chars

    # Counting these separately from the threat lexicon matters: an email can be
    # full of security vocabulary *because* it is warning you about phishing.
    n_reassurance = float(sum(low.count(w) for w in REASSURANCE))
    has_safe_route = float(any(w in low for w in SAFE_ROUTE))
    has_no_action_needed = float(any(w in low for w in NO_ACTION))

    has_password_input = float('type="password"' in low or "type=password" in low)
    has_form = float("<form" in low)
    log_len = float(np.log1p(n_chars))

    return [
        float(n_urls), float(n_unique_domains), has_ip_url, has_shortener,
        has_suspicious_tld, has_at_in_url, has_hex_host, max_url_len,
        float(n_urgency), float(n_credential), float(n_threat), float(n_action),
        has_generic_greeting, n_brands, brand_domain_mismatch,
        n_exclamations, float(caps_ratio), float(n_digits_ratio),
        has_password_input, has_form, log_len,
        n_reassurance, has_safe_route, has_no_action_needed,
    ]


class PhishingFeatures(BaseEstimator, TransformerMixin):
    """Turn raw email text into the numeric feature block defined above.

    Stateless -- `fit` exists only to satisfy the scikit-learn API, so this is
    safe to place inside a Pipeline or FeatureUnion without leaking test data.
    """

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return np.asarray([extract_one(t) for t in X], dtype=np.float64)

    def get_feature_names_out(self, input_features=None):
        return np.asarray(FEATURE_NAMES, dtype=object)
