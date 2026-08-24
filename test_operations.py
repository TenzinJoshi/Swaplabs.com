"""End-to-end API checks for SwapLabs messaging, calendar, and credit operations."""


from __future__ import annotations

import io
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import swaplabs_server as server


class OperationsFlowTest(unittest.TestCase):
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
        token = client.get("/api/auth/csrf").get_json()["csrf_token"]
        response = client.post(
            "/api/auth/login",
            json={"mode": "member", "login": username, "password": password},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return client, response.get_json()["csrf_token"]

    def admin_login(self):
        client = server.app.test_client()
        token = client.get("/api/auth/csrf").get_json()["csrf_token"]
        response = client.post(
            "/api/auth/login",
            json={"mode": "admin", "admin_id": "SWAPLABS-ADMIN-2026", "password": "SwapLabsAdmin#2026"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(response.status_code, 200, response.get_json())
        return client, response.get_json()["csrf_token"]

    def test_complete_operations_flow(self):
        maya, maya_csrf = self.login("maya.chen", "MayaSkill#2026")
        liam, liam_csrf = self.login("liam.carter", "LiamSkill#2026")
        arjun, _ = self.login("arjun.patel", "ArjunSkill#2026")
        sofia, _ = self.login("sofia.martin", "SofiaSkill#2026")

        inbox = maya.get("/api/inbox").get_json()
        self.assertTrue(any(item["kind"] == "bot" for item in inbox["conversations"]))
        bot_id = next(item["id"] for item in inbox["conversations"] if item["kind"] == "bot")
        bot_reply = maya.post(
            f"/api/inbox/conversations/{bot_id}/messages",
            json={"body": "How do I dispute a credt payment?"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(bot_reply.status_code, 201, bot_reply.get_json())
        self.assertIn("Credit Ledger", bot_reply.get_json()["replies"][0]["body"])

        created = maya.post(
            "/api/inbox/conversations",
            json={"target_user_id": "usr_member_002"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(created.status_code, 201, created.get_json())
        conversation_id = created.get_json()["conversation"]["id"]
        message = maya.post(
            f"/api/inbox/conversations/{conversation_id}/messages",
            json={"body": "Would you exchange a Python lesson for a design critique?"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(message.status_code, 201, message.get_json())
        message_id = message.get_json()["message"]["id"]

        liam_inbox = liam.get("/api/inbox").get_json()
        self.assertGreater(liam_inbox["unread_count"], 0)
        typing = maya.post(
            f"/api/inbox/conversations/{conversation_id}/typing",
            json={"typing": True}, headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(typing.status_code, 200)
        liam_conversation = liam.get(f"/api/inbox/conversations/{conversation_id}").get_json()
        self.assertEqual(liam_conversation["typing_users"][0]["id"], "usr_member_001")
        read = liam.post(
            f"/api/inbox/conversations/{conversation_id}/read",
            headers={"X-CSRF-Token": liam_csrf},
        )
        self.assertGreaterEqual(read.get_json()["updated"], 1)

        attached = maya.post(
            f"/api/inbox/conversations/{conversation_id}/messages",
            data={"body": "Here is the session brief.", "attachment": (io.BytesIO(b"%PDF-1.4\nSwapLabs test\n%%EOF"), "brief.pdf")},
            content_type="multipart/form-data", headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(attached.status_code, 201, attached.get_json())
        attachment_url = attached.get_json()["message"]["attachment"]["url"]
        attachment_response = liam.get(attachment_url)
        self.assertEqual(attachment_response.status_code, 200)
        attachment_response.close()
        self.assertEqual(sofia.get(attachment_url).status_code, 404)

        blocked = liam.post(
            "/api/inbox/users/usr_member_001/block", headers={"X-CSRF-Token": liam_csrf},
        )
        self.assertEqual(blocked.status_code, 200)
        prevented = maya.post(
            f"/api/inbox/conversations/{conversation_id}/messages",
            json={"body": "This must not be delivered."}, headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(prevented.status_code, 403)
        self.assertEqual(
            liam.delete("/api/inbox/users/usr_member_001/block", headers={"X-CSRF-Token": liam_csrf}).status_code,
            200,
        )

        report = liam.post(
            "/api/inbox/reports",
            json={"conversation_id": conversation_id, "reported_user_id": "usr_member_001", "message_id": message_id, "category": "other", "details": "Testing contextual administrator review."},
            headers={"X-CSRF-Token": liam_csrf},
        )
        self.assertEqual(report.status_code, 201, report.get_json())
        report_id = report.get_json()["report"]["id"]

        availability = maya.patch(
            "/api/calendar/availability",
            json={"timezone": "Asia/Kolkata", "buffer_minutes": 30, "weekly": {day: ([{"start": "18:00", "end": "20:00"}] if day in {"monday", "wednesday"} else []) for day in server.CALENDAR_DAYS}},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(availability.status_code, 200, availability.get_json())
        event_response = maya.post(
            "/api/calendar/events",
            json={"title": "Python and design exchange", "description": "Two-way practical session", "starts_at": "2026-09-20T10:00", "ends_at": "2026-09-20T11:30", "timezone": "Asia/Kolkata", "participant_ids": ["usr_member_002", "usr_member_004"], "location": "SwapLabs Live Room", "meeting_url": "", "conversation_id": conversation_id, "reminders_minutes": [1440, 60]},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(event_response.status_code, 201, event_response.get_json())
        calendar_event = event_response.get_json()["event"]
        self.assertTrue(calendar_event["starts_at"].startswith("2026-09-20T04:30:00"))
        event_id = calendar_event["id"]
        event_conversation_id = calendar_event["conversation_id"]
        self.assertTrue(event_conversation_id.startswith("conversation_event_"))

        for member_client in (liam, arjun):
            member_inbox = member_client.get("/api/inbox").get_json()
            meeting_preview = next(
                item for item in member_inbox["conversations"]
                if item["id"] == event_conversation_id
            )
            self.assertEqual(meeting_preview["kind"], "meeting")
            self.assertGreater(meeting_preview["unread_count"], 0)

            meeting_thread = member_client.get(
                f"/api/inbox/conversations/{event_conversation_id}"
            ).get_json()
            self.assertEqual(meeting_thread["conversation"]["event"]["id"], event_id)
            self.assertEqual(
                meeting_thread["messages"][-1]["metadata"]["calendar_action"],
                "scheduled",
            )
            self.assertEqual(
                meeting_thread["messages"][-1]["metadata"]["type"],
                "calendar_event",
            )

        self.assertEqual(
            sofia.get(f"/api/inbox/conversations/{event_conversation_id}").status_code,
            404,
        )

        liam_calendar = liam.get("/api/calendar")
        self.assertEqual(liam_calendar.status_code, 200, liam_calendar.get_json())
        invited_event = next(item for item in liam_calendar.get_json()["events"] if item["id"] == event_id)
        self.assertEqual(invited_event["host_id"], "usr_member_001")
        self.assertIn("usr_member_002", invited_event["participant_ids"])
        self.assertIn("usr_member_004", invited_event["participant_ids"])
        self.assertFalse(invited_event["viewer_can_edit"])
        self.assertTrue(any(item["id"] == event_id for item in arjun.get("/api/calendar").get_json()["events"]))
        self.assertEqual(maya.get(f"/api/calendar/events/{event_id}/ics").status_code, 200)
        rescheduled = maya.patch(
            f"/api/calendar/events/{event_id}",
            json={"starts_at": "2026-09-20T11:00", "ends_at": "2026-09-20T12:30", "timezone": "Asia/Kolkata"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(len(rescheduled.get_json()["event"]["reschedule_history"]), 1)

        for member_client in (liam, arjun):
            meeting_messages = member_client.get(
                f"/api/inbox/conversations/{event_conversation_id}"
            ).get_json()["messages"]
            self.assertEqual(meeting_messages[-1]["metadata"]["calendar_action"], "rescheduled")

        self.assertEqual(maya.delete(f"/api/calendar/events/{event_id}", headers={"X-CSRF-Token": maya_csrf}).get_json()["event"]["status"], "cancelled")

        for member_client in (liam, arjun):
            meeting_messages = member_client.get(
                f"/api/inbox/conversations/{event_conversation_id}"
            ).get_json()["messages"]
            self.assertEqual(meeting_messages[-1]["metadata"]["calendar_action"], "cancelled")

        transfer = maya.post(
            "/api/credits/transfer",
            json={"recipient_id": "usr_member_002", "amount": 2, "description": "Python lesson payment"},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(transfer.status_code, 201, transfer.get_json())
        outgoing_id = transfer.get_json()["outgoing"]["id"]
        self.assertEqual(transfer.get_json()["balance"], 12)
        dispute = maya.post(
            "/api/credits/disputes",
            json={"ledger_entry_id": outgoing_id, "reason": "Session did not happen", "details": "The session was cancelled before it started."},
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(dispute.status_code, 201, dispute.get_json())
        dispute_id = dispute.get_json()["dispute"]["id"]

        self.assertEqual(maya.get("/api/admin/operations").status_code, 403)
        admin, admin_csrf = self.admin_login()
        operations = admin.get("/api/admin/operations")
        self.assertEqual(operations.status_code, 200, operations.get_json())
        self.assertTrue(any(item["id"] == report_id for item in operations.get_json()["reports"]))
        report_detail = admin.get(f"/api/admin/message-reports/{report_id}")
        self.assertEqual(report_detail.status_code, 200, report_detail.get_json())
        report_payload = report_detail.get_json()["report"]
        self.assertGreaterEqual(report_payload["evidence_count"], 2)
        self.assertTrue(any(item["id"] == message_id for item in report_payload["conversation_activity"]))
        self.assertEqual(report_payload["conversation"]["id"], conversation_id)
        admin_attachment = admin.get(attachment_url)
        self.assertEqual(admin_attachment.status_code, 200)
        admin_attachment.close()
        moderated = admin.patch(
            f"/api/admin/messages/{message_id}/moderate",
            json={"status": "removed", "reason": "End-to-end moderation test"},
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(moderated.status_code, 200, moderated.get_json())
        reviewed = admin.patch(
            f"/api/admin/message-reports/{report_id}",
            json={"status": "resolved", "action": "warning", "admin_notes": "Reviewed with conversation evidence."},
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.get_json())
        resolution = admin.patch(
            f"/api/admin/credit-disputes/{dispute_id}",
            json={"resolution": "partial", "refund_amount": 1, "admin_notes": "Partial refund agreed from session evidence."},
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(resolution.status_code, 200, resolution.get_json())
        final_credits = maya.get("/api/credits").get_json()
        self.assertEqual(final_credits["balance"], 13)
        original = next(item for item in final_credits["entries"] if item["id"] == outgoing_id)
        self.assertEqual(original["amount"], -2)
        self.assertTrue(any(item["type"] == "refund" and item["amount"] == 1 for item in final_credits["entries"]))

    def test_timed_suspension_forces_logout_and_expires(self):
        member, member_csrf = self.login("liam.carter", "LiamSkill#2026")
        admin, admin_csrf = self.admin_login()
        suspended = admin.patch(
            "/api/admin/users/usr_member_002",
            json={
                "status": "suspended",
                "suspension_minutes": 90,
                "suspension_reason": "Repeated safety review while evidence is assessed.",
            },
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(suspended.status_code, 200, suspended.get_json())
        suspended_user = suspended.get_json()["user"]
        self.assertEqual(suspended_user["status"], "suspended")
        self.assertIsNotNone(suspended_user["suspended_until"])

        blocked_request = member.get("/api/calendar")
        self.assertEqual(blocked_request.status_code, 403, blocked_request.get_json())
        self.assertEqual(blocked_request.get_json()["access_status"], "suspended")
        self.assertFalse(member.get("/api/auth/me").get_json()["authenticated"])

        login_client = server.app.test_client()
        token = login_client.get("/api/auth/csrf").get_json()["csrf_token"]
        blocked_login = login_client.post(
            "/api/auth/login",
            json={"mode": "member", "login": "liam.carter", "password": "LiamSkill#2026"},
            headers={"X-CSRF-Token": token},
        )
        self.assertEqual(blocked_login.status_code, 403, blocked_login.get_json())
        self.assertIn("suspended until", blocked_login.get_json()["error"])

        restored = admin.patch(
            "/api/admin/users/usr_member_002",
            json={"status": "active"},
            headers={"X-CSRF-Token": admin_csrf},
        )
        self.assertEqual(restored.status_code, 200, restored.get_json())
        self.assertEqual(restored.get_json()["user"]["status"], "active")
        self.assertIsNone(restored.get_json()["user"]["suspended_until"])

    def test_account_preferences_persist_and_validate(self):
        member, member_csrf = self.login("maya.chen", "MayaSkill#2026")
        current = member.get("/api/auth/me").get_json()["user"]
        profile = dict(current["profile"])
        profile["additional_languages"] = profile.get("additional_languages", [])
        profile["skills_to_teach"] = profile.get("skills_to_teach", [])
        profile["skills_to_learn"] = profile.get("skills_to_learn", [])
        profile["interests"] = profile.get("interests", [])
        preferences = {
            **current["preferences"],
            "theme": "dark",
            "font_scale": "large",
            "content_density": "compact",
            "navigation_style": "compact",
            "default_landing": "inbox",
            "high_contrast": True,
            "reduced_motion": True,
            "link_underlines": True,
            "focus_mode": True,
            "show_ai_assistant": False,
            "auto_play_testimonials": False,
        }
        saved = member.patch(
            "/api/profile",
            json={"profile": profile, "preferences": preferences},
            headers={"X-CSRF-Token": member_csrf},
        )
        self.assertEqual(saved.status_code, 200, saved.get_json())
        saved_preferences = saved.get_json()["user"]["preferences"]
        for key, value in preferences.items():
            self.assertEqual(saved_preferences[key], value)
        refreshed = member.get("/api/auth/me").get_json()["user"]["preferences"]
        self.assertEqual(refreshed["theme"], "dark")
        self.assertEqual(refreshed["default_landing"], "inbox")
        invalid = member.patch(
            "/api/profile",
            json={"profile": profile, "preferences": {**preferences, "theme": "neon"}},
            headers={"X-CSRF-Token": member_csrf},
        )
        self.assertEqual(invalid.status_code, 400, invalid.get_json())

    def test_reminders_are_delivered_once(self):
        maya, maya_csrf = self.login("maya.chen", "MayaSkill#2026")
        starts = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(minutes=30)
        ends = starts + timedelta(hours=1)
        response = maya.post(
            "/api/calendar/events",
            json={
                "title": "Reminder check", "description": "Idempotent SwapBot reminder",
                "starts_at": starts.isoformat(), "ends_at": ends.isoformat(), "timezone": "UTC",
                "participant_ids": [], "location": "SwapLabs Live Room", "reminders_minutes": [60],
            },
            headers={"X-CSRF-Token": maya_csrf},
        )
        self.assertEqual(response.status_code, 201, response.get_json())
        data = server.read_store()
        self.assertEqual(server.process_due_reminders(data), 1)
        server.write_store(data)
        repeated = server.read_store()
        self.assertEqual(server.process_due_reminders(repeated), 0)
        inbox = maya.get("/api/inbox").get_json()
        bot_id = next(item["id"] for item in inbox["conversations"] if item["kind"] == "bot")
        messages = maya.get(f"/api/inbox/conversations/{bot_id}").get_json()["messages"]
        self.assertTrue(any("Reminder check" in item["body"] for item in messages))


if __name__ == "__main__":
    unittest.main()
