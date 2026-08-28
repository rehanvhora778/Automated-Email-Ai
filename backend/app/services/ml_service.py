"""Local spam and phishing classifiers — trained scikit-learn models, no API call.

Loads the pipelines produced by `ml/train.py` and `ml/train_phishing.py` and
scores an email in about a millisecond. This exists alongside the Mistral-powered
`spam_detection` tool rather than replacing it: the classifier is fast, free
and deterministic, while the LLM explains its reasoning in prose. The API
returns both so the UI can show a verdict instantly and the narrative after.

Both model files are optional and loaded independently. If one is missing
(fresh clone, nobody has trained yet) its calls degrade to `available: False`
and the caller falls back to the LLM path alone; the other still works.
"""
import os
import sys
import time
from pathlib import Path
from threading import Lock

import numpy as np

# backend/app/services/ml_service.py -> repo root is three parents up
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ML_DIR = _REPO_ROOT / "ml"
_DEFAULT_MODEL = _ML_DIR / "models" / "spam_clf.joblib"
_DEFAULT_PHISHING_MODEL = _ML_DIR / "models" / "phishing_clf.joblib"

# Deployments that ship the models elsewhere can point at them explicitly.
MODEL_PATH = Path(os.getenv("SPAM_MODEL_PATH", str(_DEFAULT_MODEL)))
PHISHING_MODEL_PATH = Path(os.getenv("PHISHING_MODEL_PATH", str(_DEFAULT_PHISHING_MODEL)))

# The phishing pipeline pickles a reference to `email_features.PhishingFeatures`,
# so that module must be importable under the same name here as it was during
# training or joblib.load raises ModuleNotFoundError. Keeping one shared copy in
# ml/ is what guarantees training and serving compute features identically.
if str(_ML_DIR) not in sys.path:
    sys.path.insert(0, str(_ML_DIR))

# Below this the message is too short to score honestly — a two-word email
# carries almost no signal and the model would report a confident coin flip.
MIN_CHARS = 20

# One cache entry per model path: value is the pipeline, or False once loading
# has failed (so a missing file is not retried on every request).
_models: dict[str, object] = {}
_lock = Lock()


def _load(path: Path, label: str, train_cmd: str):
    """Load a pipeline once, on first use. Never raises."""
    key = str(path)
    cached = _models.get(key)
    if cached is not None:
        return cached or None
    with _lock:
        cached = _models.get(key)
        if cached is not None:
            return cached or None
        try:
            import joblib

            model = joblib.load(path)
            _models[key] = model
            print(f"ml_service: loaded {label} from {path}")
            return model
        except FileNotFoundError:
            print(f"ml_service: no model at {path} — run `{train_cmd}`")
        except Exception as e:
            print(f"ml_service: failed to load {label}: {e}")
        _models[key] = False
    return None


def _load_spam():
    return _load(MODEL_PATH, "spam classifier", "python ml/train.py")


def _load_phishing():
    return _load(PHISHING_MODEL_PATH, "phishing classifier", "python ml/train_phishing.py")


def is_available() -> bool:
    """True when the spam model is loaded (kept for backwards compatibility)."""
    return _load_spam() is not None


def phishing_available() -> bool:
    return _load_phishing() is not None


def _top_signals(model, text: str, limit: int = 6) -> list[str]:
    """The features in THIS email that pushed the score toward the positive class.

    Multiplies each feature's value by its model coefficient, so the list
    reflects the actual decision for this message rather than global feature
    importance. Best-effort: returns [] if the pipeline shape is unexpected.

    Works for either pipeline shape used here — the spam model names its
    vectorizer step "tfidf", the phishing model names it "features" and it may
    be a FeatureUnion — by taking whatever the first step is and asking it for
    its own output names.
    """
    try:
        steps = getattr(model, "named_steps", {})
        clf = steps.get("clf")
        featurizer = steps.get("tfidf") or steps.get("features")
        if clf is None or featurizer is None:
            return []

        if hasattr(clf, "coef_"):
            coefs = clf.coef_[0]
        elif hasattr(clf, "calibrated_classifiers_"):
            inner = [
                c.estimator.coef_[0]
                for c in clf.calibrated_classifiers_
                if hasattr(getattr(c, "estimator", None), "coef_")
            ]
            if not inner:
                return []
            coefs = np.mean(inner, axis=0)
        else:
            return []

        vec = featurizer.transform([text])
        names = featurizer.get_feature_names_out()

        # A FeatureUnion mixing sparse TF-IDF with dense engineered columns can
        # come back either sparse or dense, so normalise to a flat array.
        row = vec.toarray()[0] if hasattr(vec, "toarray") else np.asarray(vec)[0]
        idx = np.nonzero(row)[0]
        if idx.size == 0 or len(coefs) != len(row):
            return []

        contrib = row[idx] * coefs[idx]
        order = np.argsort(contrib)[::-1]
        return [str(names[idx[i]]) for i in order[:limit] if contrib[i] > 0]
    except Exception as e:
        print(f"ml_service: signal extraction warning: {e}")
        return []


