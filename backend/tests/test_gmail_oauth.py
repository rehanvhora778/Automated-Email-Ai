"""The Gmail-link OAuth round trip, exercised end to end against a fake database.

These are the cases that used to go wrong, written down so they cannot go wrong
again quietly: a forged callback, a replayed one, a consent finished by the
wrong account, an expired attempt, and a user who simply pressed Cancel.

Run from the backend directory:
    .venv/Scripts/python.exe -m unittest discover -s tests -v
"""
import datetime
import json
import sys
import unittest
from pathlib import Path
from unittest import mock

# The app is imported as `app.*`, which means the backend directory has to be
# on the path however the tests are launched.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from app.api.deps import current_user_id  # noqa: E402
from app.api.v1 import actions  # noqa: E402
from app.main import app  # noqa: E402
from tests.fake_supabase import FakeSupabase  # noqa: E402

USER = "11111111-1111-1111-1111-111111111111"
OTHER_USER = "22222222-2222-2222-2222-222222222222"


def _in(minutes):
    return (
        datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=minutes)
    ).isoformat()


class _FakeTokenResponse:
    """What `requests.post` gives back from Google's token endpoint."""

    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class GmailOAuthFlowTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeSupabase()
        # actions.py binds `supabase` at import time, so the module attribute is
        # what has to be replaced — patching app.db.supabase would be too late.
        self.supabase_patch = mock.patch.object(actions, "supabase", self.db)
        self.supabase_patch.start()
        self.addCleanup(self.supabase_patch.stop)

        # A real client config so the authorize URL and the exchange both build.
        self.config_patch = mock.patch.object(
            actions,
            "client_config",
            {"client_id": "test-client-id", "client_secret": "test-client-secret"},
        )
        self.config_patch.start()
        self.addCleanup(self.config_patch.stop)

        # Nothing in these tests should reach Google to read a mailbox address.
        self.service_patch = mock.patch.object(actions, "build_user_gmail_service", lambda *a, **k: None)
        self.service_patch.start()
        self.addCleanup(self.service_patch.stop)

        app.dependency_overrides[current_user_id] = lambda: USER
        self.addCleanup(app.dependency_overrides.clear)

        self.client = TestClient(app)

    # --- helpers ---------------------------------------------------------

    def _begin_link(self):
        res = self.client.get("/api/v1/actions/login-google")
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def _exchange_returns(self, payload, status_code=200):
        return mock.patch.object(
            actions.requests,
            "post",
            return_value=_FakeTokenResponse(payload, status_code),
        )

    # --- starting a link -------------------------------------------------

    def test_login_google_requires_a_session(self):
        app.dependency_overrides.clear()
        res = self.client.get("/api/v1/actions/login-google")
        self.assertEqual(res.status_code, 401)

    def test_state_is_random_and_not_the_user_id(self):
        body = self._begin_link()
        state = body["state"]

        self.assertNotEqual(state, USER)
        self.assertNotIn(USER, body["url"])
        # 32 bytes of urandom, base64url-encoded.
        self.assertGreaterEqual(len(state), 40)
        self.assertIn(f"state={state}", body["url"].replace("%3D", "="))

        rows = self.db.rows("oauth_states")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["user_id"], USER)
        self.assertIsNone(rows[0].get("token_data"))

    def test_each_attempt_gets_its_own_state(self):
        self.assertNotEqual(self._begin_link()["state"], self._begin_link()["state"])

    def test_authorize_url_asks_for_offline_access_and_every_gmail_scope(self):
        url = self._begin_link()["url"]
        self.assertIn("access_type=offline", url)
        self.assertIn("prompt=consent", url)
        for scope in actions.SCOPES:
            self.assertIn(scope.replace(":", "%3A").replace("/", "%2F"), url)

    # --- the callback ----------------------------------------------------

    def test_cancelling_at_google_returns_to_the_app_not_a_422(self):
        res = self.client.get(
            "/api/v1/actions/callback",
            params={"error": "access_denied", "state": "whatever"},
            follow_redirects=False,
        )
        self.assertEqual(res.status_code, 307)
        location = res.headers["location"]
        self.assertIn(actions.FRONTEND_URL, location)
        self.assertIn("gmail=error", location)
        self.assertIn("cancelled", location.lower())

    def test_forged_callback_with_an_unknown_state_links_nothing(self):
        with self._exchange_returns({"access_token": "stolen"}) as post:
            res = self.client.get(
                "/api/v1/actions/callback",
                params={"code": "attacker-code", "state": USER},
                follow_redirects=False,
            )
        self.assertEqual(res.status_code, 307)
        self.assertIn("gmail=error", res.headers["location"])
        # The code is never redeemed and no profile is touched.
        post.assert_not_called()
        self.assertEqual(self.db.rows("profiles"), [])

    def test_expired_attempt_is_refused(self):
        state = self._begin_link()["state"]
        self.db.rows("oauth_states")[0]["expires_at"] = _in(-1)

        with self._exchange_returns({"access_token": "a"}) as post:
            res = self.client.get(
                "/api/v1/actions/callback",
                params={"code": "c", "state": state},
                follow_redirects=False,
            )
        self.assertIn("gmail=error", res.headers["location"])
        post.assert_not_called()

    def test_callback_parks_the_token_without_linking_it(self):
        state = self._begin_link()["state"]

        with self._exchange_returns(
            {
                "access_token": "at-1",
                "refresh_token": "rt-1",
                "expires_in": 3599,
                "scope": " ".join(actions.SCOPES),
            }
        ):
            res = self.client.get(
                "/api/v1/actions/callback",
                params={"code": "good-code", "state": state},
                follow_redirects=False,
            )

        location = res.headers["location"]
        self.assertIn("gmail=pending", location)
        self.assertIn(f"state={state}", location.replace("%3D", "="))

        parked = self.db.rows("oauth_states")[0]["token_data"]
        self.assertEqual(parked["access_token"], "at-1")
        self.assertIn("expires_at", parked)
        # Crucially: still attached to nobody.
        self.assertEqual(self.db.rows("profiles"), [])

    def test_replayed_callback_does_not_redeem_the_code_twice(self):
        state = self._begin_link()["state"]
        payload = {"access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3599}

        with self._exchange_returns(payload) as post:
            self.client.get(
                "/api/v1/actions/callback",
                params={"code": "c", "state": state},
                follow_redirects=False,
            )
            second = self.client.get(
                "/api/v1/actions/callback",
                params={"code": "c", "state": state},
                follow_redirects=False,
            )

        # Google accepts an authorization code once; a reload must not turn
        # that into a visible failure, and must not ask again.
        self.assertEqual(post.call_count, 1)
        self.assertIn("gmail=pending", second.headers["location"])

    def test_google_error_during_exchange_is_reported(self):
        state = self._begin_link()["state"]
        with self._exchange_returns(
            {"error": "redirect_uri_mismatch", "error_description": "Bad redirect URI"}
        ):
            res = self.client.get(
                "/api/v1/actions/callback",
                params={"code": "c", "state": state},
                follow_redirects=False,
            )
        self.assertIn("gmail=error", res.headers["location"])
        self.assertIn("Bad+redirect+URI", res.headers["location"])
        self.assertEqual(self.db.rows("profiles"), [])

    # --- completing the link ---------------------------------------------

    def _park_token(self, token=None):
        state = self._begin_link()["state"]
        with self._exchange_returns(
            token
            or {
                "access_token": "at-1",
                "refresh_token": "rt-1",
                "expires_in": 3599,
                "scope": " ".join(actions.SCOPES),
            }
        ):
            self.client.get(
                "/api/v1/actions/callback",
                params={"code": "c", "state": state},
                follow_redirects=False,
            )
        return state

    def test_complete_link_attaches_the_token_and_consumes_the_state(self):
        state = self._park_token()

        res = self.client.post("/api/v1/actions/complete-link", json={"state": state})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["linked"])

        profile = self.db.rows("profiles")[0]
        self.assertEqual(profile["id"], USER)
        self.assertEqual(profile["gmail_token"]["refresh_token"], "rt-1")
        # Single use: the attempt is gone.
        self.assertEqual(self.db.rows("oauth_states"), [])

    def test_the_same_state_cannot_be_redeemed_twice(self):
        state = self._park_token()
        self.client.post("/api/v1/actions/complete-link", json={"state": state})

        again = self.client.post("/api/v1/actions/complete-link", json={"state": state})
        self.assertEqual(again.status_code, 400)

    def test_a_different_account_cannot_claim_the_consent(self):
        """The phishing case: a link minted for one account, completed by another."""
        state = self._park_token()

        app.dependency_overrides[current_user_id] = lambda: OTHER_USER
        res = self.client.post("/api/v1/actions/complete-link", json={"state": state})

        self.assertEqual(res.status_code, 403)
        # Nothing was written to either account...
        self.assertEqual(self.db.rows("profiles"), [])
        # ...and the attempt is burned rather than left for a retry.
        self.assertEqual(self.db.rows("oauth_states"), [])

    def test_a_missing_refresh_token_is_carried_forward_not_lost(self):
        self.db.seed("profiles", {"id": USER, "gmail_token": {"refresh_token": "rt-old"}})
        # Google omits refresh_token when it has already issued one for a client.
        state = self._park_token({"access_token": "at-2", "expires_in": 3599, "scope": "gmail.send"})

        res = self.client.post("/api/v1/actions/complete-link", json={"state": state})
        self.assertEqual(res.status_code, 200, res.text)

        stored = self.db.rows("profiles")[0]["gmail_token"]
        self.assertEqual(stored["refresh_token"], "rt-old")
        self.assertEqual(stored["access_token"], "at-2")

    def test_complete_link_requires_a_session(self):
        state = self._park_token()
        app.dependency_overrides.clear()
        res = self.client.post("/api/v1/actions/complete-link", json={"state": state})
        self.assertEqual(res.status_code, 401)

    # --- unlinking --------------------------------------------------------

    def test_unlink_revokes_at_google_and_clears_the_row(self):
        self.db.seed(
            "profiles",
            {"id": USER, "gmail_token": {"refresh_token": "rt-1", "access_token": "at-1"}},
        )
        with mock.patch.object(
            actions.requests, "post", return_value=_FakeTokenResponse({}, 200)
        ) as post:
            res = self.client.post("/api/v1/actions/unlink-google")

        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json(), {"unlinked": True, "revoked": True})
        post.assert_called_once()
        self.assertEqual(post.call_args.kwargs["data"], {"token": "rt-1"})
        self.assertIsNone(self.db.rows("profiles")[0]["gmail_token"])

    def test_unlink_still_clears_locally_when_google_is_unreachable(self):
        self.db.seed("profiles", {"id": USER, "gmail_token": {"refresh_token": "rt-1"}})
        with mock.patch.object(
            actions.requests, "post", side_effect=actions.requests.exceptions.ConnectionError()
        ):
            res = self.client.post("/api/v1/actions/unlink-google")

        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()["revoked"])
        self.assertIsNone(self.db.rows("profiles")[0]["gmail_token"])


class SendEmailTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeSupabase()
        mock.patch.object(actions, "supabase", self.db).start()
        self.addCleanup(mock.patch.stopall)
        app.dependency_overrides[current_user_id] = lambda: USER
        self.addCleanup(app.dependency_overrides.clear)
        self.client = TestClient(app)

    def test_sending_requires_a_session(self):
        app.dependency_overrides.clear()
        res = self.client.post(
            "/api/v1/actions/send-email",
            data={"to_email": "someone@example.com", "subject": "hi", "body": "hello"},
        )
        self.assertEqual(res.status_code, 401)

    def test_an_unlinked_account_is_told_so_rather_than_500ing(self):
        res = self.client.post(
            "/api/v1/actions/send-email",
            data={"to_email": "someone@example.com", "subject": "hi", "body": "hello"},
        )
        self.assertEqual(res.status_code, 401)
        self.assertIn("not linked", res.json()["detail"].lower())

    def test_header_injection_in_the_recipient_is_stripped(self):
        """A newline would end the To: header and let the rest be dictated."""
        self.assertEqual(
            actions._clean_header("victim@example.com\r\nBcc: attacker@evil.test"),
            "victim@example.comBcc: attacker@evil.test",
        )
        self.assertNotIn("\n", actions._clean_header("a\nb"))


