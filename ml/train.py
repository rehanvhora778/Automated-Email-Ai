"""Train and evaluate a spam classifier on the SpamAssassin corpus.

Run:  python train.py          (after: python prepare_data.py)

Benchmarks three classical models on a shared TF-IDF representation, picks the
best by cross-validated F1, evaluates it once on a held-out test set, and saves
the fitted pipeline for the FastAPI backend to load.

Outputs
  models/spam_clf.joblib      fitted Pipeline(tfidf -> classifier)
  models/metrics.json         every number quoted in ml/README.md
  models/confusion_matrix.png
"""
import json
import time
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")               # headless: no display needed
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    ConfusionMatrixDisplay,
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

HERE = Path(__file__).parent
DATA = HERE / "data" / "emails.csv"
MODELS = HERE / "models"
RANDOM_STATE = 42


def build_vectorizer() -> TfidfVectorizer:
    """Word 1-2 grams, ignoring terms that are too rare or too common.

    sublinear_tf dampens the effect of a word repeated 50x in one email, which
    matters here because spam loves repetition.
    """
    return TfidfVectorizer(
        ngram_range=(1, 2),
        max_features=50_000,
        min_df=2,
        max_df=0.9,
        sublinear_tf=True,
        strip_accents="unicode",
        lowercase=True,
    )


def candidates():
    """The three models to compare, each on an identical TF-IDF front end.

    LinearSVC is wrapped in CalibratedClassifierCV so that every candidate
    exposes predict_proba -- the API returns a confidence score, so a bare
    decision_function would not be enough.
    """
    return {
        "MultinomialNB": MultinomialNB(alpha=0.1),
        "LogisticRegression": LogisticRegression(
            max_iter=1000, C=10.0, random_state=RANDOM_STATE
        ),
        "LinearSVC": CalibratedClassifierCV(
            LinearSVC(C=1.0, random_state=RANDOM_STATE), cv=3
        ),
    }


