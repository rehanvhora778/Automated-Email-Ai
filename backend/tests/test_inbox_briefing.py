"""The inbox briefing's fallback when the AI half fails or answers oddly.

Run from the backend directory:
    .venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import inbox_briefing  # noqa: E402
from app.services.llm import LLMError  # noqa: E402


def record(ref="E1"):
    return {
        "id": "m1", "ref": ref, "thread_id": "t1", "sender_name": "Priya", "sender_email": "p@x.com",
        "subject": "Contract", "snippet": "Please sign by Friday", "body": "Please sign by Friday.",
        "date": "Fri", "date_ms": 0, "unread": True, "category": "Primary", "bulk": False,
        "automated": False, "important": True, "starred": False, "addressing": "direct",
        "in_thread": False, "bounce": None, "labels": [],
    }


class FakeAI:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    def analyze_inbox(self, *args, **kwargs):
        if self.error:
            raise self.error
        return self.result


class BriefingFallbackTest(unittest.TestCase):
    def test_a_rate_limit_degrades_and_says_why(self):
        ai = FakeAI(error=LLMError(LLMError.RATE_LIMITED, "groq 429"))
        briefing = inbox_briefing.analyze_records(ai, [record()], 1, "Rehan")
        self.assertTrue(briefing["degraded"])
        self.assertEqual(briefing["ai_error"]["kind"], "rate_limited")
        self.assertIn("limit", briefing["ai_error"]["message"])

    def test_wrongly_typed_fields_do_not_break_the_briefing(self):
        odd = {
            "overview": "x",
            "emails": [{"ref": "E1", "category": "Requires Reply", "deadline": "Friday", "deadline_quote": 5}],
            "groups": [{"label": "Promos", "refs": 2}],
            "recommended_actions": [{"action": "Sign", "reason": "due", "refs": "E1"}],
        }
        briefing = inbox_briefing.analyze_records(FakeAI(result=odd), [record()], 1, "Rehan")
        self.assertIsInstance(briefing["emails"], list)
        self.assertIsNone(briefing["ai_error"])

    def test_a_good_analysis_is_not_degraded(self):
        good = {"overview": "One contract to sign.",
                "emails": [{"ref": "E1", "category": "Requires Action", "summary": "Sign it"}],
                "groups": [], "recommended_actions": []}
        briefing = inbox_briefing.analyze_records(FakeAI(result=good), [record()], 1, "Rehan")
        self.assertFalse(briefing["degraded"])
        self.assertEqual(briefing["emails"][0]["category"], "Requires Action")


if __name__ == "__main__":
    unittest.main()