class EndpointAuthContractTest(unittest.TestCase):
    """No route may take the account id from the caller, ever again.

    This is the regression guard for the whole class of bug the audit found:
    a user id is not a secret, so any endpoint that accepts one as input is an
    endpoint that serves a stranger's mailbox to whoever asks.
    """

    #: The callback is a browser redirect arriving from Google and cannot carry
    #: a bearer header, which is exactly why its `state` is an unguessable,
    #: single-use value bound server-side to a user. Health and OTP routes run
    #: before anyone has a session.
    PUBLIC = {
        "/",
        "/api/v1/actions/callback",
        "/api/v1/otp/request",
        "/api/v1/otp/verify-signup",
        "/api/v1/otp/verify-recovery",
        "/api/v1/otp/health",
        "/api/v1/ai/classify/health",
    }

    def setUp(self):
        self.schema = app.openapi()
        self.client = TestClient(app)

    def test_no_endpoint_accepts_a_client_supplied_user_id(self):
        offenders = []
        for path, operations in self.schema["paths"].items():
            for method, op in operations.items():
                for param in op.get("parameters", []):
                    if param.get("name") == "user_id":
                        offenders.append(f"{method.upper()} {path} (query/path param)")
                body = (
                    op.get("requestBody", {})
                    .get("content", {})
                    .get("application/json", {})
                    .get("schema", {})
                )
                ref = body.get("$ref", "")
                if ref.startswith("#/components/schemas/"):
                    name = ref.rsplit("/", 1)[-1]
                    body = self.schema["components"]["schemas"].get(name, {})
                if "user_id" in (body.get("properties") or {}):
                    offenders.append(f"{method.upper()} {path} (request body)")

        self.assertEqual(
            offenders,
            [],
            "these routes still trust a caller-supplied user id:\n" + "\n".join(offenders),
        )

    def test_every_private_endpoint_rejects_an_anonymous_caller(self):
        app.dependency_overrides.clear()
        unprotected = []
        for path, operations in self.schema["paths"].items():
            if path in self.PUBLIC or "{" in path:
                continue
            for method in operations:
                if method not in ("get", "post"):
                    continue
                call = self.client.get if method == "get" else self.client.post
                kwargs = {"json": {}} if method == "post" else {}
                res = call(path, follow_redirects=False, **kwargs)
                # 401 is the point. 422 would mean validation ran first and the
                # route would have served the request had the body been right.
                if res.status_code != 401:
                    unprotected.append(f"{method.upper()} {path} -> {res.status_code}")

        self.assertEqual(
            unprotected,
            [],
            "these routes answered an anonymous caller:\n" + "\n".join(unprotected),
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