def main() -> None:
    df = pd.read_csv(DATA).dropna(subset=["text"])
    X, y = df["text"].astype(str), df["label"].astype(int)
    print(f"corpus: {len(df)} emails  ({(y == 0).sum()} ham / {(y == 1).sum()} spam)\n")

    # Hold out 20% once, stratified so class balance is preserved.
    X_tr, X_te, y_tr, y_te, src_tr, src_te = train_test_split(
        X, y, df["source"], test_size=0.2, stratify=y, random_state=RANDOM_STATE
    )
    print(f"train: {len(X_tr)}   test: {len(X_te)}\n")

    # ---- model selection: 5-fold CV on the TRAIN split only ----
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    cv_results = {}
    print("5-fold cross-validated F1 on the training split")
    print("-" * 48)
    for name, clf in candidates().items():
        pipe = Pipeline([("tfidf", build_vectorizer()), ("clf", clf)])
        scores = cross_val_score(pipe, X_tr, y_tr, cv=cv, scoring="f1", n_jobs=-1)
        cv_results[name] = {"mean": float(scores.mean()), "std": float(scores.std())}
        print(f"  {name:20s} {scores.mean():.4f} (+/- {scores.std():.4f})")

    best_name = max(cv_results, key=lambda k: cv_results[k]["mean"])
    print(f"\nselected: {best_name}\n")

    # ---- fit the winner, evaluate ONCE on the untouched test split ----
    best = Pipeline([("tfidf", build_vectorizer()), ("clf", candidates()[best_name])])
    t0 = time.perf_counter()
    best.fit(X_tr, y_tr)
    fit_secs = time.perf_counter() - t0

    y_pred = best.predict(X_te)
    y_prob = best.predict_proba(X_te)[:, 1]

    metrics = {
        "accuracy": accuracy_score(y_te, y_pred),
        "precision": precision_score(y_te, y_pred),
        "recall": recall_score(y_te, y_pred),
        "f1": f1_score(y_te, y_pred),
        "roc_auc": roc_auc_score(y_te, y_prob),
    }
    print("held-out test set")
    print("-" * 48)
    for k, v in metrics.items():
        print(f"  {k:10s} {v:.4f}")

    cm = confusion_matrix(y_te, y_pred)
    tn, fp, fn, tp = cm.ravel()
    print(f"\n  true ham  {tn:4d}   false spam {fp:3d}  <- legit mail wrongly flagged")
    print(f"  true spam {tp:4d}   missed spam {fn:3d}")
    print("\n" + classification_report(y_te, y_pred, target_names=["ham", "spam"]))

    # ---- the interesting slice: hard_ham is opt-in marketing that LOOKS like spam ----
    per_source = {}
    for source in sorted(src_te.unique()):
        mask = (src_te == source).to_numpy()
        per_source[source] = {
            "n": int(mask.sum()),
            "accuracy": float(accuracy_score(y_te[mask], y_pred[mask])),
        }
    print("accuracy by corpus folder")
    print("-" * 48)
    for s, r in per_source.items():
        note = "  <- looks like spam, but isn't" if s == "hard_ham" else ""
        print(f"  {s:10s} n={r['n']:4d}  {r['accuracy']:.4f}{note}")

    # ---- latency: the whole argument for using this instead of an LLM call ----
    sample = X_te.iloc[:200].tolist()
    best.predict(sample[:10])                       # warm up
    t0 = time.perf_counter()
    best.predict(sample)
    per_email_ms = (time.perf_counter() - t0) / len(sample) * 1000
    print(f"\ninference: {per_email_ms:.3f} ms/email  (train took {fit_secs:.1f}s)")

    # ---- interpretability: what the model actually keys on ----
    top_features = {}
    clf = best.named_steps["clf"]
    coefs = None
    if hasattr(clf, "coef_"):
        coefs = clf.coef_[0]
    elif hasattr(clf, "feature_log_prob_"):
        coefs = clf.feature_log_prob_[1] - clf.feature_log_prob_[0]
    elif hasattr(clf, "calibrated_classifiers_"):
        # CalibratedClassifierCV hides the linear model one level down: average
        # the coefficients of the per-fold base estimators.
        inner = [
            c.estimator.coef_[0]
            for c in clf.calibrated_classifiers_
            if hasattr(getattr(c, "estimator", None), "coef_")
        ]
        if inner:
            coefs = np.mean(inner, axis=0)
    if coefs is not None:
        names = best.named_steps["tfidf"].get_feature_names_out()
        order = np.argsort(coefs)
        top_features = {
            "spam": [str(names[i]) for i in order[-20:][::-1]],
            "ham": [str(names[i]) for i in order[:20]],
        }
        print(f"\ntop spam indicators: {', '.join(top_features['spam'][:10])}")
        print(f"top ham  indicators: {', '.join(top_features['ham'][:10])}")

    # ---- persist ----
    MODELS.mkdir(exist_ok=True)
    joblib.dump(best, MODELS / "spam_clf.joblib")

    payload = {
        "selected_model": best_name,
        "cv_f1": cv_results,
        "test_metrics": metrics,
        "confusion_matrix": {
            "true_ham": int(tn), "false_spam": int(fp),
            "missed_spam": int(fn), "true_spam": int(tp),
        },
        "per_source_accuracy": per_source,
        "inference_ms_per_email": per_email_ms,
        "train_seconds": fit_secs,
        "dataset": {
            "name": "SpamAssassin public corpus",
            "total": int(len(df)), "ham": int((y == 0).sum()), "spam": int((y == 1).sum()),
            "train": int(len(X_tr)), "test": int(len(X_te)),
        },
        "top_features": top_features,
    }
    (MODELS / "metrics.json").write_text(json.dumps(payload, indent=2))

    fig, ax = plt.subplots(figsize=(5, 4.5))
    ConfusionMatrixDisplay(cm, display_labels=["ham", "spam"]).plot(
        ax=ax, cmap="Blues", colorbar=False, values_format="d"
    )
    ax.set_title(f"{best_name} - held-out test set (n={len(y_te)})")
    fig.tight_layout()
    fig.savefig(MODELS / "confusion_matrix.png", dpi=150)

    print(f"\nsaved -> {MODELS / 'spam_clf.joblib'}")
    print(f"saved -> {MODELS / 'metrics.json'}")
    print(f"saved -> {MODELS / 'confusion_matrix.png'}")


if __name__ == "__main__":
    main()