def classify_spam(text: str) -> dict:
    """Score one email.

    Returns a dict that is always JSON-safe:
      available   bool   False when the model could not be loaded / text too short
      verdict     str    "Spam" | "Suspicious" | "Not spam"
      is_spam     bool
      confidence  float  0-100, the probability of the predicted class
      spam_probability float 0-100
      signals     list[str]
      latency_ms  float
      model       str
    """
    text = (text or "").strip()
    model = _load_spam()

    if model is None:
        return {"available": False, "reason": "model_not_loaded"}
    if len(text) < MIN_CHARS:
        return {"available": False, "reason": "text_too_short"}

    t0 = time.perf_counter()
    try:
        spam_prob = float(model.predict_proba([text])[0][1])
    except Exception as e:
        print(f"ml_service: prediction failed: {e}")
        return {"available": False, "reason": "prediction_failed"}
    latency_ms = (time.perf_counter() - t0) * 1000

    # Three bands rather than a hard 0.5 cut. The middle band is where the
    # model is genuinely unsure and the LLM's explanation earns its latency.
    if spam_prob >= 0.80:
        verdict = "Spam"
    elif spam_prob >= 0.45:
        verdict = "Suspicious"
    else:
        verdict = "Not spam"

    return {
        "available": True,
        "verdict": verdict,
        "is_spam": spam_prob >= 0.5,
        "confidence": round(max(spam_prob, 1 - spam_prob) * 100, 1),
        "spam_probability": round(spam_prob * 100, 1),
        "signals": _top_signals(model, text),
        "latency_ms": round(latency_ms, 3),
        "model": "TF-IDF + LinearSVC (SpamAssassin + business ham)",
    }


def classify_phishing(text: str) -> dict:
    """Score one email for phishing — a different question from spam.

    Spam is unwanted; phishing is an active attempt to steal credentials or
    money. The model is trained with ordinary junk mail on the NEGATIVE side
    precisely so it does not shout "phishing" at every marketing email.

    Same response shape as classify_spam, with phishing-specific verdicts:
      verdict  "Phishing" | "Suspicious" | "Safe"
    """
    text = (text or "").strip()
    model = _load_phishing()

    if model is None:
        return {"available": False, "reason": "model_not_loaded"}
    if len(text) < MIN_CHARS:
        return {"available": False, "reason": "text_too_short"}

    t0 = time.perf_counter()
    try:
        phish_prob = float(model.predict_proba([text])[0][1])
    except Exception as e:
        print(f"ml_service: phishing prediction failed: {e}")
        return {"available": False, "reason": "prediction_failed"}
    latency_ms = (time.perf_counter() - t0) * 1000

    # Deliberately asymmetric. Calling a real email "phishing" trains users to
    # ignore the warning, so the top band requires high confidence and the wide
    # middle band says "suspicious" instead.
    if phish_prob >= 0.80:
        verdict = "Phishing"
    elif phish_prob >= 0.45:
        verdict = "Suspicious"
    else:
        verdict = "Safe"

    return {
        "available": True,
        "verdict": verdict,
        "is_phishing": phish_prob >= 0.5,
        "confidence": round(max(phish_prob, 1 - phish_prob) * 100, 1),
        "phishing_probability": round(phish_prob * 100, 1),
        "signals": _top_signals(model, text),
        "latency_ms": round(latency_ms, 3),
        "model": "TF-IDF + LinearSVC (Nazario phishing + SpamAssassin)",
    }
