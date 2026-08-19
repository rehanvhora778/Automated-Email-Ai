"""AI writing tools and the locally trained threat classifiers.

Writing tools expose a buffered endpoint (/tool) and a token-streaming one
(/tool/stream) so the UI can render output as it is generated.

/classify/* serve the scikit-learn models trained in ml/ — no LLM call, no
network, sub-millisecond. The spam and phishing tools use both: the model
supplies the verdict, Mistral supplies the prose explanation.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.services.ai_service import SecretaryAI
from app.services import ml_service

router = APIRouter()
ai = SecretaryAI()

# Actions that also get a verdict from a locally trained classifier.
ML_CLASSIFIERS = {
    "spam_detection": ml_service.classify_spam,
    "phishing_detection": ml_service.classify_phishing,
}

ALLOWED_ACTIONS = {
    "translate", "improve", "rewrite", "custom", "grammar_fix", "summarize",
    "tone_detection", "spam_detection", "phishing_detection",
}


class ToolRequest(BaseModel):
    action: str
    input: str = ""
    context: Optional[str] = ""


@router.post("/tool")
async def run_tool(req: ToolRequest):
    if req.action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")

    # Local classifier first: it costs ~0.3ms, so the verdict is ready long
    # before Mistral responds. The LLM still runs — it supplies the prose
    # explanation the model cannot give.
    ml_result = None
    classifier = ML_CLASSIFIERS.get(req.action)
    if classifier:
        ml_result = classifier(req.input)

    result = ai.run_tool(
        action=req.action,
        input_text=req.input,
        context=req.context or "",
    )
    if result.get("error"):
        raise HTTPException(status_code=502, detail=result["error"])

    if ml_result and ml_result.get("available"):
        result["ml"] = ml_result
    return result


@router.post("/tool/stream")
async def run_tool_stream(req: ToolRequest):
    if req.action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")

    def generate():
        try:
            for chunk in ai.stream_tool(
                action=req.action,
                input_text=req.input,
                context=req.context or "",
            ):
                yield chunk
        except Exception as e:
            print(f"tool stream error: {e}")
            yield f"\n\n[stream error] {e}"

    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Raw email text (subject + body)")


@router.post("/classify/spam")
async def classify_spam(req: ClassifyRequest):
    """Score an email with the locally trained classifier — no LLM, no network.

    Returns a verdict, a calibrated confidence, and the terms in this specific
    email that drove the decision. Typical latency is under a millisecond,
    versus several hundred for the Mistral-backed `spam_detection` tool.
    """
    result = ml_service.classify_spam(req.text)
    if not result.get("available"):
        reason = result.get("reason", "unavailable")
        if reason == "text_too_short":
            raise HTTPException(
                status_code=400,
                detail=f"Text must be at least {ml_service.MIN_CHARS} characters to classify.",
            )
        raise HTTPException(
            status_code=503,
            detail="Spam model not loaded. Run `python ml/train.py` to build it.",
        )
    return result


@router.post("/classify/phishing")
async def classify_phishing(req: ClassifyRequest):
    """Score an email for phishing with the locally trained classifier.

    A different question from spam: junk mail is *unwanted*, phishing is an
    active attempt to steal credentials or money. The model is trained with
    ordinary spam on the negative side so it does not flag every marketing
    email as an attack.
    """
    result = ml_service.classify_phishing(req.text)
    if not result.get("available"):
        if result.get("reason") == "text_too_short":
            raise HTTPException(
                status_code=400,
                detail=f"Text must be at least {ml_service.MIN_CHARS} characters to classify.",
            )
        raise HTTPException(
            status_code=503,
            detail="Phishing model not loaded. Run `python ml/train_phishing.py` to build it.",
        )
    return result


@router.get("/classify/health")
async def classify_health():
    """Model status plus the evaluation metrics recorded at training time."""
    import json

    def _describe(path, metrics_name):
        info = {"model_path": str(path)}
        try:
            saved = json.loads((path.parent / metrics_name).read_text())
            info["test_metrics"] = saved.get("test_metrics")
            info["dataset"] = saved.get("dataset")
            info["selected"] = saved.get("selected_model") or saved.get("selected_representation")
        except Exception:
            pass
        return info

    spam = _describe(ml_service.MODEL_PATH, "metrics.json")
    spam["available"] = ml_service.is_available()

    phishing = _describe(ml_service.PHISHING_MODEL_PATH, "phishing_metrics.json")
    phishing["available"] = ml_service.phishing_available()

    return {"spam": spam, "phishing": phishing}
