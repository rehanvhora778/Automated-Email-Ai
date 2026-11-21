"""What each AI route tells the browser when the model cannot answer.

Before the provider chain existed, a dead model surfaced in three different
wrong ways: chat stored "Mistral AI is busy" as the assistant's reply (and fed
it back to the model as memory), Smart Reply returned a card per style with
nothing in it, and the streaming tools sent HTTP 200 with a Python exception as
the body. These tests hold each route to one honest contract instead: a 503
whose detail a person can act on, and nothing written that should not be.

Run from the backend directory:
    .venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import json
import os
import sys
import unittest
import uuid
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.api.deps import current_user_id  # noqa: E402
from app.api.v1 import chat, reply, tools  # noqa: E402
from app.main import app  # noqa: E402
from app.services import ai_service, llm  # noqa: E402
from app.services.llm import LLMError  # noqa: E402
from tests.fake_supabase import FakeSupabase  # noqa: E402

USER = "11111111-1111-1111-1111-111111111111"
RATE_LIMITED = LLMError(LLMError.RATE_LIMITED, "groq/openai/gpt-oss-120b rate_limited")


class ChatDB(FakeSupabase):
    """The fake, plus the one thing Postgres does that chat relies on: ids."""

    def from_(self, table):
        query = super().from_(table)
        if table == "conversations":
            original = query.insert

            def insert(payload):
                items = payload if isinstance(payload, list) else [payload]
                for item in items:
                    item.setdefault("id", str(uuid.uuid4()))
                return original(payload)

            query.insert = insert
        return query


class SignedInTestCase(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[current_user_id] = lambda: USER
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)


class ChatRouteTest(SignedInTestCase):
    def setUp(self):
        super().setUp()
        self.db = ChatDB()
        self.db.seed("profiles", {"id": USER, "full_name": "Rehan", "signature": ""})
        patcher = mock.patch.object(chat, "supabase", self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_failed_answer_is_a_503_and_nothing_is_saved(self):
        with mock.patch.object(chat.ai_secretary, "generate_response", side_effect=RATE_LIMITED):
            res = self.client.post("/api/v1/chat/", json={"message": "Write to Priya"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["detail"], RATE_LIMITED.user_message)
        # No empty conversation in the sidebar, no apology stored as memory.
        self.assertEqual(self.db.rows("conversations"), [])
        self.assertEqual(self.db.rows("chat_messages"), [])

    def test_a_failure_inside_an_existing_thread_leaves_it_untouched(self):
        self.db.seed("conversations", {"id": "c1", "user_id": USER, "title": "Old"})
        self.db.seed("chat_messages", {"user_id": USER, "conversation_id": "c1", "role": "user",
                                       "content": "earlier", "created_at": "1"})
        with mock.patch.object(chat.ai_secretary, "generate_response", side_effect=RATE_LIMITED):
            res = self.client.post("/api/v1/chat/", json={"message": "again", "conversation_id": "c1"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(len(self.db.rows("chat_messages")), 1)

    def test_an_answer_creates_the_thread_and_saves_both_turns(self):
        draft = {"status": "ready", "content": "Hi Priya,\n\nThanks.", "metadata": {"subject": "Thanks"}}
        with mock.patch.object(chat.ai_secretary, "generate_response", return_value=dict(draft)):
            res = self.client.post("/api/v1/chat/", json={"message": "Thank Priya"})
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "ready")
        self.assertTrue(body["conversation_id"])
        roles = [m["role"] for m in self.db.rows("chat_messages")]
        self.assertEqual(roles, ["user", "assistant"])
        self.assertEqual(self.db.rows("conversations")[0]["title"], "Thank Priya")

    def test_replayed_history_skips_the_old_outage_apology(self):
        self.db.seed("conversations", {"id": "c1", "user_id": USER, "title": "Old"})
        self.db.seed(
            "chat_messages",
            {"user_id": USER, "conversation_id": "c1", "role": "user", "content": "draft it", "created_at": "1"},
            {"user_id": USER, "conversation_id": "c1", "role": "assistant",
             "content": "Mistral AI is busy. Try again.", "created_at": "2"},
        )
        seen = {}

        def fake_complete(messages, **kwargs):
            seen["messages"] = messages
            return llm.Completion(text="{}", provider="groq", model="m",
                                  data={"status": "ready", "content": "Hello", "metadata": {}})

        with mock.patch.object(ai_service.llm, "complete", side_effect=fake_complete):
            res = self.client.post("/api/v1/chat/", json={"message": "again", "conversation_id": "c1"})
        self.assertEqual(res.status_code, 200)
        contents = [m["content"] for m in seen["messages"]]
        self.assertIn("draft it", contents)
        self.assertNotIn("Mistral AI is busy. Try again.", contents)
        self.assertEqual(seen["messages"][-1], {"role": "user", "content": "again"})


class ReplyRouteTest(SignedInTestCase):
    def setUp(self):
        super().setUp()
        patcher = mock.patch.object(reply, "get_user_profile",
                                    return_value={"full_name": "Rehan", "signature": ""})
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_failed_generation_is_a_503_not_blank_cards(self):
        with mock.patch.object(reply.ai, "generate_replies", side_effect=RATE_LIMITED):
            res = self.client.post("/api/v1/reply/generate", json={"original_email": "Can we meet?"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["detail"], RATE_LIMITED.user_message)

    def test_a_model_answer_with_no_drafts_counts_as_a_failure(self):
        empty = llm.Completion(text="{}", provider="groq", model="m", data={"professional": ""})
        with mock.patch.object(ai_service.llm, "complete", return_value=empty):
            res = self.client.post("/api/v1/reply/generate",
                                   json={"original_email": "Can we meet?", "styles": ["professional"]})
        self.assertEqual(res.status_code, 503)

    def test_drafts_come_back_keyed_by_style(self):
        answer = llm.Completion(text="{}", provider="groq", model="m",
                                data={"professional": "Yes, Tuesday works.", "short": "Sure."})
        with mock.patch.object(ai_service.llm, "complete", return_value=answer):
            res = self.client.post("/api/v1/reply/generate",
                                   json={"original_email": "Can we meet?", "styles": ["professional", "short"]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["replies"], {"professional": "Yes, Tuesday works.", "short": "Sure."})


class ToolRoutesTest(SignedInTestCase):
    def test_a_failed_tool_is_a_503(self):
        with mock.patch.object(tools.ai, "run_tool", side_effect=RATE_LIMITED):
            res = self.client.post("/api/v1/ai/tool", json={"action": "improve", "input": "hello"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["detail"], RATE_LIMITED.user_message)

    def test_empty_input_is_refused_before_any_model_call(self):
        with mock.patch.object(tools.ai, "run_tool") as run:
            res = self.client.post("/api/v1/ai/tool", json={"action": "improve", "input": "   "})
        self.assertEqual(res.status_code, 400)
        run.assert_not_called()

    def test_a_stream_that_cannot_start_is_a_503_not_a_200(self):
        with mock.patch.object(ai_service.llm, "open_stream", side_effect=RATE_LIMITED):
            res = self.client.post("/api/v1/ai/tool/stream", json={"action": "translate", "input": "hola"})
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()["detail"], RATE_LIMITED.user_message)

    def test_a_working_stream_relays_the_text(self):
        with mock.patch.object(ai_service.llm, "open_stream", return_value=iter(["Hel", "lo"])):
            res = self.client.post("/api/v1/ai/tool/stream", json={"action": "translate", "input": "hola"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.text, "Hello")

    def test_a_stream_that_breaks_mid_answer_ends_with_the_marker(self):
        def broken():
            yield "partial"
            raise LLMError(LLMError.UNAVAILABLE, "reset")

        with mock.patch.object(ai_service.llm, "open_stream", return_value=broken()):
            res = self.client.post("/api/v1/ai/tool/stream", json={"action": "translate", "input": "hola"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.text.startswith("partial" + tools.STREAM_ERROR_MARKER))
        self.assertNotIn("reset", res.text)  # internals stay in the server log

    def test_status_is_public_and_never_shows_a_key(self):
        app.dependency_overrides.clear()
        with mock.patch.dict(os.environ, {"GROQ_API_KEY": "gsk_should_never_appear"}):
            res = TestClient(app).get("/api/v1/ai/status")
        self.assertEqual(res.status_code, 200)
        self.assertNotIn("gsk_should_never_appear", res.text)
        self.assertIn("groq", json.dumps(res.json()["order"]))


class NormaliseDraftTest(unittest.TestCase):
    def test_nested_json_from_a_small_model_is_unwrapped(self):
        out = ai_service._normalise_draft({"status": "ready", "content": '{"message": "Thanks, Priya!"}'})
        self.assertEqual(out["content"], "Thanks, Priya!")

    def test_unknown_status_becomes_ready_and_subject_is_always_a_string(self):
        out = ai_service._normalise_draft({"status": "done", "content": "Hi", "metadata": None})
        self.assertEqual(out["status"], "ready")
        self.assertEqual(out["metadata"], {"subject": ""})

    def test_missing_info_survives(self):
        out = ai_service._normalise_draft({"status": "missing_info", "content": "Who is it for?"})
        self.assertEqual(out["status"], "missing_info")

    def test_an_empty_draft_is_a_failure(self):
        with self.assertRaises(LLMError):
            ai_service._normalise_draft({"status": "ready", "content": "  "})

    def test_a_subject_and_body_object_yields_the_body_not_its_json(self):
        out = ai_service._normalise_draft({
            "status": "ready",
            "content": {"subject": "Quotation", "body": "Hi Aman,\n\nAttached.\n\nBest,\nRehan"},
        })
        self.assertEqual(out["content"], "Hi Aman,\n\nAttached.\n\nBest,\nRehan")
        self.assertEqual(out["metadata"]["subject"], "Quotation")

    def test_a_leading_subject_line_moves_into_the_subject(self):
        out = ai_service._normalise_draft({
            "status": "ready", "content": "Subject: Leave request\n\nHi Priya,\n\nI need Friday off.",
        })
        self.assertEqual(out["metadata"]["subject"], "Leave request")
        self.assertTrue(out["content"].startswith("Hi Priya,"))

    def test_the_models_own_subject_wins_over_a_body_line(self):
        out = ai_service._normalise_draft({
            "status": "ready", "content": "Subject: other\nHi,\n\nText.", "metadata": {"subject": "Mine"},
        })
        self.assertEqual(out["metadata"]["subject"], "Mine")
        self.assertTrue(out["content"].startswith("Hi,"))


if __name__ == "__main__":
    unittest.main()
