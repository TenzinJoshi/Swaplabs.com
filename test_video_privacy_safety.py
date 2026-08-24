"""End-to-end checks for live rooms, privacy controls, and student safeguards."""


from __future__ import annotations

import json
import tempfile
import unittest
from datetime import date
from pathlib import Path

import swaplabs_server as server


class VideoPrivacySafetyTest(unittest.TestCase):
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

    def login(self, username: str, password: str):
        client = server.app.test_client()
        csrf = client.get("/api/auth/csrf").get_json()["csrf_token"]
        response = client.post(
            "/api/auth/login",
            json={"mode": "member", "login": username, "password": password},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return client, response.get_json()["csrf_token"]

    def admin_login(self):
        client = server.app.test_client()
        csrf = client.get("/api/auth/csrf").get_json()["csrf_token"]
        response = client.post(
            "/api/auth/login",
            json={
                "mode": "admin",
                "admin_id": "SWAPLABS-ADMIN-2026",
                "password": "SwapLabsAdmin#2026",
            },
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return client, response.get_json()["csrf_token"]

    def registration_payload(self, username: str, email: str, years_old: int):
        today = date.today()
        try:
            birthday = today.replace(year=today.year - years_old)
        except ValueError:
            birthday = today.replace(year=today.year - years_old, day=28)

        payload = {
            "username": username,
            "email": email,
            "password": "StudentSafe#2026",
            "accepted_terms": True,
            "profile": {
                "first_name": "Alex",
                "last_name": "River",
                "display_name": "Alex River",
                "date_of_birth": birthday.isoformat(),
                "country": "India",
                "city": "New Delhi",
                "timezone": "Asia/Kolkata",
                "primary_language": "English",
                "occupation": "Student" if years_old < 18 else "Designer",
                "professional_role": "Student innovator" if years_old < 18 else "Designer",
                "headline": "Learning through practical projects",
                "bio": "I enjoy building useful ideas with other learners.",
                "availability": "Weekend afternoons",
                "preferred_format": "Online",
                "teaching_style": "Project-based",
                "experience_level": "Beginner",
                "learning_goal": "Build one useful community project.",
                "profile_color": "purple",
                "additional_languages": ["Hindi"],
                "skills_to_teach": ["Idea research"],
                "skills_to_learn": ["Prototyping"],
                "interests": ["Social innovation"],
            },
            "preferences": {
                "profile_visibility": "public",
                "show_location": True,
            },
        }
        if years_old < 18:
            payload["safety"] = {
                "guardian_name": "Morgan River",
                "guardian_email": "guardian@example.com",
                "guardian_relationship": "parent",
                "guardian_consent_declared": True,
            }
        return payload

    def register(self, username: str, email: str, years_old: int):
        client = server.app.test_client()
        csrf = client.get("/api/auth/csrf").get_json()["csrf_token"]
        response = client.post(
            "/api/auth/register",
            json=self.registration_payload(username, email, years_old),
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        return client, response.get_json()["csrf_token"], response.get_json()["user"]

    def test_live_room_waiting_attendance_signalling_and_history(self):
        maya, maya_csrf = self.login("maya.chen", "MayaSkill#2026")
        liam, liam_csrf = self.login("liam.carter", "LiamSkill#2026")

        event_response = maya.post(
            "/api/calendar/events",
            json={
                "title": "Live room integration check",
                "description": "A real member-to-member video session.",
                "starts_at": "2026-10-10T16:00",
                "ends_at": "2026-10-10T17:00",
                "timezone": "Asia/Kolkata",
                "participant_ids": ["usr_member_002"],
                "location": "SwapLabs Live Room",
                "meeting_url": "",
                "reminders_minutes": [60],
            },
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(event_response.status_code, 201, event_response.get_json())
        event_id = event_response.get_json()["event"]["id"]

        created = maya.post(
            "/api/video/rooms",
            json={"event_id": event_id, "waiting_room_enabled": True},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        room_id = created.get_json()["room"]["id"]

        host_join = maya.post(
            f"/api/video/rooms/{room_id}/join",
            json={
                "connection_check": {
                    "quality": "good",
                    "camera_ready": True,
                    "microphone_ready": True,
                    "downlink_mbps": 24.5,
                }
            },
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(host_join.status_code, 200, host_join.get_json())
        self.assertEqual(host_join.get_json()["room"]["viewer_attendance"]["state"], "admitted")

        member_join = liam.post(
            f"/api/video/rooms/{room_id}/join",
            json={"connection_check": {"quality": "fair", "camera_ready": True, "microphone_ready": True}},
            headers={"X-CSRF-Token": liam_csrf},
        )
        self.assertEqual(member_join.status_code, 200, member_join.get_json())
        self.assertEqual(member_join.get_json()["room"]["viewer_attendance"]["state"], "waiting")

        admitted = maya.patch(
            f"/api/video/rooms/{room_id}/participants/usr_member_002",
            json={"action": "admit"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(admitted.status_code, 200, admitted.get_json())
        member_room = liam.get(f"/api/video/rooms/{room_id}").get_json()["room"]
        host_record = next(item for item in member_room["attendance"] if item["user_id"] == "usr_member_001")
        own_record = next(item for item in member_room["attendance"] if item["user_id"] == "usr_member_002")
        self.assertEqual(host_record["connection_checks"], [])
        self.assertTrue(own_record["connection_checks"])

        for client, csrf in ((maya, maya_csrf), (liam, liam_csrf)):
            joined = client.post(
                f"/api/video/rooms/{room_id}/attendance",
                json={"action": "joined"},
                headers={"X-CSRF-Token": csrf},
            )
            self.assertEqual(joined.status_code, 200, joined.get_json())
            self.assertEqual(joined.get_json()["attendance"]["state"], "in_call")

        signal = maya.post(
            f"/api/video/rooms/{room_id}/signals",
            json={
                "target_id": "usr_member_002",
                "type": "offer",
                "payload": {"type": "offer", "sdp": "test-session-description"},
            },
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(signal.status_code, 201, signal.get_json())
        received = liam.get(f"/api/video/rooms/{room_id}/signals")
        self.assertEqual(received.status_code, 200, received.get_json())
        self.assertTrue(any(item["type"] == "offer" for item in received.get_json()["signals"]))

        quality = liam.post(
            f"/api/video/rooms/{room_id}/attendance",
            json={
                "action": "quality",
                "connection_check": {"quality": "good", "rtt_ms": 42, "packet_loss_pct": 0.2},
            },
            headers={"X-CSRF-Token": liam_csrf},
        )
        self.assertEqual(quality.status_code, 200, quality.get_json())
        self.assertEqual(quality.get_json()["attendance"]["connection_checks"][-1]["quality"], "good")

        self.assertEqual(
            liam.post(
                f"/api/video/rooms/{room_id}/attendance",
                json={"action": "confirm"},
                headers={"X-CSRF-Token": liam_csrf},
            ).status_code,
            200,
        )
        confirmed = maya.post(
            f"/api/video/rooms/{room_id}/attendance",
            json={"action": "confirm", "target_id": "usr_member_002"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.get_json())
        self.assertTrue(confirmed.get_json()["attendance"]["confirmation_complete"])

        history = liam.get("/api/account/session-history.csv")
        self.assertEqual(history.status_code, 200)
        history_text = history.get_data(as_text=True)
        self.assertIn("Live room integration check", history_text)
        self.assertIn(room_id, history_text)

    def test_swapbot_never_mirrors_member_message_contents(self):
        maya, maya_csrf = self.login("maya.chen", "MayaSkill#2026")
        liam, _ = self.login("liam.carter", "LiamSkill#2026")
        created = maya.post(
            "/api/inbox/conversations",
            json={"target_user_id": "usr_member_002"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        conversation_id = created.get_json()["conversation"]["id"]
        private_text = "PRIVATE-MEMBER-TEXT-DO-NOT-MIRROR"
        sent = maya.post(
            f"/api/inbox/conversations/{conversation_id}/messages",
            json={"body": private_text},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(sent.status_code, 201, sent.get_json())

        notifications = liam.get("/api/notifications").get_json()["notifications"]
        message_notice = next(item for item in notifications if item["type"] == "new_message")
        self.assertNotIn(private_text, message_notice["message"])
        self.assertIn("sent you a new message", message_notice["message"])

        store = server.read_store()
        bot_id = next(
            item["id"] for item in store["conversations"]
            if item.get("kind") == "bot" and item.get("participant_ids") == ["usr_member_002"]
        )
        bot_messages = [item for item in store["messages"] if item.get("conversation_id") == bot_id]
        self.assertFalse(any(private_text in item.get("body", "") for item in bot_messages))
        self.assertFalse(any(item.get("metadata", {}).get("type") == "new_message" for item in bot_messages))

    def test_student_defaults_guardian_review_and_specialist_moderation(self):
        student, student_csrf, student_user = self.register(
            "alex.student", "alex.student@example.com", 16,
        )
        student_id = student_user["id"]
        self.assertTrue(student_user["safety"]["is_minor"])
        self.assertEqual(student_user["safety"]["guardian_consent_status"], "pending")
        self.assertEqual(student_user["preferences"]["profile_visibility"], "private")
        self.assertFalse(student_user["preferences"]["show_location"])

        public_profile = server.app.test_client().get(f"/api/community/users/{student_id}").get_json()["user"]
        self.assertEqual(public_profile["visibility"], "private")
        self.assertFalse(public_profile["can_view_full"])
        self.assertNotIn("age", public_profile["profile"])
        self.assertNotIn("country", public_profile["profile"])

        maya, maya_csrf = self.login("maya.chen", "MayaSkill#2026")
        blocked_chat = maya.post(
            "/api/inbox/conversations",
            json={"target_user_id": student_id},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(blocked_chat.status_code, 403, blocked_chat.get_json())
        self.assertFalse(any(
            member["id"] == student_id for member in maya.get("/api/calendar").get_json()["contacts"]
        ))
        blocked_session = maya.post(
            "/api/calendar/events",
            json={
                "title": "Unsafe unconnected student session",
                "description": "This direct session must be rejected.",
                "starts_at": "2026-10-12T16:00",
                "ends_at": "2026-10-12T17:00",
                "timezone": "Asia/Kolkata",
                "participant_ids": [student_id],
                "location": "SwapLabs Live Room",
                "reminders_minutes": [60],
            },
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(blocked_session.status_code, 400, blocked_session.get_json())

        follow = maya.post(
            f"/api/community/users/{student_id}/follow",
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(follow.status_code, 201, follow.get_json())
        self.assertEqual(follow.get_json()["relationship"], "requested")
        incoming = student.get("/api/notifications").get_json()["incoming_requests"]
        request_id = next(item["id"] for item in incoming if item["requester_id"] == "usr_member_001")
        accepted = student.post(
            f"/api/notifications/follow-requests/{request_id}/accept",
            headers={"X-CSRF-Token": student_csrf},
        )
        self.assertEqual(accepted.status_code, 200, accepted.get_json())
        connected_chat = maya.post(
            "/api/inbox/conversations",
            json={"target_user_id": student_id},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(connected_chat.status_code, 201, connected_chat.get_json())
        self.assertTrue(any(
            member["id"] == student_id for member in maya.get("/api/calendar").get_json()["contacts"]
        ))

        idea_payload = {
            "title": "Low-cost classroom air monitor",
            "tagline": "Help students understand the air around them.",
            "category": "Education and access",
            "problem": "Many classrooms cannot see or explain changes in indoor air quality.",
            "solution": "A low-cost sensor kit and student-friendly dashboard for guided experiments.",
            "beneficiaries": "Students, teachers, and school communities.",
            "impact": "Students learn science while schools gain practical environmental observations.",
            "stage": "Prototype",
            "funding_currency": "INR",
            "funding_needed": 50000,
            "funds_use": "Sensors, enclosure materials, testing, and classroom documentation.",
            "skills_needed": ["Electronics", "Data visualization", "Science education"],
            "collaboration": "Looking for a hardware mentor and two pilot classrooms.",
            "reach": "Three schools in the first pilot.",
            "prototype_url": "",
            "pitch": "Make invisible classroom conditions visible through safe student-led science.",
            "community_agreement": True,
        }
        submitted = student.post(
            "/api/ideas",
            json=idea_payload,
            headers={"X-CSRF-Token": student_csrf},
        )
        self.assertEqual(submitted.status_code, 201, submitted.get_json())
        idea_id = submitted.get_json()["idea"]["id"]
        self.assertEqual(submitted.get_json()["idea"]["status"], "specialist_review")
        self.assertEqual(submitted.get_json()["idea"]["safety_review_status"], "pending")

        anonymous_ideas = server.app.test_client().get("/api/ideas").get_json()["ideas"]
        self.assertFalse(any(item["id"] == idea_id for item in anonymous_ideas))
        owner_ideas = student.get("/api/ideas").get_json()["ideas"]
        self.assertTrue(any(item["id"] == idea_id for item in owner_ideas))

        admin, admin_csrf = self.admin_login()
        content = admin.get("/api/admin/content").get_json()
        self.assertGreaterEqual(content["stats"]["student_reviews"], 1)
        guardian = admin.patch(
            f"/api/admin/users/{student_id}/guardian-consent",
            json={"status": "verified", "guardian_notes": "Consent checked for the student account."},
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(guardian.status_code, 200, guardian.get_json())
        self.assertEqual(guardian.get_json()["user"]["safety"]["guardian_consent_status"], "verified")
        moderated = admin.patch(
            f"/api/admin/ideas/{idea_id}",
            json={"status": "published", "moderation_notes": "Specialist safety review complete."},
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(moderated.status_code, 200, moderated.get_json())
        self.assertEqual(moderated.get_json()["idea"]["safety_review_status"], "approved")
        self.assertIsNotNone(moderated.get_json()["idea"]["specialist_reviewer_id"])

    def test_privacy_export_controls_and_self_service_deletion(self):
        maya, maya_csrf = self.login("maya.chen", "MayaSkill#2026")
        saved = maya.patch(
            "/api/account/privacy",
            json={
                "data_retention": "minimal",
                "message_retention": "90_days",
                "session_history_retention": "365_days",
                "allow_research_analytics": True,
            },
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(saved.status_code, 200, saved.get_json())
        privacy = maya.get("/api/account/privacy").get_json()
        self.assertEqual(privacy["preferences"]["data_retention"], "minimal")
        self.assertEqual(privacy["preferences"]["message_retention"], "90_days")
        self.assertTrue(privacy["preferences"]["allow_research_analytics"])
        self.assertIn("counts", privacy)
        self.assertIn("general_cleanup_before", privacy["schedule"])

        exported = maya.get("/api/account/export")
        self.assertEqual(exported.status_code, 200)
        self.assertIn("attachment;", exported.headers.get("Content-Disposition", ""))
        export_payload = json.loads(exported.get_data(as_text=True))
        self.assertEqual(export_payload["account"]["username"], "maya.chen")
        self.assertIn("credit_ledger", export_payload)
        self.assertIn("video_attendance", export_payload)
        self.assertEqual(maya.post(
            "/api/account/privacy/cleanup",
            headers={"X-CSRF-Token": maya_csrf},
        ).status_code, 200)

        disposable, disposable_csrf, disposable_user = self.register(
            "delete.me", "delete.me@example.com", 24,
        )
        deleted = disposable.delete(
            "/api/account",
            json={"password": "StudentSafe#2026", "confirmation": "DELETE delete.me"},
            headers={"X-CSRF-Token": disposable_csrf},
        )
        self.assertEqual(deleted.status_code, 200, deleted.get_json())
        self.assertFalse(disposable.get("/api/auth/me").get_json()["authenticated"])
        self.assertIsNone(server.find_user(server.read_store(), disposable_user["id"]))


if __name__ == "__main__":
    unittest.main()
