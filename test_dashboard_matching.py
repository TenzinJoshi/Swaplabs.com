"""End-to-end API checks for live metrics, explainable matching, and the member dashboard."""


from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import swaplabs_server as server


class DashboardMatchingTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        server.DATA_DIR = root
        server.USERS_FILE = root / "users.json"
        server.UPLOAD_DIR = root / "uploads"
        server.MESSAGE_UPLOAD_DIR = root / "message_uploads"
        server.TYPING_STATES.clear()
        server.write_store(server.initial_store())
        server.read_store()

    def tearDown(self):
        self.temporary.cleanup()

    def login(self):
        client = server.app.test_client()
        token = client.get("/api/auth/csrf").get_json()["csrf_token"]
        response = client.post(
            "/api/auth/login",
            json={"mode": "member", "login": "maya.chen", "password": "MayaSkill#2026"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return client, response.get_json()["csrf_token"]

    def test_live_metrics_follow_profile_data(self):
        client, csrf = self.login()
        before_response = client.get("/api/platform/metrics").get_json()
        before = before_response["metrics"]
        me = client.get("/api/auth/me").get_json()["user"]
        skills = list(me["profile"]["skills_to_teach"]) + ["Quantum gardening"]
        updated = client.patch(
            "/api/profile",
            json={"profile": {"skills_to_teach": skills}},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(updated.status_code, 200, updated.get_json())
        after_response = client.get("/api/platform/metrics").get_json()
        after = after_response["metrics"]
        self.assertEqual(after["active_members"], before["active_members"])
        self.assertEqual(after["skills"], before["skills"] + 1)
        self.assertIn("Quantum gardening", after_response["skill_names"])
        self.assertIn("updated_at", after)

    def test_matching_is_explainable_and_has_a_strict_empty_state(self):
        client, csrf = self.login()
        response = client.post(
            "/api/matches",
            json={
                "learn_skills": ["Spanish"],
                "teach_skills": ["Product design"],
                "proficiency": "Beginner",
                "learning_goal": "Hold a practical Spanish conversation",
                "teaching_style": "Conversational",
                "session_format": "Remote or local",
                "timezone": "Asia/Singapore",
                "languages": ["English"],
                "strict_skill_match": True,
            },
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        matches = response.get_json()["matches"]
        self.assertGreaterEqual(len(matches), 1)
        match = matches[0]
        self.assertEqual(match["candidate"]["id"], "usr_member_003")
        self.assertEqual(len(match["reasons"]), 9)
        self.assertEqual(match["score"], sum(item["points"] for item in match["reasons"]))
        self.assertIn("overlap_minutes_next_8_days", match["availability"])
        self.assertTrue(match["candidate"]["skill_categories"])
        self.assertIn("reliability_score", match["candidate"]["reputation"])

        empty = client.post(
            "/api/matches",
            json={"learn_skills": ["Underwater lunar archaeology"], "strict_skill_match": True},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(empty.status_code, 200, empty.get_json())
        self.assertEqual(empty.get_json()["matches"], [])
        self.assertEqual(empty.get_json()["empty_state"]["title"], "No strong match found yet")

    def test_dashboard_uses_member_records_and_saves_onboarding(self):
        client, csrf = self.login()
        response = client.get("/api/dashboard")
        self.assertEqual(response.status_code, 200, response.get_json())
        payload = response.get_json()
        self.assertEqual(payload["user"]["id"], "usr_member_001")
        self.assertIn("credit_balance", payload["summary"])
        self.assertIn("pending_requests", payload["summary"])
        self.assertIn("unread_messages", payload["summary"])
        self.assertIn("goal_progress", payload["summary"])
        self.assertGreaterEqual(len(payload["recommended_matches"]), 1)
        self.assertIn("title", payload["suggested_action"])
        self.assertFalse(payload["onboarding_complete"])

        completed = client.post(
            "/api/dashboard/onboarding", json={"complete": True}, headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(completed.status_code, 200, completed.get_json())
        self.assertTrue(client.get("/api/dashboard").get_json()["onboarding_complete"])


if __name__ == "__main__":
    unittest.main()
