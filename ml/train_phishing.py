"""Train and evaluate the phishing classifier.

Run:  python train_phishing.py       (after: python prepare_phishing.py)

Unlike the spam model, which is a pure bag-of-words baseline, this one tests
whether hand-engineered phishing signals (URL shape, credential/urgency
language, brand-vs-domain mismatch) add anything on top of TF-IDF. Three
representations are compared head to head:

    1. TF-IDF only
    2. engineered features only
    3. TF-IDF + engineered  (FeatureUnion)

Outputs
  models/phishing_clf.joblib
  models/phishing_metrics.json
  models/phishing_confusion_matrix.png
  models/phishing_feature_importance.png
"""
import json
import time
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.feature_extraction.text import TfidfVectorizer
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
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import LinearSVC

from email_features import FEATURE_NAMES, PhishingFeatures

HERE = Path(__file__).parent
DATA = HERE / "data" / "phishing.csv"
MODELS = HERE / "models"
RANDOM_STATE = 42


def tfidf_block() -> TfidfVectorizer:
    return TfidfVectorizer(
        ngram_range=(1, 2), max_features=50_000, min_df=2, max_df=0.9,
        sublinear_tf=True, strip_accents="unicode", lowercase=True,
    )


def engineered_block() -> Pipeline:
    # Scaling matters here: the linear models are sensitive to feature scale and
    # these columns range from 0/1 flags to URL lengths in the hundreds.
    return Pipeline([("feats", PhishingFeatures()), ("scale", StandardScaler())])


def representations() -> dict:
    return {
        "tfidf_only": lambda: tfidf_block(),
        "engineered_only": lambda: engineered_block(),
        "tfidf_plus_engineered": lambda: FeatureUnion([
            ("tfidf", tfidf_block()),
            ("eng", engineered_block()),
        ]),
    }


def classifier():
    """LinearSVC calibrated to expose predict_proba (the API returns confidence)."""
    return CalibratedClassifierCV(LinearSVC(C=1.0, max_iter=20000, random_state=RANDOM_STATE), cv=3)


HARD_NEGATIVES = HERE / "data" / "hard_negatives.csv"


def load_dataset() -> pd.DataFrame:
    """Corpus plus the synthetic legitimate-security emails.

    The corpora contain almost no ordinary corporate security mail, so without
    these the model learns "security vocabulary => phishing" and flags genuine
    IT notices. See hard_negatives.py for how they are built and why they are a
    documented limitation.
    """
    df = pd.read_csv(DATA).dropna(subset=["text"])
    if HARD_NEGATIVES.exists():
        extra = pd.read_csv(HARD_NEGATIVES).dropna(subset=["text"])
        df = pd.concat([df, extra], ignore_index=True)
        print(f"added {len(extra)} legitimate security emails (hard negatives)")
    else:
        print("! no hard_negatives.csv — run `python ml/hard_negatives.py` first")
    return df.drop_duplicates(subset="text").reset_index(drop=True)


