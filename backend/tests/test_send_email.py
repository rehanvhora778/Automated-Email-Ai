"""Sending mail: the checks that run before Gmail is ever asked.

Each of these used to reach Gmail and come back as a misleading message: a
typo in the address became "Gmail could not complete that request", and a
link made without the send permission became "Gmail isn't linked any more" —
which sent people round a re-link loop that could not fix it.

Run from the backend directory:
    .venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import base64
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.api.deps import current_user_id  # noqa: E402
from app.api.v1 import actions  # noqa: E402
from app.main import app  # noqa: E402
from tests.fake_supabase import FakeSupabase  # noqa: E402

USER = "11111111-1111-1111-1111-111111111111"
SEND = "https://www.googleapis.com/auth/gmail.send"
READ = "https://www.googleapis.com/auth/gmail.readonly"


class _FakeGmail:
    """Just enough of the Gmail client to record what would have been sent."""

    def __init__(self):
        self.sent = []

    def users(self):
        return self

    def messages(self):
        return self

    def send(self, userId, body):
        self.sent.append(body)
        return self

    def execute(self):
        return {"id": "msg-1"}


class SendChecksTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeSupabase()
        mock.patch.object(actions, "supabase", self.db).start()
        self.gmail = _FakeGmail()
        mock.patch.object(actions, "build_user_gmail_service", lambda *a, **k: self.gmail).start()
        self.addCleanup(mock.patch.stopall)
        app.dependency_overrides[current_user_id] = lambda: USER
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def link(self, scope):
        self.db.seed("profiles", {"id": USER, "gmail_token": {
            "token": "t", "refresh_token": "r", "scope": scope,
        }})

    def send(self, to, body="Hello"):
        return self.client.post("/api/v1/actions/send-email",
                                data={"to_email": to, "subject": "Hi", "body": body})

    def test_a_mistyped_address_is_named_before_gmail_is_called(self):
        self.link(f"{SEND} {READ}")
        res = self.send("priya@gmail")
        self.assertEqual(res.status_code, 400)
        self.assertIn("priya@gmail", res.json()["detail"])
        self.assertEqual(self.gmail.sent, [])

    def test_one_bad_address_in_a_list_is_caught(self):
        self.link(SEND)
        res = self.send("a@example.com, not-an-address")
        self.assertEqual(res.status_code, 400)
        self.assertIn("not-an-address", res.json()["detail"])

    def test_a_link_without_send_permission_says_so(self):
        self.link(READ)
        res = self.send("priya@example.com")
        self.assertEqual(res.status_code, 403)
        self.assertIn("permission to send", res.json()["detail"])
        self.assertEqual(self.gmail.sent, [])

    def test_a_proper_link_sends_with_a_display_name_and_several_recipients(self):
        self.link(f"{SEND} {READ}")
        res = self.send('Priya Nair <priya@example.com>; aman@example.com')
        self.assertEqual(res.status_code, 200, res.text)
        raw = base64.urlsafe_b64decode(self.gmail.sent[0]["raw"]).decode()
        self.assertIn("priya@example.com", raw)

    def test_modify_scope_alone_is_enough_to_send(self):
        self.link("https://www.googleapis.com/auth/gmail.modify")
        self.assertEqual(self.send("priya@example.com").status_code, 200)

    def test_an_old_grant_without_a_recorded_scope_still_sends(self):
        self.db.seed("profiles", {"id": USER, "gmail_token": {"token": "t", "refresh_token": "r"}})
        self.assertEqual(self.send("priya@example.com").status_code, 200)


class InvalidRecipientsTest(unittest.TestCase):
    def test_plain_and_named_addresses_pass(self):
        self.assertEqual(actions._invalid_recipients("a@b.co"), [])
        self.assertEqual(actions._invalid_recipients('"Doe, John" <j@x.org>, k@y.in'), [])

    def test_garbage_is_reported(self):
        self.assertEqual(actions._invalid_recipients("john"), ["john"])
        self.assertEqual(actions._invalid_recipients(""), [""])


if __name__ == "__main__":
    unittest.main()
