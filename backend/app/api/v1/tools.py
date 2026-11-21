"""AI writing tools and the locally trained threat classifiers.

Writing tools expose a buffered endpoint (/tool) and a token-streaming one
(/tool/stream) so the UI can render output as it is generated.

/classify/* serve the scikit-learn models trained in ml/ — no LLM call, no
network, sub-millisecond. The spam and phishing tools use both: the model
supplies the verdict, the LLM supplies the prose explanation.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.deps import CurrentUser
from app.services.ai_service import SecretaryAI
from app.services import llm, ml_service
from app.services.llm import LLMError

router = APIRouter()
ai = SecretaryAI()

# Ends a stream that broke after text had already been sent, when an HTTP
# error status is no longer possible. The frontend strips it and reports the
# message that follows as an error, so it never lands in text a user copies.
STREAM_ERROR_MARKER = "\n\n[stream error] "

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
    # Both fields go straight into the LLM prompt, so they are bounded
    # here: an oversized body is rejected by validation before any call is
    # made rather than after the tokens have been spent.
    input: str = Field("", max_length=20000)
    context: Optional[str] = Field("", max_length=4000)


def _require_input(req: ToolRequest):
    if req.action not in ALLOWED_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action '{req.action}'")
    if not (req.input or "").strip():
        raise HTTPException(status_code=400, detail="Please enter some text for the tool to work on.")


# The writing tools below proxy this deployment's LLM keys -- the quota that
# chat, smart replies and the inbox briefing all share -- so the caller has to
# hold a session rather than merely know the URL. The /classify routes run
# locally but take the same session; /classify/health and /status are left
# open, since they return only stored metrics and configuration, no user data.
#
# Both routes are `def`, not `async def`: the LLM call blocks, and a sync route
# runs in a worker thread instead of stalling every other request in flight.
@router.post("/tool")
def run_tool(req: ToolRequest, user_id: CurrentUser):
    _require_input(req)

    # Local classifier first: it costs ~0.3ms, so the verdict is ready long
    # before the LLM responds. The LLM still runs — it supplies the prose
    # explanation the model cannot give.
    ml_result = None
    classifier = ML_CLASSIFIERS.get(req.action)
    if classifier:
        ml_result = classifier(req.input)

    try:
        result = ai.run_tool(
            action=req.action,
            input_text=req.input,
            context=req.context or "",
        )
    except LLMError as e:
        print(f"tool: AI unavailable ({e.kind}): {e.detail}")
        raise HTTPException(status_code=503, detail=e.user_message)

    if ml_result and ml_result.get("available"):
        result["ml"] = ml_result
    return result


@router.post("/tool/stream")
def run_tool_stream(req: ToolRequest, user_id: CurrentUser):
    _require_input(req)

    # Opened before the response starts, with every provider fallback already
    # tried, so a failure is a real 503 with a readable detail rather than an
    # HTTP 200 whose body is an exception message.
    try:
        deltas = ai.stream_tool(
            action=req.action,
            input_text=req.input,
            context=req.context or "",
        )
    except LLMError as e:
        print(f"tool stream: AI unavailable ({e.kind}): {e.detail}")
        raise HTTPException(status_code=503, detail=e.user_message)

    def relay():
        try:
            for chunk in deltas:
                yield chunk
        except LLMError as e:
            print(f"tool stream: broke mid-answer ({e.kind}): {e.detail}")
            yield STREAM_ERROR_MARKER + "The answer was cut off. Please try again."

    return StreamingResponse(
        relay(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/status")
def ai_status():
    """Which LLM providers this deployment has keys for, and how each last fared.

    Lets an operator confirm a key reached the server, and see a quota being
    hit, without access to the host's logs. Never returns a key.
    """
    return llm.status()


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20000, description="Raw email text (subject + body)")


@router.post("/classify/spam")
async def classify_spam(req: ClassifyRequest, user_id: CurrentUser):
    """Score an email with the locally trained classifier — no LLM, no network.

    Returns a verdict, a calibrated confidence, and the terms in this specific
    email that drove the decision. Typical latency is under a millisecond,
    versus several hundred for the LLM-backed `spam_detection` tool.
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
async def classify_phishing(req: ClassifyRequest, user_id: CurrentUser):
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