def main() -> None:
    df = load_dataset()
    X, y = df["text"].astype(str), df["label"].astype(int)
    print(f"corpus: {len(df)} emails")
    print(df.groupby(["source", "label"]).size().to_string(), "\n")

    X_tr, X_te, y_tr, y_te, src_tr, src_te = train_test_split(
        X, y, df["source"], test_size=0.2, stratify=y, random_state=RANDOM_STATE
    )
    print(f"train {len(X_tr)}   test {len(X_te)}\n")

    # ---- does feature engineering actually help? ----
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=RANDOM_STATE)
    rep_results = {}
    print("5-fold cross-validated F1 by representation (train split only)")
    print("-" * 60)
    for name, make in representations().items():
        pipe = Pipeline([("features", make()), ("clf", classifier())])
        scores = cross_val_score(pipe, X_tr, y_tr, cv=cv, scoring="f1", n_jobs=-1)
        rep_results[name] = {"mean": float(scores.mean()), "std": float(scores.std())}
        print(f"  {name:24s} {scores.mean():.4f} (+/- {scores.std():.4f})")

    best_rep = max(rep_results, key=lambda k: rep_results[k]["mean"])
    lift = rep_results["tfidf_plus_engineered"]["mean"] - rep_results["tfidf_only"]["mean"]
    print(f"\n  selected: {best_rep}")
    print(f"  lift from engineered features: {lift:+.4f} F1\n")

    # ---- fit the winner, evaluate once on held-out data ----
    best = Pipeline([("features", representations()[best_rep]()), ("clf", classifier())])
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
    print("-" * 60)
    for k, v in metrics.items():
        print(f"  {k:10s} {v:.4f}")

    cm = confusion_matrix(y_te, y_pred)
    tn, fp, fn, tp = cm.ravel()
    print(f"\n  correct non-phishing {tn:4d}   false alarms  {fp:3d}")
    print(f"  caught phishing      {tp:4d}   missed        {fn:3d}")
    print("\n" + classification_report(y_te, y_pred,
                                       target_names=["not phishing", "phishing"], digits=4))

    # ---- the question that actually matters: does it cry phishing at junk mail? ----
    per_source = {}
    print("false-alarm rate by source  (share of non-phishing wrongly flagged)")
    print("-" * 60)
    for source in sorted(src_te.unique()):
        mask = (src_te == source).to_numpy()
        sub_true, sub_pred = y_te[mask], y_pred[mask]
        entry = {"n": int(mask.sum()), "accuracy": float(accuracy_score(sub_true, sub_pred))}
        if source != "phishing":
            entry["false_alarm_rate"] = float((sub_pred == 1).mean())
            note = "  <- ordinary junk, must NOT be called phishing" if source == "spam" else ""
            print(f"  {source:10s} n={entry['n']:4d}  flagged {entry['false_alarm_rate']:.4f}{note}")
        else:
            entry["recall"] = float((sub_pred == 1).mean())
            print(f"  {source:10s} n={entry['n']:4d}  caught  {entry['recall']:.4f}")
        per_source[source] = entry

    # ---- latency ----
    sample = X_te.iloc[:200].tolist()
    best.predict(sample[:10])
    t0 = time.perf_counter()
    best.predict(sample)
    per_email_ms = (time.perf_counter() - t0) / len(sample) * 1000
    print(f"\ninference: {per_email_ms:.3f} ms/email  (train took {fit_secs:.1f}s)")

    # ---- diagnostic: what did the engineered features actually contribute? ----
    # This must be read off the COMBINED model. The selected pipeline may be
    # tfidf_only, whose trailing coefficients are ordinary TF-IDF terms -- slicing
    # those and labelling them with FEATURE_NAMES would be nonsense.
    eng_importance = {}
    try:
        diag = Pipeline([
            ("features", representations()["tfidf_plus_engineered"]()),
            ("clf", classifier()),
        ]).fit(X_tr, y_tr)

        union = diag.named_steps["features"]
        n_tfidf = len(union.transformer_list[0][1].get_feature_names_out())
        clf = diag.named_steps["clf"]
        inner = [c.estimator.coef_[0] for c in clf.calibrated_classifiers_
                 if hasattr(getattr(c, "estimator", None), "coef_")]
        coefs = np.mean(inner, axis=0)

        # FeatureUnion concatenates in order, so engineered columns follow TF-IDF.
        eng_coefs = coefs[n_tfidf:]
        assert len(eng_coefs) == len(FEATURE_NAMES), (
            f"expected {len(FEATURE_NAMES)} engineered columns, got {len(eng_coefs)}"
        )
        eng_importance = {n: float(c) for n, c in zip(FEATURE_NAMES, eng_coefs)}
        ranked = sorted(eng_importance.items(), key=lambda kv: kv[1], reverse=True)
        print("\nengineered features in the COMBINED model (diagnostic — not the")
        print("selected pipeline); strongest phishing signal first")
        print("-" * 60)
        for n, c in ranked[:8]:
            print(f"  {n:24s} {c:+.4f}")

        fig, ax = plt.subplots(figsize=(7, 5))
        names = [n for n, _ in ranked]
        vals = [v for _, v in ranked]
        ax.barh(names[::-1], vals[::-1],
                color=["#d946ef" if v > 0 else "#4f46e5" for v in vals[::-1]])
        ax.set_xlabel("model coefficient  (positive -> phishing)")
        ax.set_title("Engineered features (combined model, diagnostic)")
        fig.tight_layout()
        fig.savefig(MODELS / "phishing_feature_importance.png", dpi=150)
    except Exception as e:
        print(f"  (feature importance unavailable: {e})")

    # ---- persist ----
    MODELS.mkdir(exist_ok=True)
    joblib.dump(best, MODELS / "phishing_clf.joblib")

    payload = {
        "selected_representation": best_rep,
        "representation_cv_f1": rep_results,
        "engineered_feature_lift_f1": lift,
        "classifier": "CalibratedClassifierCV(LinearSVC)",
        "test_metrics": metrics,
        "confusion_matrix": {
            "true_negative": int(tn), "false_alarm": int(fp),
            "missed_phishing": int(fn), "caught_phishing": int(tp),
        },
        "per_source": per_source,
        "engineered_feature_coefficients": eng_importance,
        "inference_ms_per_email": per_email_ms,
        "train_seconds": fit_secs,
        "dataset": {
            "phishing_source": "Nazario phishing corpus",
            "negative_source": "SpamAssassin (ham + hard_ham + spam)",
            "total": int(len(df)),
            "phishing": int((y == 1).sum()),
            "not_phishing": int((y == 0).sum()),
            "train": int(len(X_tr)), "test": int(len(X_te)),
        },
    }
    (MODELS / "phishing_metrics.json").write_text(json.dumps(payload, indent=2))

    fig, ax = plt.subplots(figsize=(5.2, 4.6))
    ConfusionMatrixDisplay(cm, display_labels=["not phishing", "phishing"]).plot(
        ax=ax, cmap="Purples", colorbar=False, values_format="d")
    ax.set_title(f"Phishing - held-out test set (n={len(y_te)})")
    fig.tight_layout()
    fig.savefig(MODELS / "phishing_confusion_matrix.png", dpi=150)

    print(f"\nsaved -> {MODELS / 'phishing_clf.joblib'}")
    print(f"saved -> {MODELS / 'phishing_metrics.json'}")


if __name__ == "__main__":
    main()
