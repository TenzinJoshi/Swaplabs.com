#!/usr/bin/env python3
"""Local SwapLabs application server with JSON-backed accounts and admin tools."""


from __future__ import annotations

import csv
import io
import json
import mimetypes
import os
import re
import secrets
import tempfile
import threading
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from functools import wraps
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from flask import Flask, Response, jsonify, redirect, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
USERS_FILE = DATA_DIR / "users.json"
SECRET_FILE = DATA_DIR / ".session_secret"
UPLOAD_DIR = DATA_DIR / "uploads"
MESSAGE_UPLOAD_DIR = DATA_DIR / "message_uploads"
ALLOWED_STATIC_EXTENSIONS = {
    ".html", ".css", ".js", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".ico", ".svg", ".woff2"
}

USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,30}$")
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
STORE_LOCK = threading.RLock()
LOGIN_ATTEMPTS: dict[str, deque[datetime]] = defaultdict(deque)
TYPING_STATES: dict[tuple[str, str], datetime] = {}
REMINDER_WORKER_STARTED = False
BOT_NOTIFICATION_EXCLUSIONS = {"new_message"}


def calculate_age(date_of_birth: str, today: datetime | None = None) -> int:
    """Calculate age from a date of birth so student safeguards cannot drift."""
    try:
        birth_date = datetime.strptime(str(date_of_birth), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ValueError("Date of birth must use YYYY-MM-DD.") from None
    current_date = (today or datetime.now(timezone.utc)).date()
    age = current_date.year - birth_date.year - (
        (current_date.month, current_date.day) < (birth_date.month, birth_date.day)
    )
    if age < 13 or age > 120:
        raise ValueError("You must be between 13 and 120 years old to use SwapLabs.")
    return age


def default_safety(profile: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return the account safety record derived from the member's verified age data."""
    safety = dict(existing or {})
    age = int(profile.get("age", 0))
    is_minor = 13 <= age < 18
    defaults = {
        "is_minor": is_minor,
        "guardian_required": is_minor,
        "guardian_name": "",
        "guardian_email": "",
        "guardian_relationship": "",
        "guardian_consent_declared": False,
        "guardian_consent_status": "pending" if is_minor else "not_required",
        "guardian_verified_at": None,
        "guardian_verified_by": None,
        "guardian_notes": "",
        "minor_messaging": "connections_only" if is_minor else "standard",
        "innovation_access": "specialist_review" if is_minor else "standard",
    }
    for key, value in defaults.items():
        safety.setdefault(key, value)
    safety["is_minor"] = is_minor
    safety["guardian_required"] = is_minor
    safety["minor_messaging"] = "connections_only" if is_minor else "standard"
    safety["innovation_access"] = "specialist_review" if is_minor else "standard"
    if not is_minor:
        safety["guardian_consent_status"] = "not_required"
    elif safety.get("guardian_consent_status") not in {"pending", "verified", "rejected"}:
        safety["guardian_consent_status"] = "pending"
    return safety


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_utc_timestamp(value: Any) -> datetime | None:
    """Parse a stored ISO timestamp and normalize it to UTC."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def clear_account_suspension(user: dict[str, Any]) -> None:
    user["status"] = "active"
    user["suspended_until"] = None
    user["suspension_reason"] = ""
    user["suspended_at"] = None
    user["suspended_by"] = None
    user["updated_at"] = utc_now()


def refresh_expired_suspension(user: dict[str, Any]) -> bool:
    """Reactivate a timed suspension once its deadline has passed."""
    if user.get("status") != "suspended":
        return False
    deadline = parse_utc_timestamp(user.get("suspended_until"))
    if not deadline or deadline > datetime.now(timezone.utc):
        return False
    clear_account_suspension(user)
    return True


def suspension_message(user: dict[str, Any]) -> str:
    deadline = parse_utc_timestamp(user.get("suspended_until"))
    if not deadline:
        return "This account is suspended. Contact SwapLabs support."
    readable = deadline.strftime("%d %b %Y at %H:%M UTC")
    reason = str(user.get("suspension_reason") or "").strip()
    suffix = f" Reason: {reason}" if reason else ""
    return f"This account is suspended until {readable}.{suffix}"


def apply_timed_suspension(
    target: dict[str, Any], actor: dict[str, Any], payload: dict[str, Any], *, default_reason: str = ""
) -> str:
    """Apply a finite administrator suspension and return its ISO deadline."""
    deadline = None
    raw_until = payload.get("suspended_until")
    raw_minutes = payload.get("suspension_minutes")
    if raw_until:
        deadline = parse_utc_timestamp(raw_until)
        if not deadline:
            raise ValueError("Suspension end time must use ISO format.")
    elif raw_minutes not in {None, ""}:
        try:
            minutes = int(raw_minutes)
        except (TypeError, ValueError):
            raise ValueError("Suspension duration must be a whole number of minutes.") from None
        if minutes < 1 or minutes > 525600:
            raise ValueError("Suspension duration must be between 1 minute and 365 days.")
        deadline = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    else:
        raise ValueError("Choose how long this account should be suspended.")
    if deadline <= datetime.now(timezone.utc):
        raise ValueError("Suspension end time must be in the future.")
    if deadline > datetime.now(timezone.utc) + timedelta(days=365):
        raise ValueError("A timed suspension cannot be longer than 365 days.")
    reason = clean_text(
        payload.get("suspension_reason", default_reason), "Suspension reason", 1000, required=True
    )
    now = utc_now()
    target.update({
        "status": "suspended",
        "suspended_until": deadline.replace(microsecond=0).isoformat(),
        "suspension_reason": reason,
        "suspended_at": now,
        "suspended_by": actor["id"],
        "updated_at": now,
    })
    return target["suspended_until"]


def load_or_create_secret() -> str:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if SECRET_FILE.exists():
        return SECRET_FILE.read_text(encoding="utf-8").strip()
    value = secrets.token_hex(32)
    SECRET_FILE.write_text(value, encoding="utf-8")
    try:
        SECRET_FILE.chmod(0o600)
    except OSError:
        pass
    return value


app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("SWAPLABS_SECRET_KEY", load_or_create_secret())
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SWAPLABS_SECURE_COOKIES", "0").lower() in {"1", "true", "yes", "on"},
    PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
    MAX_CONTENT_LENGTH=5_000_000,
)


def seeded_profile(
    first: str,
    last: str,
    country: str,
    city: str,
    occupation: str,
    headline: str,
    teaches: list[str],
    learns: list[str],
    *,
    dob: str,
    age: int,
    color: str,
) -> dict[str, Any]:
    return {
        "first_name": first,
        "last_name": last,
        "display_name": f"{first} {last}",
        "pronouns": "",
        "date_of_birth": dob,
        "age": age,
        "country": country,
        "city": city,
        "timezone": "Asia/Kolkata" if country == "India" else "UTC",
        "primary_language": "English",
        "additional_languages": [],
        "occupation": occupation,
        "professional_role": occupation,
        "organization": "SwapLabs Community",
        "headline": headline,
        "bio": f"I enjoy practical learning, thoughtful collaboration, and sharing {teaches[0]} with curious people.",
        "website": "",
        "availability": "Weekday evenings",
        "preferred_format": "Remote or local",
        "teaching_style": "Project-based",
        "experience_level": "Intermediate",
        "learning_goal": f"Build confidence in {learns[0]} through consistent peer sessions.",
        "skills_to_teach": teaches,
        "skills_to_learn": learns,
        "interests": ["Community learning", "Creative projects", "Knowledge exchange"],
        "profile_color": color,
        "avatar_url": "",
    }


def seed_user(
    user_id: str,
    username: str,
    email: str,
    password: str,
    profile: dict[str, Any],
    *,
    role: str = "member",
    admin_id: str | None = None,
    credits: int = 8,
) -> dict[str, Any]:
    created = "2026-08-01T09:00:00+00:00"
    return {
        "id": user_id,
        "role": role,
        "status": "active",
        "username": username,
        "email": email,
        "password_hash": generate_password_hash(password),
        "admin_id_hash": generate_password_hash(admin_id) if admin_id else None,
        "profile": profile,
        "preferences": {
            "email_notifications": True,
            "weekly_digest": True,
            "match_visibility": True,
            "show_location": True,
            "profile_visibility": "public",
            "theme": "light",
            "font_scale": "default",
            "content_density": "comfortable",
            "navigation_style": "expanded",
            "default_landing": "dashboard",
            "high_contrast": False,
            "reduced_motion": False,
            "link_underlines": False,
            "focus_mode": False,
            "show_ai_assistant": True,
            "auto_play_testimonials": True,
            "dashboard_onboarding_complete": False,
            "data_retention": "standard",
            "message_retention": "forever",
            "session_history_retention": "forever",
            "allow_research_analytics": False,
        },
        "safety": default_safety(profile),
        "reputation": {
            "rating": 4.9 if role == "admin" else round(4.5 + min(credits, 20) / 50, 1),
            "review_count": 38 if role == "admin" else max(6, credits * 2),
            "completed_sessions": 64 if role == "admin" else max(8, credits * 3),
            "reliability_score": 99 if role == "admin" else min(98, 88 + credits // 2),
        },
        "time_credits": credits,
        "verified": role == "admin",
        "moderation_label": "none",
        "admin_notes": "Primary platform administrator." if role == "admin" else "",
        "suspended_until": None,
        "suspension_reason": "",
        "suspended_at": None,
        "suspended_by": None,
        "created_at": created,
        "updated_at": created,
        "last_login_at": None,
    }


def seeded_platform_content() -> dict[str, Any]:
    """Return the durable community content used by new and upgraded stores."""
    workshops = [
        {
            "id": "workshop_design_critique", "title": "Run a useful design critique",
            "category": "Design", "level": "Intermediate", "format": "Live online",
            "starts_at": "2026-08-30T14:00:00+00:00", "duration_minutes": 90, "seat_limit": 16,
            "host_id": "usr_member_001", "location": "SwapLabs Live Room",
            "description": "Practice giving specific, actionable feedback without turning critique into personal preference.",
            "outcomes": ["Frame a critique", "Separate goals from taste", "Leave with a reusable template"],
            "tags": ["Product design", "Feedback", "Portfolio"], "status": "scheduled",
        },
        {
            "id": "workshop_python_automation", "title": "Build a useful automation with Python",
            "category": "Technology", "level": "Beginner", "format": "Live online",
            "starts_at": "2026-09-03T12:30:00+00:00", "duration_minutes": 120, "seat_limit": 20,
            "host_id": "usr_member_002", "location": "SwapLabs Code Room",
            "description": "Turn a repetitive spreadsheet task into a small, readable Python workflow during one guided session.",
            "outcomes": ["Read and clean a CSV", "Automate a repeatable task", "Understand the finished script"],
            "tags": ["Python", "Automation", "Data"], "status": "scheduled",
        },
        {
            "id": "workshop_portfolio_story", "title": "Tell a clear portfolio story",
            "category": "Career", "level": "All levels", "format": "Small group",
            "starts_at": "2026-09-08T16:00:00+00:00", "duration_minutes": 75, "seat_limit": 12,
            "host_id": "usr_admin_001", "location": "SwapLabs Studio",
            "description": "Shape one project into a concise case study that explains decisions, evidence, and personal contribution.",
            "outcomes": ["Choose the right evidence", "Write a strong project arc", "Plan the next revision"],
            "tags": ["Portfolio", "Storytelling", "Career"], "status": "scheduled",
        },
        {
            "id": "workshop_data_story", "title": "Make data tell one honest story",
            "category": "Data", "level": "Intermediate", "format": "Live online",
            "starts_at": "2026-09-11T13:00:00+00:00", "duration_minutes": 105, "seat_limit": 18,
            "host_id": "usr_member_004", "location": "SwapLabs Data Lab",
            "description": "Move from a busy worksheet to one trustworthy visual explanation for a real decision.",
            "outcomes": ["Select a useful chart", "Remove misleading detail", "Write an evidence-led annotation"],
            "tags": ["Excel", "Visualization", "Communication"], "status": "scheduled",
        },
        {
            "id": "workshop_spanish_confidence", "title": "Speak Spanish without scripting every sentence",
            "category": "Languages", "level": "Beginner", "format": "Practice circle",
            "starts_at": "2026-09-15T17:30:00+00:00", "duration_minutes": 60, "seat_limit": 14,
            "host_id": "usr_member_003", "location": "SwapLabs Conversation Room",
            "description": "Use prompts, repair phrases, and supportive repetition to keep a real conversation moving.",
            "outcomes": ["Use ten repair phrases", "Respond without translating first", "Create a practice routine"],
            "tags": ["Spanish", "Conversation", "Confidence"], "status": "scheduled",
        },
        {
            "id": "workshop_idea_pitch", "title": "Turn an early idea into a credible pitch",
            "category": "Innovation", "level": "All levels", "format": "Hybrid workshop",
            "starts_at": "2026-09-19T10:00:00+00:00", "duration_minutes": 120, "seat_limit": 24,
            "host_id": "usr_admin_001", "location": "London Hub and online",
            "description": "Clarify the problem, evidence, beneficiaries, funding need, and next experiment behind an ambitious idea.",
            "outcomes": ["Write a one-line proposition", "Map proof and assumptions", "Build a transparent funding ask"],
            "tags": ["Innovation", "Pitching", "Funding"], "status": "scheduled",
        },
    ]
    feedback = [
        {
            "id": "feedback_seed_001", "user_id": "usr_member_004", "name": "Arjun Patel",
            "email": "arjun@swaplabs.local", "role": "Data analyst and learner", "rating": 5,
            "title": "A practical exchange from the first session",
            "message": "I taught a spreadsheet workflow and received a thoughtful UX research lesson in return. The goals were clear and the exchange felt genuinely balanced.",
            "permission_to_publish": True, "status": "published", "featured": True,
            "admin_notes": "Seed testimonial.", "created_at": "2026-08-18T09:00:00+00:00", "updated_at": "2026-08-18T09:00:00+00:00",
        },
        {
            "id": "feedback_seed_002", "user_id": "usr_member_001", "name": "Maya Chen",
            "email": "maya@swaplabs.local", "role": "Product designer and mentor", "rating": 5,
            "title": "The community makes progress visible",
            "message": "Workshops, profiles, and learning paths connect naturally. I can share what I know, see where people are heading, and support work that has a real outcome.",
            "permission_to_publish": True, "status": "published", "featured": True,
            "admin_notes": "Seed testimonial.", "created_at": "2026-08-19T11:20:00+00:00", "updated_at": "2026-08-19T11:20:00+00:00",
        },
        {
            "id": "feedback_seed_003", "user_id": "usr_member_003", "name": "Sofia Martin",
            "email": "sofia@swaplabs.local", "role": "Language coach", "rating": 5,
            "title": "Small groups, serious encouragement",
            "message": "The people I met were curious and generous. The platform gives enough structure to feel safe without making human learning feel mechanical.",
            "permission_to_publish": True, "status": "published", "featured": False,
            "admin_notes": "Seed testimonial.", "created_at": "2026-08-21T14:00:00+00:00", "updated_at": "2026-08-21T14:00:00+00:00",
        },
    ]
    ideas = [
        {
            "id": "idea_clean_water_scout", "owner_id": "usr_member_004",
            "title": "Low-cost community water quality scout", "tagline": "A pocket testing kit and shared map for communities that cannot wait months for laboratory results.",
            "category": "Climate and environment", "problem": "Small communities often discover unsafe water only after illness appears, while laboratory testing can be distant, slow, or expensive.",
            "solution": "Combine inexpensive colorimetric strips, a guided phone capture flow, and a community-owned risk map that flags samples for professional confirmation.",
            "beneficiaries": "Rural schools, local health workers, community organizers, and households using shared water sources.",
            "impact": "Earlier warnings, better evidence for local authorities, and a repeatable pathway from community observation to certified testing.",
            "stage": "Prototype", "funding_currency": "USD", "funding_needed": 18000,
            "funds_use": "Field-safe prototypes, calibration support, pilot training, certified comparison tests, and accessibility research.",
            "skills_needed": ["Environmental science", "Hardware prototyping", "Mobile UX", "Public health"],
            "collaboration": "Pilot partners and technical mentors", "reach": "India with an open global toolkit", "prototype_url": "",
            "pitch": "We are looking for schools and water specialists willing to test a transparent, community-first early warning workflow.",
            "status": "published", "moderation_notes": "", "created_at": "2026-08-17T08:30:00+00:00", "updated_at": "2026-08-22T10:00:00+00:00",
            "liked_by": ["usr_member_001", "usr_member_002", "usr_member_003"], "saved_by": ["usr_member_001"],
            "comments": [
                {"id": "comment_seed_001", "user_id": "usr_member_001", "message": "I can help map the field workflow and make the result screen understandable under pressure.", "created_at": "2026-08-20T12:00:00+00:00"},
                {"id": "comment_seed_002", "user_id": "usr_member_002", "message": "A calibration log and offline-first sync plan would make the pilot much stronger.", "created_at": "2026-08-21T09:30:00+00:00"},
            ],
        },
        {
            "id": "idea_signbridge", "owner_id": "usr_member_002",
            "title": "SignBridge classroom companion", "tagline": "Real-time lesson notes shaped for deaf and hard-of-hearing students, without replacing human interpreters.",
            "category": "Education", "problem": "Fast classroom discussion is difficult to follow when captions lose subject vocabulary, speaker identity, and visual references.",
            "solution": "A teacher-controlled companion that combines a vocabulary pack, speaker-aware notes, visual timestamps, and a student correction channel.",
            "beneficiaries": "Deaf and hard-of-hearing students, teachers, interpreters, and inclusive education teams.",
            "impact": "More complete lesson access, fewer missed references, and a reusable record that students can review after class.",
            "stage": "Research", "funding_currency": "USD", "funding_needed": 32000,
            "funds_use": "Paid student research, privacy review, classroom prototypes, caption quality evaluation, and school pilots.",
            "skills_needed": ["Accessibility research", "Speech technology", "Education policy", "Product design"],
            "collaboration": "Student researchers, accessibility mentors, and pilot schools", "reach": "Canada and remote pilot classrooms", "prototype_url": "",
            "pitch": "The next step is co-design with students before any technology choice is treated as settled.",
            "status": "published", "moderation_notes": "", "created_at": "2026-08-18T13:00:00+00:00", "updated_at": "2026-08-21T15:40:00+00:00",
            "liked_by": ["usr_member_001", "usr_member_003", "usr_member_004"], "saved_by": ["usr_member_003", "usr_member_004"],
            "comments": [{"id": "comment_seed_003", "user_id": "usr_member_003", "message": "Please include bilingual classroom contexts in the research plan; terminology switching is a major challenge.", "created_at": "2026-08-22T07:45:00+00:00"}],
        },
        {
            "id": "idea_surplus_loop", "owner_id": "usr_member_001",
            "title": "Surplus Loop for school kitchens", "tagline": "A simple forecasting and redistribution network that helps school kitchens waste less prepared food.",
            "category": "Food and agriculture", "problem": "School kitchens must prepare ahead, but attendance changes create avoidable food waste while nearby support groups face unpredictable demand.",
            "solution": "Use lightweight meal forecasts, safe collection windows, and verified local partners to redirect eligible surplus under clear food-safety rules.",
            "beneficiaries": "School kitchens, students, food rescue organizations, and nearby families.",
            "impact": "Lower disposal costs, better planning evidence, and more safe meals reaching trusted community partners.",
            "stage": "Pilot ready", "funding_currency": "USD", "funding_needed": 24000,
            "funds_use": "Food-safety consultation, partner onboarding, pilot operations, measurement, and a multilingual coordination tool.",
            "skills_needed": ["Service design", "Food safety", "Operations", "Community partnerships"],
            "collaboration": "Pilot schools, food rescue partners, and operations advisers", "reach": "Singapore pilot with reusable playbook", "prototype_url": "",
            "pitch": "We need two schools and one verified redistribution partner to test the complete service safely for twelve weeks.",
            "status": "funded", "moderation_notes": "", "created_at": "2026-08-16T10:00:00+00:00", "updated_at": "2026-08-22T09:00:00+00:00",
            "liked_by": ["usr_member_002", "usr_member_003", "usr_member_004", "usr_admin_001"], "saved_by": ["usr_member_004"], "comments": [],
        },
        {
            "id": "idea_language_window", "owner_id": "usr_member_003",
            "title": "Language Window for newcomer families", "tagline": "A neighborhood exchange where families practice essential local-language conversations with trained volunteers.",
            "category": "Community wellbeing", "problem": "Newcomer families often know textbook vocabulary but still struggle with school meetings, healthcare calls, transport questions, and local paperwork.",
            "solution": "Short scenario-based practice circles designed with local services, supported by bilingual prompts and clear boundaries around legal or medical advice.",
            "beneficiaries": "Newcomer families, schools, libraries, volunteers, and community service teams.",
            "impact": "More confidence in essential conversations and stronger connection between families and trustworthy local support.",
            "stage": "Early pilot", "funding_currency": "EUR", "funding_needed": 12000,
            "funds_use": "Facilitator training, childcare, venue access, translated prompts, safeguarding, and pilot evaluation.",
            "skills_needed": ["Community facilitation", "Translation", "Safeguarding", "Program evaluation"],
            "collaboration": "Libraries, schools, bilingual volunteers, and evaluation mentors", "reach": "Barcelona neighborhoods", "prototype_url": "",
            "pitch": "Recognition and trusted local partners matter as much as funding; the model should grow only with community ownership.",
            "status": "published", "moderation_notes": "", "created_at": "2026-08-20T16:00:00+00:00", "updated_at": "2026-08-22T11:10:00+00:00",
            "liked_by": ["usr_member_001", "usr_member_004"], "saved_by": ["usr_member_001"], "comments": [],
        },
    ]
    return {
        "workshops": workshops,
        "workshop_registrations": [
            {"id": "registration_seed_001", "workshop_id": "workshop_design_critique", "user_id": "usr_member_004", "status": "registered", "admin_notes": "", "created_at": "2026-08-22T09:10:00+00:00", "updated_at": "2026-08-22T09:10:00+00:00"},
            {"id": "registration_seed_002", "workshop_id": "workshop_python_automation", "user_id": "usr_member_003", "status": "registered", "admin_notes": "", "created_at": "2026-08-22T09:20:00+00:00", "updated_at": "2026-08-22T09:20:00+00:00"},
        ],
        "contact_messages": [], "complaints": [], "feedback": feedback, "ideas": ideas,
    }


def initial_store() -> dict[str, Any]:
    users = [
        seed_user(
            "usr_admin_001", "admin", "admin@swaplabs.local", "SwapLabsAdmin#2026",
            seeded_profile(
                "Avery", "Morgan", "United Kingdom", "London", "Platform Administrator",
                "Building a safe and useful skill-sharing community.", ["Community operations", "Product strategy"],
                ["Data storytelling", "Photography"], dob="1991-04-18", age=35, color="indigo"
            ), role="admin", admin_id="SWAPLABS-ADMIN-2026", credits=100
        ),
        seed_user(
            "usr_member_001", "maya.chen", "maya@swaplabs.local", "MayaSkill#2026",
            seeded_profile(
                "Maya", "Chen", "Singapore", "Singapore", "Product Designer",
                "Product designer sharing research, Figma, and prototyping.", ["Product design", "Figma"],
                ["Conversational French", "Photography"], dob="1997-02-14", age=29, color="pink"
            ), credits=14
        ),
        seed_user(
            "usr_member_002", "liam.carter", "liam@swaplabs.local", "LiamSkill#2026",
            seeded_profile(
                "Liam", "Carter", "Canada", "Toronto", "Software Engineer",
                "Python developer who enjoys making technical ideas approachable.", ["Python", "Web development"],
                ["Illustration", "Public speaking"], dob="1994-09-03", age=31, color="blue"
            ), credits=11
        ),
        seed_user(
            "usr_member_003", "sofia.martin", "sofia@swaplabs.local", "SofiaSkill#2026",
            seeded_profile(
                "Sofia", "Martin", "Spain", "Barcelona", "Language Coach",
                "Language coach creating relaxed, practical conversation sessions.", ["Spanish", "Presentation skills"],
                ["Data analysis", "Guitar"], dob="1998-06-27", age=28, color="purple"
            ), credits=19
        ),
        seed_user(
            "usr_member_004", "arjun.patel", "arjun@swaplabs.local", "ArjunSkill#2026",
            seeded_profile(
                "Arjun", "Patel", "India", "Bengaluru", "Data Analyst",
                "Analyst interested in peer learning and community-led projects.", ["Excel", "Data visualization"],
                ["UX research", "Creative writing"], dob="1999-11-09", age=26, color="indigo"
            ), credits=9
        ),
    ]
    return {
        "version": 9,
        "updated_at": utc_now(),
        "users": users,
        "audit_log": [{
            "id": "audit_seed_001",
            "actor_id": "system",
            "actor_name": "SwapLabs system",
            "action": "seeded_accounts",
            "target_id": None,
            "details": "Created one administrator and four member demonstration accounts.",
            "created_at": utc_now(),
        }],
        "follow_requests": [],
        "notifications": [],
        **seeded_platform_content(),
}


def default_availability(user: dict[str, Any]) -> dict[str, Any]:
    return {
        "user_id": user["id"],
        "timezone": user.get("profile", {}).get("timezone") or "UTC",
        "weekly": {
            "monday": [{"start": "18:00", "end": "20:00"}],
            "tuesday": [],
            "wednesday": [{"start": "18:00", "end": "20:00"}],
            "thursday": [],
            "friday": [{"start": "17:00", "end": "19:00"}],
            "saturday": [{"start": "10:00", "end": "13:00"}],
            "sunday": [],
        },
        "buffer_minutes": 15,
        "updated_at": utc_now(),
    }


def ensure_bot_conversation(data: dict[str, Any], user_id: str) -> dict[str, Any]:
    conversation_id = f"conversation_bot_{user_id}"
    conversation = next((item for item in data.setdefault("conversations", []) if item.get("id") == conversation_id), None)
    if conversation:
        conversation.setdefault("kind", "bot")
        conversation.setdefault("participant_ids", [user_id])
        conversation.setdefault("muted_by", [])
        return conversation
    now = utc_now()
    conversation = {
        "id": conversation_id,
        "kind": "bot",
        "participant_ids": [user_id],
        "created_by": "system",
        "muted_by": [],
        "created_at": now,
        "updated_at": now,
    }
    data["conversations"].append(conversation)
    return conversation


def ensure_operations_shape(data: dict[str, Any]) -> bool:
    """Add operations collections while preserving every existing account and record."""
    changed = False
    for key in (
        "conversations", "messages", "user_blocks", "message_reports", "calendar_events",
        "availability_rules", "credit_ledger", "credit_disputes", "video_rooms",
        "video_signals", "video_attendance",
    ):
        if key not in data:
            data[key] = []
            changed = True

    for user in data.get("users", []):
        conversation_count = len(data["conversations"])
        bot_conversation = ensure_bot_conversation(data, user["id"])
        changed = changed or len(data["conversations"]) != conversation_count

        existing_message_ids = {item.get("id") for item in data["messages"]}
        mirrored_notification_ids = {
            item.get("metadata", {}).get("notification_id") for item in data["messages"]
            if isinstance(item.get("metadata"), dict)
        }
        for notification in reversed(data.get("notifications", [])):
            if notification.get("user_id") != user["id"]:
                continue
            if notification.get("type") in BOT_NOTIFICATION_EXCLUSIONS:
                continue
            message_id = f"message_{notification['id']}"
            if message_id in existing_message_ids or notification.get("id") in mirrored_notification_ids:
                continue
            data["messages"].append({
                "id": message_id,
                "conversation_id": bot_conversation["id"],
                "sender_id": None,
                "sender_kind": "bot",
                "body": notification.get("message", "You have a SwapLabs update."),
                "attachment": None,
                "created_at": notification.get("created_at", utc_now()),
                "read_by": [user["id"]] if notification.get("read") else [],
                "moderation_status": "visible",
                "metadata": {"notification_id": notification.get("id"), "type": notification.get("type", "update")},
            })
            existing_message_ids.add(message_id)
            changed = True

        filtered_messages = [
            message for message in data["messages"]
            if not (
                message.get("sender_kind") == "bot"
                and message.get("metadata", {}).get("type") in BOT_NOTIFICATION_EXCLUSIONS
            )
        ]
        if len(filtered_messages) != len(data["messages"]):
            data["messages"] = filtered_messages
            changed = True

        if not any(item.get("user_id") == user["id"] for item in data["availability_rules"]):
            data["availability_rules"].append(default_availability(user))
            changed = True
        if not any(item.get("user_id") == user["id"] for item in data["credit_ledger"]):
            balance = int(user.get("time_credits", 0))
            data["credit_ledger"].append({
                "id": f"ledger_initial_{user['id']}",
                "user_id": user["id"],
                "type": "initial_balance",
                "amount": balance,
                "balance_after": balance,
                "reference_type": "account",
                "reference_id": user["id"],
                "counterparty_id": None,
                "description": "Opening SwapLabs time-credit balance",
                "created_by": "system",
                "created_at": user.get("created_at", utc_now()),
                "metadata": {"migration": True},
            })
            changed = True

    for registration in data.get("workshop_registrations", []):
        event_id = f"calendar_{registration.get('id')}"
        if any(item.get("id") == event_id for item in data["calendar_events"]):
            continue
        workshop = next((item for item in data.get("workshops", []) if item.get("id") == registration.get("workshop_id")), None)
        attendee = next((item for item in data.get("users", []) if item.get("id") == registration.get("user_id")), None)
        if not workshop or not attendee:
            continue
        try:
            starts = datetime.fromisoformat(workshop["starts_at"].replace("Z", "+00:00"))
        except (KeyError, ValueError):
            continue
        ends = starts + timedelta(minutes=int(workshop.get("duration_minutes", 60)))
        data["calendar_events"].append({
            "id": event_id,
            "title": workshop.get("title", "SwapLabs workshop"),
            "description": workshop.get("description", ""),
            "host_id": workshop.get("host_id"),
            "participant_ids": [attendee["id"]],
            "starts_at": starts.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
            "ends_at": ends.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
            "timezone": attendee.get("profile", {}).get("timezone") or "UTC",
            "location": workshop.get("location", "SwapLabs Live Room"),
            "meeting_url": "",
            "status": "scheduled" if registration.get("status") == "registered" else "cancelled",
            "reminders_minutes": [1440, 60],
            "sent_reminders": [],
            "reschedule_history": [],
            "workshop_id": workshop["id"],
            "conversation_id": None,
            "created_by": attendee["id"],
            "created_at": registration.get("created_at", utc_now()),
            "updated_at": registration.get("updated_at", utc_now()),
        })
        changed = True

    for event in data.get("calendar_events", []):
        conversation, conversation_changed = ensure_event_conversation(data, event)
        changed = changed or conversation_changed
        initial_action = "cancelled" if event.get("status") == "cancelled" else "scheduled"
        already_announced = any(
            message.get("conversation_id") == conversation["id"]
            and message.get("metadata", {}).get("type") == "calendar_event"
            and message.get("metadata", {}).get("event_id") == event.get("id")
            for message in data.get("messages", [])
        )
        if already_announced:
            continue
        actor = find_user(data, event.get("created_by")) or find_user(data, event.get("host_id"))
        meeting_message = append_event_inbox_message(data, event, actor, initial_action)
        meeting_message["created_at"] = event.get("created_at") or meeting_message["created_at"]
        conversation["updated_at"] = max(
            conversation.get("updated_at", ""), meeting_message["created_at"]
        )
        changed = True
    return changed


def ensure_store_shape(data: dict[str, Any]) -> bool:
    """Upgrade older JSON stores in place without replacing account data."""
    changed = False
    if data.get("version", 1) < 9:
        data["version"] = 9
        changed = True
    if "follow_requests" not in data:
        data["follow_requests"] = [
            {
                "id": "follow_seed_001", "requester_id": "usr_member_001", "target_id": "usr_member_003",
                "status": "pending", "created_at": "2026-08-22T10:30:00+00:00", "responded_at": None,
            },
            {
                "id": "follow_seed_002", "requester_id": "usr_member_002", "target_id": "usr_member_001",
                "status": "accepted", "created_at": "2026-08-20T12:00:00+00:00", "responded_at": "2026-08-20T13:15:00+00:00",
            },
            {
                "id": "follow_seed_003", "requester_id": "usr_member_004", "target_id": "usr_member_002",
                "status": "accepted", "created_at": "2026-08-19T09:00:00+00:00", "responded_at": "2026-08-19T10:00:00+00:00",
            },
        ]
        changed = True
    if "notifications" not in data:
        data["notifications"] = []
        for member in data.get("users", []):
            data["notifications"].append({
                "id": f"notification_welcome_{member['id']}", "user_id": member["id"], "actor_id": None,
                "type": "welcome", "message": "Your SwapLabs profile is ready. Add skills and visibility preferences to improve your community experience.",
                "read": False, "created_at": "2026-08-22T08:00:00+00:00", "data": {},
            })
        data["notifications"].append({
            "id": "notification_follow_seed_001", "user_id": "usr_member_003", "actor_id": "usr_member_001",
            "type": "follow_request", "message": "Maya Chen sent you a follow request.", "read": False,
            "created_at": "2026-08-22T10:30:00+00:00", "data": {"request_id": "follow_seed_001"},
        })
        changed = True
    platform_defaults = seeded_platform_content()
    for key, value in platform_defaults.items():
        if key not in data:
            data[key] = value
            changed = True
    for user in data.get("users", []):
        profile = user.setdefault("profile", {})
        preferences = user.setdefault("preferences", {})
        suspension_defaults = {
            "suspended_until": None,
            "suspension_reason": "",
            "suspended_at": None,
            "suspended_by": None,
        }
        profile_defaults = {
            "professional_role": profile.get("occupation", ""),
            "avatar_url": "",
            "teaching_style": "Project-based",
        }
        preference_defaults = {
            "profile_visibility": "private" if user.get("id") == "usr_member_003" else "public",
            "email_notifications": True,
            "weekly_digest": True,
            "match_visibility": True,
            "show_location": True,
            "theme": "light",
            "font_scale": "default",
            "content_density": "comfortable",
            "navigation_style": "expanded",
            "default_landing": "dashboard",
            "high_contrast": False,
            "reduced_motion": False,
            "link_underlines": False,
            "focus_mode": False,
            "show_ai_assistant": True,
            "auto_play_testimonials": True,
            "dashboard_onboarding_complete": False,
            "data_retention": "standard",
            "message_retention": "forever",
            "session_history_retention": "forever",
            "allow_research_analytics": False,
        }
        for key, value in profile_defaults.items():
            if key not in profile:
                profile[key] = value
                changed = True
        for key, value in preference_defaults.items():
            if key not in preferences:
                preferences[key] = value
                changed = True
        for key, value in suspension_defaults.items():
            if key not in user:
                user[key] = value
                changed = True
        try:
            calculated_age = calculate_age(profile.get("date_of_birth", ""))
        except ValueError:
            calculated_age = int(profile.get("age", 18) or 18)
        if profile.get("age") != calculated_age:
            profile["age"] = calculated_age
            changed = True
        previous_safety = user.get("safety")
        updated_safety = default_safety(profile, previous_safety)
        if previous_safety != updated_safety:
            user["safety"] = updated_safety
            changed = True
        if updated_safety.get("is_minor"):
            if preferences.get("profile_visibility") != "private":
                preferences["profile_visibility"] = "private"
                changed = True
            if preferences.get("show_location"):
                preferences["show_location"] = False
                changed = True
        if preferences.get("default_landing") == "profile" and not preferences.get("dashboard_landing_migrated"):
            preferences["default_landing"] = "dashboard"
            preferences["dashboard_landing_migrated"] = True
            changed = True
        if "reputation" not in user:
            seeded = user.get("id", "").startswith("usr_member_00") or user.get("role") == "admin"
            credits = int(user.get("time_credits", 0))
            user["reputation"] = {
                "rating": round(4.5 + min(credits, 20) / 50, 1) if seeded else 0,
                "review_count": max(6, credits * 2) if seeded else 0,
                "completed_sessions": max(8, credits * 3) if seeded else 0,
                "reliability_score": min(98, 88 + credits // 2) if seeded else 100,
            }
            changed = True
        if refresh_expired_suspension(user):
            changed = True
    if ensure_operations_shape(data):
        changed = True
    return changed


def read_store() -> dict[str, Any]:
    with STORE_LOCK:
        if not USERS_FILE.exists():
            data = initial_store()
            ensure_store_shape(data)
            write_store(data)
            return data
        with USERS_FILE.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        if ensure_store_shape(data):
            write_store(data)
        return data


def write_store(data: dict[str, Any]) -> None:
    with STORE_LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        data["updated_at"] = utc_now()
        descriptor, temporary_name = tempfile.mkstemp(prefix="users-", suffix=".json", dir=DATA_DIR)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(data, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            os.replace(temporary_name, USERS_FILE)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)


def find_user(data: dict[str, Any], user_id: str | None) -> dict[str, Any] | None:
    return next((user for user in data["users"] if user["id"] == user_id), None)


def safe_user(user: dict[str, Any], *, admin_view: bool = False) -> dict[str, Any]:
    result = {key: value for key, value in user.items() if key not in {"password_hash", "admin_id_hash"}}
    if not admin_view:
        result.pop("admin_notes", None)
        result.pop("moderation_label", None)
    return result


def active_follow(data: dict[str, Any], requester_id: str | None, target_id: str) -> dict[str, Any] | None:
    if not requester_id:
        return None
    return next((
        follow for follow in reversed(data.get("follow_requests", []))
        if follow["requester_id"] == requester_id and follow["target_id"] == target_id
        and follow["status"] in {"pending", "accepted"}
    ), None)


def follow_counts(data: dict[str, Any], user_id: str) -> tuple[int, int]:
    accepted = [follow for follow in data.get("follow_requests", []) if follow["status"] == "accepted"]
    followers = sum(follow["target_id"] == user_id for follow in accepted)
    following = sum(follow["requester_id"] == user_id for follow in accepted)
    return followers, following


def community_member(user: dict[str, Any], viewer: dict[str, Any] | None, data: dict[str, Any]) -> dict[str, Any]:
    profile = user["profile"]
    preferences = user.get("preferences", {})
    is_minor = bool(user.get("safety", {}).get("is_minor"))
    visibility = "private" if is_minor else preferences.get("profile_visibility", "public")
    relationship_record = active_follow(data, viewer.get("id") if viewer else None, user["id"])
    relationship = "self" if viewer and viewer["id"] == user["id"] else (
        "following" if relationship_record and relationship_record["status"] == "accepted" else
        "requested" if relationship_record and relationship_record["status"] == "pending" else "none"
    )
    can_view_full = bool(
        (visibility == "public" and not is_minor) or relationship == "self" or relationship == "following"
        or (viewer and viewer.get("role") == "admin")
    )
    visible_profile = {
        "display_name": profile.get("display_name", "SwapLabs member"),
        "first_name": profile.get("first_name", ""),
        "last_name": profile.get("last_name", ""),
        "full_name": " ".join(filter(None, [profile.get("first_name"), profile.get("last_name")])).strip(),
        "headline": profile.get("headline", ""),
        "professional_role": profile.get("professional_role", profile.get("occupation", "")),
        "profile_color": profile.get("profile_color", "indigo"),
        "avatar_url": profile.get("avatar_url", ""),
    }
    if can_view_full:
        visible_profile.update({
            key: profile.get(key)
            for key in (
                "age", "bio", "country", "city", "occupation", "organization", "primary_language",
                "additional_languages", "availability", "preferred_format", "experience_level",
                "teaching_style", "timezone", "learning_goal", "skills_to_teach", "skills_to_learn", "interests", "website"
            )
        })
        if not preferences.get("show_location", True):
            visible_profile["country"] = "Private"
            visible_profile["city"] = ""
        if is_minor and not (relationship == "self" or viewer and viewer.get("role") == "admin"):
            for protected_field in ("age", "city", "timezone", "website", "organization"):
                visible_profile.pop(protected_field, None)
    if is_minor:
        visible_profile["age_group"] = "13–15" if int(profile.get("age", 13)) <= 15 else "16–17"
    followers, following = follow_counts(data, user["id"])
    return {
        "id": user["id"],
        "username": user["username"],
        "role": user["role"],
        "verified": user.get("verified", False),
        "joined_at": user.get("created_at"),
        "visibility": visibility,
        "can_view_full": can_view_full,
        "relationship": relationship,
        "followers_count": followers,
        "following_count": following,
        "is_minor": is_minor,
        "student_safety": "guardian-reviewed" if user.get("safety", {}).get("guardian_consent_status") == "verified" else "protected",
        "profile": visible_profile,
    }


def json_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def current_session_user() -> tuple[dict[str, Any] | None, dict[str, Any]]:
    data = read_store()
    user = find_user(data, session.get("user_id"))
    return user, data


def login_required(view: Callable):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user, data = current_session_user()
        if not user:
            session.clear()
            return json_error("Please sign in to continue.", 401)
        if user["status"] != "active":
            session.clear()
            return jsonify({
                "ok": False,
                "error": suspension_message(user),
                "access_status": "suspended",
                "suspended_until": user.get("suspended_until"),
            }), 403
        return view(user, data, *args, **kwargs)

    return wrapped


def admin_required(view: Callable):
    @wraps(view)
    @login_required
    def wrapped(user, data, *args, **kwargs):
        if user["role"] != "admin":
            return json_error("Administrator access is required.", 403)
        return view(user, data, *args, **kwargs)

    return wrapped


def clean_text(value: Any, field: str, maximum: int = 160, *, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"{field} is required.")
    if len(text) > maximum:
        raise ValueError(f"{field} must be {maximum} characters or fewer.")
    return text


def clean_list(value: Any, field: str, maximum_items: int = 20) -> list[str]:
    if isinstance(value, str):
        values = value.split(",")
    elif isinstance(value, list):
        values = value
    else:
        values = []
    cleaned = []
    for item in values:
        text = clean_text(item, field, 60)
        if text and text.casefold() not in {existing.casefold() for existing in cleaned}:
            cleaned.append(text)
    return cleaned[:maximum_items]


def clean_email(value: Any, field: str = "Email") -> str:
    email = clean_text(value, field, 180, required=True).lower()
    if not EMAIL_RE.match(email):
        raise ValueError(f"{field} must be a valid email address.")
    return email


def optional_session_user(data: dict[str, Any]) -> dict[str, Any] | None:
    user = find_user(data, session.get("user_id"))
    return user if user and user.get("status") == "active" else None


def submitter_identity(payload: dict[str, Any], user: dict[str, Any] | None) -> tuple[str, str]:
    if user:
        name = clean_text(payload.get("name") or user["profile"].get("display_name"), "Name", 100, required=True)
        email = clean_email(payload.get("email") or user.get("email"))
        return name, email
    return clean_text(payload.get("name"), "Name", 100, required=True), clean_email(payload.get("email"))


def find_content(data: dict[str, Any], collection: str, content_id: str) -> dict[str, Any] | None:
    return next((item for item in data.get(collection, []) if item.get("id") == content_id), None)


def workshop_view(workshop: dict[str, Any], data: dict[str, Any], viewer: dict[str, Any] | None) -> dict[str, Any]:
    registrations = [
        item for item in data.get("workshop_registrations", [])
        if item.get("workshop_id") == workshop["id"] and item.get("status") == "registered"
    ]
    host = find_user(data, workshop.get("host_id"))
    host_view = community_member(host, viewer, data) if host else None
    registered = bool(viewer and any(item.get("user_id") == viewer["id"] for item in registrations))
    return {
        **workshop,
        "host": host_view,
        "registered_count": len(registrations),
        "seats_remaining": max(0, int(workshop.get("seat_limit", 0)) - len(registrations)),
        "viewer_registered": registered,
    }


def feedback_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        key: item.get(key) for key in (
            "id", "user_id", "name", "role", "rating", "title", "message", "featured", "created_at"
        )
    }


def comment_view(comment: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    author = find_user(data, comment.get("user_id"))
    if author:
        profile = author.get("profile", {})
        author_view = {
            "id": author["id"], "username": author.get("username"),
            "display_name": profile.get("display_name", "SwapLabs member"),
            "profile_color": profile.get("profile_color", "indigo"),
            "avatar_url": profile.get("avatar_url", ""), "verified": bool(author.get("verified")),
        }
    else:
        author_view = {"id": None, "username": "former-member", "display_name": "Former member", "profile_color": "indigo", "avatar_url": "", "verified": False}
    return {**comment, "author": author_view}


def idea_view(idea: dict[str, Any], data: dict[str, Any], viewer: dict[str, Any] | None, *, admin_view: bool = False) -> dict[str, Any]:
    owner = find_user(data, idea.get("owner_id"))
    owner_view = community_member(owner, viewer, data) if owner else None
    liked_by = idea.get("liked_by", [])
    saved_by = idea.get("saved_by", [])
    result = {
        key: idea.get(key) for key in (
            "id", "owner_id", "title", "tagline", "category", "problem", "solution", "beneficiaries",
            "impact", "stage", "funding_currency", "funding_needed", "funds_use", "skills_needed",
            "collaboration", "reach", "prototype_url", "pitch", "status", "created_at", "updated_at",
            "safety_review_status", "owner_age_group",
        )
    }
    result.update({
        "owner": owner_view,
        "like_count": len(liked_by),
        "save_count": len(saved_by),
        "comment_count": len(idea.get("comments", [])),
        "viewer_liked": bool(viewer and viewer["id"] in liked_by),
        "viewer_saved": bool(viewer and viewer["id"] in saved_by),
        "viewer_is_owner": bool(viewer and viewer["id"] == idea.get("owner_id")),
        "comments": [comment_view(comment, data) for comment in idea.get("comments", [])],
    })
    if admin_view:
        result["liked_by"] = liked_by
        result["saved_by"] = saved_by
        result["moderation_notes"] = idea.get("moderation_notes", "")
        result["specialist_reviewer_id"] = idea.get("specialist_reviewer_id")
        result["specialist_reviewed_at"] = idea.get("specialist_reviewed_at")
        result["guardian_consent_status"] = idea.get("guardian_consent_status", "not_required")
    return result


IDEA_FIELDS = {
    "title": (120, True), "tagline": (240, True), "category": (80, True), "problem": (1800, True),
    "solution": (1800, True), "beneficiaries": (700, True), "impact": (1000, True), "stage": (60, True),
    "funding_currency": (10, True), "funds_use": (1200, True), "collaboration": (500, True),
    "reach": (180, True), "prototype_url": (300, False), "pitch": (1200, True),
}


def validate_idea(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    idea = dict(existing or {})
    for field, (maximum, required) in IDEA_FIELDS.items():
        if field in payload or not existing:
            idea[field] = clean_text(payload.get(field), field.replace("_", " ").title(), maximum, required=required)
    if idea.get("prototype_url") and not re.match(r"^https?://", idea["prototype_url"], re.I):
        raise ValueError("Prototype URL must begin with http:// or https://.")
    if "skills_needed" in payload or not existing:
        idea["skills_needed"] = clean_list(payload.get("skills_needed"), "Skills needed", 12)
    if not idea.get("skills_needed"):
        raise ValueError("Add at least one skill or type of support needed.")
    raw_amount = payload.get("funding_needed", idea.get("funding_needed", 0))
    try:
        amount = int(raw_amount)
    except (TypeError, ValueError):
        raise ValueError("Funding needed must be a whole number.") from None
    if amount < 0 or amount > 1_000_000_000:
        raise ValueError("Funding needed must be between 0 and 1,000,000,000.")
    idea["funding_needed"] = amount
    return idea


def detect_profile_image(payload: bytes) -> tuple[str, str] | None:
    """Return a safe extension and MIME type for supported raster image signatures."""
    if payload.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def delete_profile_image(user: dict[str, Any]) -> None:
    avatar_url = user.get("profile", {}).get("avatar_url", "")
    if not avatar_url.startswith("/uploads/"):
        return
    filename = Path(avatar_url).name
    if not re.fullmatch(r"usr_[A-Za-z0-9_-]+\.(jpg|png|webp)", filename):
        return
    path = UPLOAD_DIR / filename
    if path.is_file():
        path.unlink()


PROFILE_FIELDS = {
    "first_name": (60, True), "last_name": (60, True), "display_name": (80, True),
    "pronouns": (40, False), "date_of_birth": (10, True), "country": (80, True),
    "city": (80, False), "timezone": (80, False), "primary_language": (60, True),
    "occupation": (100, False), "professional_role": (100, False), "organization": (100, False), "headline": (140, False),
    "bio": (700, False), "website": (200, False), "availability": (100, False),
    "preferred_format": (60, False), "teaching_style": (60, False), "experience_level": (40, False),
    "learning_goal": (500, False), "profile_color": (20, False),
}
LIST_PROFILE_FIELDS = {"additional_languages", "skills_to_teach", "skills_to_learn", "interests"}
PREFERENCE_DEFAULTS = {
    "email_notifications": True,
    "weekly_digest": True,
    "match_visibility": True,
    "show_location": True,
    "high_contrast": False,
    "reduced_motion": False,
    "link_underlines": False,
    "focus_mode": False,
    "show_ai_assistant": True,
    "auto_play_testimonials": True,
    "dashboard_onboarding_complete": False,
    "allow_research_analytics": False,
}
PREFERENCE_CHOICES = {
    "profile_visibility": {"public", "private"},
    "theme": {"light", "dark"},
    "font_scale": {"small", "default", "large", "extra-large"},
    "content_density": {"comfortable", "compact"},
    "navigation_style": {"expanded", "compact"},
    "default_landing": {"dashboard", "home", "profile", "inbox", "calendar", "community"},
    "data_retention": {"standard", "reduced", "minimal"},
    "message_retention": {"30_days", "90_days", "365_days", "forever"},
    "session_history_retention": {"90_days", "365_days", "730_days", "forever"},
}

GUARDIAN_RELATIONSHIPS = {
    "parent", "legal guardian", "grandparent", "adult sibling", "foster carer", "other guardian",
}


def validate_profile(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    source = payload.get("profile", payload)
    profile = dict(existing or {})
    for field, (maximum, required) in PROFILE_FIELDS.items():
        if field in source or not existing:
            profile[field] = clean_text(source.get(field), field.replace("_", " ").title(), maximum, required=required)
    profile["age"] = calculate_age(profile.get("date_of_birth", ""))
    for field in LIST_PROFILE_FIELDS:
        if field in source or not existing:
            profile[field] = clean_list(source.get(field), field.replace("_", " ").title())
    if profile.get("profile_color") not in {"indigo", "blue", "pink", "purple"}:
        profile["profile_color"] = "indigo"
    if profile.get("website") and not re.match(r"^https?://", profile["website"], re.I):
        raise ValueError("Website must begin with http:// or https://.")
    return profile


def validate_preferences(payload: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    source = payload.get("preferences", {})
    preferences = dict(existing or {})
    for field, default in PREFERENCE_DEFAULTS.items():
        if field in source:
            preferences[field] = bool(source.get(field))
        elif field not in preferences:
            preferences[field] = default
    choice_defaults = {
        "profile_visibility": "public", "theme": "light", "font_scale": "default",
        "content_density": "comfortable", "navigation_style": "expanded", "default_landing": "dashboard",
        "data_retention": "standard", "message_retention": "forever",
        "session_history_retention": "forever",
    }
    for field, allowed in PREFERENCE_CHOICES.items():
        if field in source or field not in preferences:
            value = clean_text(source.get(field, choice_defaults[field]), field.replace("_", " ").title(), 30).lower()
            if value not in allowed:
                choices = ", ".join(sorted(allowed))
                raise ValueError(f"{field.replace('_', ' ').title()} must be one of: {choices}.")
            preferences[field] = value
    return preferences


def validate_safety(
    payload: dict[str, Any], profile: dict[str, Any], existing: dict[str, Any] | None = None,
    *, registration: bool = False,
) -> dict[str, Any]:
    source = payload.get("safety", {})
    safety = default_safety(profile, existing)
    if not safety["is_minor"]:
        return safety

    previous_contact = (
        safety.get("guardian_name", ""), safety.get("guardian_email", ""),
        safety.get("guardian_relationship", ""),
    )
    safety["guardian_name"] = clean_text(
        source.get("guardian_name", safety.get("guardian_name")), "Guardian name", 120, required=True
    )
    guardian_email = clean_text(
        source.get("guardian_email", safety.get("guardian_email")), "Guardian email", 120, required=True
    ).lower()
    if not EMAIL_RE.fullmatch(guardian_email):
        raise ValueError("Enter a valid guardian email address.")
    safety["guardian_email"] = guardian_email
    relationship = clean_text(
        source.get("guardian_relationship", safety.get("guardian_relationship")),
        "Guardian relationship", 40, required=True,
    ).casefold()
    if relationship not in GUARDIAN_RELATIONSHIPS:
        raise ValueError("Choose a valid guardian relationship.")
    safety["guardian_relationship"] = relationship
    declared = source.get("guardian_consent_declared", safety.get("guardian_consent_declared", False)) is True
    if registration and not declared:
        raise ValueError("A parent or guardian must confirm consent for a member under 18.")
    safety["guardian_consent_declared"] = declared

    current_contact = (
        safety["guardian_name"], safety["guardian_email"], safety["guardian_relationship"],
    )
    if not existing or current_contact != previous_contact:
        safety["guardian_consent_status"] = "pending"
        safety["guardian_verified_at"] = None
        safety["guardian_verified_by"] = None
    return safety


def password_error(password: str) -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters."
    if not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password):
        return "Password must include uppercase and lowercase letters."
    if not re.search(r"\d", password) or not re.search(r"[^A-Za-z0-9]", password):
        return "Password must include a number and a symbol."
    return None


def add_audit(
    data: dict[str, Any], actor: dict[str, Any] | None, action: str,
    target_id: str | None, details: str
) -> None:
    data.setdefault("audit_log", []).insert(0, {
        "id": f"audit_{secrets.token_hex(6)}",
        "actor_id": actor["id"] if actor else "system",
        "actor_name": actor["profile"]["display_name"] if actor else "SwapLabs system",
        "action": action,
        "target_id": target_id,
        "details": details,
        "created_at": utc_now(),
    })
    data["audit_log"] = data["audit_log"][:1000]


def find_conversation(data: dict[str, Any], conversation_id: str) -> dict[str, Any] | None:
    return next((item for item in data.get("conversations", []) if item.get("id") == conversation_id), None)


def conversation_member(conversation: dict[str, Any], user_id: str) -> bool:
    return user_id in conversation.get("participant_ids", [])


def users_blocked(data: dict[str, Any], first_id: str, second_id: str) -> bool:
    return any(
        {item.get("blocker_id"), item.get("blocked_id")} == {first_id, second_id}
        for item in data.get("user_blocks", [])
    )


def accepted_connection(data: dict[str, Any], first_id: str, second_id: str) -> bool:
    return any(
        item.get("status") == "accepted"
        and {item.get("requester_id"), item.get("target_id")} == {first_id, second_id}
        for item in data.get("follow_requests", [])
    )


def minor_messaging_allowed(data: dict[str, Any], first: dict[str, Any], second: dict[str, Any]) -> bool:
    if not (first.get("safety", {}).get("is_minor") or second.get("safety", {}).get("is_minor")):
        return True
    return accepted_connection(data, first["id"], second["id"])


def append_message(
    data: dict[str, Any], conversation: dict[str, Any], body: str, *,
    sender_id: str | None = None, sender_kind: str = "member",
    attachment: dict[str, Any] | None = None, metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    message = {
        "id": f"message_{secrets.token_hex(9)}",
        "conversation_id": conversation["id"],
        "sender_id": sender_id,
        "sender_kind": sender_kind,
        "body": body,
        "attachment": attachment,
        "created_at": utc_now(),
        "read_by": [sender_id] if sender_id else (list(conversation.get("participant_ids", [])) if sender_kind == "system" else []),
        "moderation_status": "visible",
        "metadata": metadata or {},
    }
    data.setdefault("messages", []).append(message)
    conversation["updated_at"] = message["created_at"]
    return message


def event_conversation_member_ids(event: dict[str, Any]) -> list[str]:
    member_ids = []
    for member_id in (
        event.get("host_id"), event.get("created_by"), *(event.get("participant_ids") or [])
    ):
        if member_id and member_id not in member_ids:
            member_ids.append(member_id)
    return member_ids


def ensure_event_conversation(
    data: dict[str, Any], event: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """Create or synchronize the Inbox thread shared by every meeting member."""
    changed = False
    current = find_conversation(data, event.get("conversation_id", ""))
    if current and current.get("kind") != "meeting":
        if event.get("source_conversation_id") != current["id"]:
            event["source_conversation_id"] = current["id"]
            changed = True
        current = None

    conversation_id = f"conversation_event_{event.get('id')}"
    conversation = current or find_conversation(data, conversation_id)
    now = event.get("created_at") or utc_now()
    if not conversation:
        conversation = {
            "id": conversation_id,
            "kind": "meeting",
            "event_id": event.get("id"),
            "title": event.get("title") or "SwapLabs meeting",
            "participant_ids": event_conversation_member_ids(event),
            "created_by": event.get("created_by") or event.get("host_id") or "system",
            "muted_by": [],
            "created_at": now,
            "updated_at": now,
        }
        data.setdefault("conversations", []).append(conversation)
        changed = True

    expected = {
        "kind": "meeting",
        "event_id": event.get("id"),
        "title": event.get("title") or "SwapLabs meeting",
        "participant_ids": event_conversation_member_ids(event),
    }
    for key, value in expected.items():
        if conversation.get(key) != value:
            conversation[key] = value
            changed = True
    if "muted_by" not in conversation:
        conversation["muted_by"] = []
        changed = True
    if event.get("conversation_id") != conversation["id"]:
        event["conversation_id"] = conversation["id"]
        changed = True
    return conversation, changed


def event_inbox_snapshot(event: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    host = find_user(data, event.get("host_id"))
    participants = [
        member for member_id in event.get("participant_ids", [])
        if (member := find_user(data, member_id))
    ]
    try:
        duration_minutes = max(1, int((
            datetime.fromisoformat(event["ends_at"]) - datetime.fromisoformat(event["starts_at"])
        ).total_seconds() // 60))
    except (KeyError, TypeError, ValueError):
        duration_minutes = 0
    return {
        "id": event.get("id"),
        "title": event.get("title") or "SwapLabs meeting",
        "description": event.get("description", ""),
        "starts_at": event.get("starts_at"),
        "ends_at": event.get("ends_at"),
        "duration_minutes": duration_minutes,
        "timezone": event.get("timezone") or "UTC",
        "location": event.get("location", ""),
        "meeting_url": event.get("meeting_url", ""),
        "status": event.get("status") or "scheduled",
        "host": public_member_card(host) if host else None,
        "participants": [public_member_card(member) for member in participants],
        "conversation_id": event.get("conversation_id"),
    }


def append_event_inbox_message(
    data: dict[str, Any], event: dict[str, Any], actor: dict[str, Any] | None, action: str
) -> dict[str, Any]:
    conversation, _changed = ensure_event_conversation(data, event)
    action_copy = {
        "scheduled": "scheduled this meeting",
        "rescheduled": "rescheduled this meeting",
        "updated": "updated this meeting",
        "cancelled": "cancelled this meeting",
    }.get(action, "updated this meeting")
    actor_name = actor.get("profile", {}).get("display_name") if actor else "SwapLabs"
    message = append_message(
        data, conversation,
        f"{actor_name} {action_copy}: {event.get('title', 'SwapLabs meeting')}.",
        sender_id=actor.get("id") if actor else None,
        sender_kind="system",
        metadata={
            "type": "calendar_event",
            "calendar_action": action,
            "event_id": event.get("id"),
            "event": event_inbox_snapshot(event, data),
        },
    )
    if not actor:
        message["read_by"] = []
    return message


def deliver_bot_message(
    data: dict[str, Any], user_id: str, message: str, *,
    message_type: str = "update", metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    conversation = ensure_bot_conversation(data, user_id)
    return append_message(
        data, conversation, message[:2000], sender_kind="bot",
        metadata={"type": message_type, **(metadata or {})},
    )


def bot_reply_for(message: str) -> str:
    normalized = re.sub(r"[^a-z0-9 ]", " ", message.casefold())
    if any(word in normalized for word in ("dashboard", "next action", "recommended match", "goal progress")):
        return "Your dashboard.html page combines upcoming sessions, explainable matches, credit balance, pending requests, recent messages, learning-goal progress, and a suggested next action from your live account data."
    if any(word in normalized for word in ("matching", "match score", "why this match", "reliability", "proficiency")):
        return "Skill Matching scores real members across skill fit, learning goals, teaching style, session format, timezone-aware availability, languages, proficiency, session history, and reliability. Open Why this match to see every awarded point."
    if any(word in normalized for word in ("credit", "balance", "pay", "ledger", "refund", "dispute")):
        return "Your Credit Ledger shows every earning, payment, correction, refund, and dispute. Open credits.html to review your balance, transfer credits, or dispute an outgoing payment."
    if any(word in normalized for word in ("calendar", "schedule", "availability", "timezone", "meeting", "reschedul")):
        return "Use calendar.html to set weekly availability, create or reschedule sessions, view times in your timezone, and export an event to Google, Outlook, or an ICS file."
    if any(word in normalized for word in ("message", "inbox", "chat", "attachment", "mute", "block", "report")):
        return "This Inbox keeps your member conversations and platform updates together. Open a member chat to send an attachment, mute alerts, block contact, report activity, or schedule a session."
    if any(word in normalized for word in ("workshop", "class", "live session")):
        return "Browse workshops.html for live workshops. A confirmed registration is automatically added to your SwapLabs calendar."
    if any(word in normalized for word in ("profile", "photo", "private", "follow")):
        return "Edit your account in profile.html. Private profiles approve follow requests from the Inbox; public profiles remain visible to the community."
    if any(word in normalized for word in ("idea", "innovation", "fund", "student")):
        return "The Innovation Lab at skill-innovation.html lets members publish ideas, seek funding or collaborators, and receive likes, saves, and comments."
    if any(word in normalized for word in ("admin", "moderation", "suspend")):
        return "Administrators review reports, message evidence, disputes, account actions, and platform activity from admin.html."
    if any(word in normalized for word in ("hello", "hi ", "hey", "help", "start")):
        return "Hello. I am SwapBot. Ask me about messages, workshops, profiles, scheduling, credit payments, disputes, ideas, or account safety."
    return "I can help with any SwapLabs feature. Try asking how to message a member, schedule a session, export a calendar event, transfer time credits, submit an idea, or report unsafe activity."


def append_credit_entry(
    data: dict[str, Any], user_id: str, entry_type: str, amount: int, description: str, *,
    reference_type: str = "platform", reference_id: str | None = None,
    counterparty_id: str | None = None, created_by: str = "system",
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    user = find_user(data, user_id)
    if not user:
        raise ValueError("Credit account not found.")
    previous_balance = int(user.get("time_credits", 0))
    new_balance = previous_balance + int(amount)
    if new_balance < 0:
        raise ValueError("This account does not have enough time credits.")
    entry = {
        "id": f"ledger_{secrets.token_hex(10)}",
        "user_id": user_id,
        "type": entry_type,
        "amount": int(amount),
        "balance_after": new_balance,
        "reference_type": reference_type,
        "reference_id": reference_id,
        "counterparty_id": counterparty_id,
        "description": clean_text(description, "Ledger description", 500, required=True),
        "created_by": created_by,
        "created_at": utc_now(),
        "metadata": metadata or {},
    }
    data.setdefault("credit_ledger", []).append(entry)
    user["time_credits"] = new_balance
    user["updated_at"] = entry["created_at"]
    return entry


def parse_local_datetime(value: Any, zone_name: str) -> datetime:
    raw = clean_text(value, "Date and time", 40, required=True)
    try:
        zone = ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        raise ValueError("Choose a valid IANA timezone.") from None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Date and time must use ISO format.") from None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zone)
    return parsed.astimezone(timezone.utc).replace(microsecond=0)


def public_member_card(user: dict[str, Any]) -> dict[str, Any]:
    profile = user.get("profile", {})
    return {
        "id": user["id"], "username": user.get("username", ""), "role": user.get("role", "member"),
        "status": user.get("status", "active"), "verified": bool(user.get("verified")),
        "display_name": profile.get("display_name", "SwapLabs member"),
        "headline": profile.get("headline", ""), "avatar_url": profile.get("avatar_url", ""),
        "profile_color": profile.get("profile_color", "indigo"),
    }


def event_view(event: dict[str, Any], data: dict[str, Any], viewer: dict[str, Any]) -> dict[str, Any]:
    participants = [public_member_card(member) for member_id in event.get("participant_ids", []) if (member := find_user(data, member_id))]
    host = find_user(data, event.get("host_id"))
    video_room = next((room for room in data.get("video_rooms", []) if room.get("event_id") == event.get("id")), None)
    return {
        **event,
        "participants": participants,
        "host": public_member_card(host) if host else None,
        "video_room_id": video_room.get("id") if video_room else None,
        "video_room_status": video_room.get("status") if video_room else "not_created",
        "viewer_can_edit": viewer["id"] == event.get("created_by") or viewer["id"] == event.get("host_id") or viewer.get("role") == "admin",
    }


SKILL_CATEGORY_KEYWORDS = {
    "Technology": ("python", "code", "coding", "web", "software", "javascript", "html", "css", "app", "automation", "cyber"),
    "Data": ("data", "excel", "analytics", "visualization", "statistics", "machine learning", "sql"),
    "Design": ("design", "figma", "ux", "ui", "prototype", "illustration", "research"),
    "Languages": ("english", "french", "spanish", "hindi", "language", "conversation", "writing"),
    "Creative": ("photo", "photography", "video", "film", "art", "creative", "story", "craft"),
    "Music": ("music", "guitar", "piano", "singing", "audio", "drum"),
    "Business": ("business", "marketing", "finance", "strategy", "product", "leadership", "speaking", "career"),
    "Wellness": ("fitness", "yoga", "wellness", "nutrition", "meditation", "sport"),
}


def normalized_terms(value: Any) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", str(value or "").casefold()))


def skill_category(skill: str) -> str:
    normalized = str(skill or "").casefold()
    for category, keywords in SKILL_CATEGORY_KEYWORDS.items():
        if any(keyword in normalized for keyword in keywords):
            return category
    return "Other skills"


def skill_similarity(wanted: list[str], offered: list[str]) -> tuple[float, dict[str, str] | None]:
    best_score = 0.0
    best_pair = None
    for desired in wanted:
        desired_normalized = desired.casefold().strip()
        desired_terms = normalized_terms(desired)
        if not desired_normalized:
            continue
        for available in offered:
            available_normalized = available.casefold().strip()
            available_terms = normalized_terms(available)
            if desired_normalized == available_normalized:
                score = 1.0
            elif desired_normalized in available_normalized or available_normalized in desired_normalized:
                score = 0.88
            elif desired_terms and available_terms:
                overlap = len(desired_terms & available_terms)
                score = 0.72 * overlap / max(len(desired_terms | available_terms), 1)
            else:
                score = 0.0
            if score > best_score:
                best_score = score
                best_pair = {"wanted": desired, "offered": available}
    return best_score, best_pair


def availability_record(data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    record = next((item for item in data.get("availability_rules", []) if item.get("user_id") == user["id"]), None)
    return dict(record or default_availability(user))


def availability_windows(record: dict[str, Any], *, now: datetime | None = None, days: int = 8) -> list[tuple[datetime, datetime]]:
    moment = now or datetime.now(timezone.utc)
    try:
        zone = ZoneInfo(record.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        zone = ZoneInfo("UTC")
    local_today = moment.astimezone(zone).date()
    weekly = record.get("weekly") if isinstance(record.get("weekly"), dict) else {}
    windows = []
    for offset in range(days):
        local_date = local_today + timedelta(days=offset)
        day_name = local_date.strftime("%A").casefold()
        for slot in weekly.get(day_name, []):
            try:
                start_hour, start_minute = (int(part) for part in slot["start"].split(":"))
                end_hour, end_minute = (int(part) for part in slot["end"].split(":"))
                starts = datetime(local_date.year, local_date.month, local_date.day, start_hour, start_minute, tzinfo=zone)
                ends = datetime(local_date.year, local_date.month, local_date.day, end_hour, end_minute, tzinfo=zone)
            except (KeyError, TypeError, ValueError):
                continue
            windows.append((starts.astimezone(timezone.utc), ends.astimezone(timezone.utc)))
    return windows


def availability_compatibility(
    data: dict[str, Any], viewer: dict[str, Any], candidate: dict[str, Any], *, timezone_override: str = ""
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    viewer_record = availability_record(data, viewer)
    if timezone_override:
        try:
            ZoneInfo(timezone_override)
            viewer_record["timezone"] = timezone_override
        except ZoneInfoNotFoundError:
            pass
    candidate_record = availability_record(data, candidate)
    viewer_windows = availability_windows(viewer_record, now=now)
    candidate_windows = availability_windows(candidate_record, now=now)
    overlaps = []
    total_minutes = 0
    for viewer_start, viewer_end in viewer_windows:
        for candidate_start, candidate_end in candidate_windows:
            starts = max(viewer_start, candidate_start)
            ends = min(viewer_end, candidate_end)
            if ends > starts:
                overlaps.append((starts, ends))
                total_minutes += int((ends - starts).total_seconds() // 60)
    overlaps.sort(key=lambda window: window[0])
    available_now = any(start <= now <= end for start, end in candidate_windows)
    try:
        viewer_zone = ZoneInfo(viewer_record.get("timezone") or "UTC")
    except ZoneInfoNotFoundError:
        viewer_zone = ZoneInfo("UTC")
    next_overlap = next((window for window in overlaps if window[1] > now), None)
    if available_now:
        label = "Available now"
    elif next_overlap:
        label = f"Overlap {next_overlap[0].astimezone(viewer_zone).strftime('%a %d %b, %H:%M')}"
    else:
        label = "No shared time found"
    return {
        "available_now": available_now,
        "overlap_minutes_next_8_days": total_minutes,
        "next_overlap_at": next_overlap[0].isoformat() if next_overlap else None,
        "label": label,
        "viewer_timezone": str(viewer_zone),
        "candidate_timezone": candidate_record.get("timezone") or "UTC",
    }


def member_reputation(user: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    stored = user.get("reputation") if isinstance(user.get("reputation"), dict) else {}
    completed_events = 0
    cancelled_events = 0
    for event in data.get("calendar_events", []):
        involved = user["id"] == event.get("host_id") or user["id"] in event.get("participant_ids", [])
        if not involved:
            continue
        if event.get("status") == "completed":
            completed_events += 1
        elif event.get("status") == "cancelled" and user["id"] == event.get("host_id"):
            cancelled_events += 1
    completed = max(int(stored.get("completed_sessions", 0)), completed_events)
    reliability = max(0, min(100, int(stored.get("reliability_score", 100)) - cancelled_events * 2))
    reviews = max(0, int(stored.get("review_count", 0)))
    rating = float(stored.get("rating", 0)) if reviews else 0.0
    return {
        "rating": round(max(0.0, min(5.0, rating)), 1),
        "review_count": reviews,
        "completed_sessions": completed,
        "reliability_score": reliability,
    }


def match_profile_preview(user: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    profile = user.get("profile", {})
    skills_to_teach = list(profile.get("skills_to_teach") or [])
    skills_to_learn = list(profile.get("skills_to_learn") or [])
    return {
        **public_member_card(user),
        "country": profile.get("country", ""),
        "timezone": profile.get("timezone", "UTC"),
        "primary_language": profile.get("primary_language", ""),
        "additional_languages": profile.get("additional_languages", []),
        "experience_level": profile.get("experience_level", "Not specified"),
        "teaching_style": profile.get("teaching_style", "Flexible"),
        "preferred_format": profile.get("preferred_format", "Flexible"),
        "skills_to_teach": skills_to_teach,
        "skills_to_learn": skills_to_learn,
        "skill_categories": sorted({skill_category(skill) for skill in skills_to_teach + skills_to_learn}),
        "reputation": member_reputation(user, data),
    }


def matching_query(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    profile = user.get("profile", {})
    languages = clean_list(payload.get("languages", [profile.get("primary_language"), *(profile.get("additional_languages") or [])]), "Languages")
    timezone_name = clean_text(payload.get("timezone", profile.get("timezone") or "UTC"), "Timezone", 80)
    try:
        ZoneInfo(timezone_name or "UTC")
    except ZoneInfoNotFoundError:
        timezone_name = profile.get("timezone") or "UTC"
    return {
        "learn_skills": clean_list(payload.get("learn_skills", profile.get("skills_to_learn", [])), "Skills to learn"),
        "teach_skills": clean_list(payload.get("teach_skills", profile.get("skills_to_teach", [])), "Skills to teach"),
        "proficiency": clean_text(payload.get("proficiency", profile.get("experience_level") or "Intermediate"), "Proficiency", 40),
        "learning_goal": clean_text(payload.get("learning_goal", profile.get("learning_goal") or ""), "Learning goal", 500),
        "teaching_style": clean_text(payload.get("teaching_style", profile.get("teaching_style") or "Flexible"), "Teaching style", 60),
        "session_format": clean_text(payload.get("session_format", profile.get("preferred_format") or "Flexible"), "Session format", 60),
        "timezone": timezone_name,
        "languages": languages,
        "category": clean_text(payload.get("category"), "Category", 60),
        "strict_skill_match": bool(payload.get("strict_skill_match", False)),
    }


def compatible_text(left: str, right: str) -> bool:
    left_terms = normalized_terms(left)
    right_terms = normalized_terms(right)
    return bool(left_terms & right_terms) or "flexible" in left_terms | right_terms or "any" in left_terms | right_terms


def build_matches(data: dict[str, Any], user: dict[str, Any], payload: dict[str, Any] | None = None) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    query = matching_query(user, payload or {})
    results = []
    level_rank = {"beginner": 1, "intermediate": 2, "advanced": 3, "expert": 4, "all levels": 4}
    for candidate in data.get("users", []):
        if candidate["id"] == user["id"] or candidate.get("role") == "admin" or candidate.get("status") != "active":
            continue
        if not candidate.get("preferences", {}).get("match_visibility", True):
            continue
        profile = candidate.get("profile", {})
        candidate_teaches = list(profile.get("skills_to_teach") or [])
        candidate_learns = list(profile.get("skills_to_learn") or [])
        categories = {skill_category(skill) for skill in candidate_teaches}
        if query["category"] and query["category"].casefold() not in {category.casefold() for category in categories}:
            continue
        forward_fit, forward_pair = skill_similarity(query["learn_skills"], candidate_teaches)
        reciprocal_fit, reciprocal_pair = skill_similarity(query["teach_skills"], candidate_learns)
        if query["strict_skill_match"] and query["learn_skills"] and forward_fit < 0.25:
            continue

        reasons = []
        skill_points = round(forward_fit * 28 + reciprocal_fit * 7)
        if forward_pair:
            skill_detail = f"{profile.get('display_name', candidate['username'])} teaches {forward_pair['offered']}, close to your goal of {forward_pair['wanted']}."
        elif reciprocal_pair:
            skill_detail = f"They want to learn {reciprocal_pair['offered']}, which connects with what you teach."
        else:
            skill_detail = "No direct skill overlap yet; this is a discovery recommendation."
        reasons.append({"label": "Skill fit", "points": skill_points, "max_points": 35, "explanation": skill_detail})

        candidate_text = " ".join(candidate_teaches + [profile.get("headline", ""), profile.get("bio", "")])
        goal_terms = normalized_terms(query["learning_goal"])
        goal_overlap = len(goal_terms & normalized_terms(candidate_text)) / max(len(goal_terms), 1) if goal_terms else 0
        goal_points = min(10, round(4 + forward_fit * 4 + goal_overlap * 6)) if query["learning_goal"] else round(forward_fit * 7)
        reasons.append({"label": "Learning goal", "points": goal_points, "max_points": 10, "explanation": "Their profile and teaching skills support the outcome described in your learning goal." if goal_points >= 6 else "Add a more specific learning goal to improve this factor."})

        style_match = compatible_text(query["teaching_style"], profile.get("teaching_style", "Flexible"))
        style_points = 10 if style_match else 4
        reasons.append({"label": "Teaching style", "points": style_points, "max_points": 10, "explanation": f"You prefer {query['teaching_style']}; they teach with a {profile.get('teaching_style', 'flexible')} approach."})

        format_match = compatible_text(query["session_format"], profile.get("preferred_format", "Flexible"))
        format_points = 10 if format_match else 4
        reasons.append({"label": "Session format", "points": format_points, "max_points": 10, "explanation": f"Your preference is {query['session_format']}; theirs is {profile.get('preferred_format', 'Flexible')}."})

        availability = availability_compatibility(data, user, candidate, timezone_override=query["timezone"])
        overlap_minutes = availability["overlap_minutes_next_8_days"]
        availability_points = 15 if overlap_minutes >= 240 else 12 if overlap_minutes >= 120 else 8 if overlap_minutes > 0 else 0
        reasons.append({"label": "Schedule overlap", "points": availability_points, "max_points": 15, "explanation": f"{overlap_minutes} shared minutes found over the next eight days." if overlap_minutes else "No overlap is set yet; either member can update weekly availability."})

        viewer_languages = {item.casefold() for item in query["languages"] if item}
        candidate_languages = {str(profile.get("primary_language") or "").casefold(), *{str(item).casefold() for item in profile.get("additional_languages", [])}}
        common_languages = sorted(item for item in viewer_languages & candidate_languages if item)
        language_points = 8 if common_languages else 0
        reasons.append({"label": "Language", "points": language_points, "max_points": 8, "explanation": f"Shared language: {', '.join(item.title() for item in common_languages)}." if common_languages else "No shared profile language is currently listed."})

        desired_level = level_rank.get(query["proficiency"].casefold(), 2)
        teacher_level = level_rank.get(str(profile.get("experience_level") or "").casefold(), 2)
        proficiency_points = 5 if teacher_level >= desired_level else 3 if teacher_level + 1 >= desired_level else 1
        reasons.append({"label": "Proficiency", "points": proficiency_points, "max_points": 5, "explanation": f"Their listed level is {profile.get('experience_level', 'not specified')}; yours is {query['proficiency']}."})

        reputation = member_reputation(candidate, data)
        history_points = round((reputation["rating"] / 5) * 4) if reputation["review_count"] else 2
        reasons.append({"label": "Session history", "points": history_points, "max_points": 4, "explanation": f"{reputation['completed_sessions']} completed sessions and {reputation['review_count']} ratings." if reputation["review_count"] else "This member is building their first verified session history."})
        reliability_points = round(reputation["reliability_score"] / 100 * 3)
        reasons.append({"label": "Reliability", "points": reliability_points, "max_points": 3, "explanation": f"{reputation['reliability_score']}% reliability based on attendance and cancellations."})

        score = max(0, min(100, sum(int(reason["points"]) for reason in reasons)))
        top_reasons = [reason["explanation"] for reason in sorted(reasons, key=lambda item: item["points"] / max(item["max_points"], 1), reverse=True)[:3] if reason["points"]]
        results.append({
            "id": f"match_{user['id']}_{candidate['id']}",
            "score": score,
            "candidate": match_profile_preview(candidate, data),
            "availability": availability,
            "skill_match": {"learning": forward_pair, "reciprocal": reciprocal_pair},
            "reasons": reasons,
            "top_reasons": top_reasons,
        })
    results.sort(key=lambda item: (item["score"], item["candidate"]["reputation"]["reliability_score"]), reverse=True)
    return results[:20], query


def platform_skill_catalog(data: dict[str, Any]) -> list[str]:
    """Return skills that active, discoverable members currently offer to teach."""
    catalog: dict[str, str] = {}
    for user in data.get("users", []):
        preferences = user.get("preferences", {})
        if (
            user.get("role") == "admin" or user.get("status") != "active"
            or preferences.get("profile_visibility", "public") != "public"
            or preferences.get("match_visibility", True) is False
        ):
            continue
        for skill in user.get("profile", {}).get("skills_to_teach") or []:
            display = str(skill or "").strip()
            if display:
                catalog.setdefault(display.casefold(), display)
    return sorted(catalog.values(), key=str.casefold)


def platform_metrics(data: dict[str, Any]) -> dict[str, Any]:
    members = [user for user in data.get("users", []) if user.get("role") != "admin" and user.get("status") == "active"]
    available_skills = platform_skill_catalog(data)
    countries = {str(user.get("profile", {}).get("country") or "").strip() for user in members}
    countries.discard("")
    exchanged_minutes = 0
    for event in data.get("calendar_events", []):
        if event.get("status") not in {"completed", "scheduled"}:
            continue
        try:
            starts = parse_utc_timestamp(event.get("starts_at"))
            ends = parse_utc_timestamp(event.get("ends_at"))
            if starts and ends and (event.get("status") == "completed" or ends <= datetime.now(timezone.utc)):
                exchanged_minutes += max(0, int((ends - starts).total_seconds() // 60))
        except (TypeError, ValueError):
            continue
    return {
        "active_members": len(members),
        "skills": len(available_skills),
        "countries": len(countries),
        "hours_exchanged": round(exchanged_minutes / 60, 1),
        "updated_at": utc_now(),
    }


@app.get("/api/platform/metrics")
def get_platform_metrics():
    data = read_store()
    return jsonify({
        "ok": True,
        "metrics": platform_metrics(data),
        "skill_names": platform_skill_catalog(data),
    })


@app.post("/api/matches")
@login_required
def get_skill_matches(user, data):
    try:
        matches, query = build_matches(data, user, request.get_json(silent=True) or {})
    except ValueError as exc:
        return json_error(str(exc))
    return jsonify({
        "ok": True,
        "matches": matches,
        "query": query,
        "empty_state": None if matches else {
            "title": "No strong match found yet",
            "message": "Try a broader skill name, choose another category, or add more availability and languages to your profile.",
            "actions": ["Broaden the skill", "Update availability", "Add profile languages"],
        },
    })


@app.get("/api/dashboard")
@login_required
def member_dashboard(user, data):
    now = datetime.now(timezone.utc)
    upcoming = []
    for event in data.get("calendar_events", []):
        starts = parse_utc_timestamp(event.get("starts_at"))
        if event.get("status") == "scheduled" and starts and starts >= now and can_access_event(event, user):
            upcoming.append(event_view(event, data, user))
    upcoming.sort(key=lambda item: item.get("starts_at", ""))
    matches, _query = build_matches(data, user, {"strict_skill_match": False})
    pending_follow = [item for item in data.get("follow_requests", []) if item.get("target_id") == user["id"] and item.get("status") == "pending"]
    conversations = [
        conversation_view(item, data, user) for item in data.get("conversations", [])
        if conversation_member(item, user["id"])
    ]
    conversations.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    profile = user.get("profile", {})
    completeness_fields = ("headline", "bio", "learning_goal", "skills_to_teach", "skills_to_learn", "timezone", "primary_language", "teaching_style")
    profile_complete = sum(bool(profile.get(field)) for field in completeness_fields) / len(completeness_fields)
    completed_sessions = member_reputation(user, data)["completed_sessions"]
    goal_progress = min(100, round(profile_complete * 55 + min(completed_sessions, 9) / 9 * 45))
    if pending_follow:
        suggested_action = {"title": "Review your pending requests", "description": f"{len(pending_follow)} member request{'s are' if len(pending_follow) != 1 else ' is'} waiting in your Inbox.", "href": "notifications.html", "icon": "bx-user-check"}
    elif upcoming:
        suggested_action = {"title": "Prepare for your next session", "description": f"Review the details for {upcoming[0]['title']} and message the participants.", "href": "calendar.html", "icon": "bx-calendar-check"}
    elif matches:
        suggested_action = {"title": "Start with your strongest match", "description": f"{matches[0]['candidate']['display_name']} is currently your highest-scoring recommendation.", "href": "skill-matching.html", "icon": "bx-user-pin"}
    else:
        suggested_action = {"title": "Complete your matching profile", "description": "Add a learning goal, skills, languages, and weekly availability to unlock useful recommendations.", "href": "profile.html", "icon": "bx-edit-alt"}
    own_skills = list(profile.get("skills_to_teach") or []) + list(profile.get("skills_to_learn") or [])
    return jsonify({
        "ok": True,
        "user": safe_user(user),
        "metrics": platform_metrics(data),
        "summary": {
            "credit_balance": int(user.get("time_credits", 0)),
            "pending_requests": len(pending_follow),
            "unread_messages": sum(item.get("unread_count", 0) for item in conversations),
            "goal_progress": goal_progress,
        },
        "upcoming_sessions": upcoming[:5],
        "recommended_matches": matches[:4],
        "recent_messages": conversations[:5],
        "learning_goal": {
            "title": profile.get("learning_goal") or "Add your first learning goal",
            "progress": goal_progress,
            "completed_sessions": completed_sessions,
            "profile_completeness": round(profile_complete * 100),
        },
        "suggested_action": suggested_action,
        "skill_categories": sorted({skill_category(skill) for skill in own_skills}),
        "onboarding_complete": bool(user.get("preferences", {}).get("dashboard_onboarding_complete")),
    })


@app.post("/api/dashboard/onboarding")
@login_required
def complete_dashboard_onboarding(user, data):
    user.setdefault("preferences", {})["dashboard_onboarding_complete"] = True
    user["updated_at"] = utc_now()
    add_audit(data, user, "completed_dashboard_onboarding", user["id"], "Completed the member dashboard tour.")
    write_store(data)
    return jsonify({"ok": True, "onboarding_complete": True})


def process_due_reminders(data: dict[str, Any], user_id: str | None = None) -> int:
    now = datetime.now(timezone.utc)
    delivered = 0
    for event in data.get("calendar_events", []):
        if event.get("status") != "scheduled":
            continue
        try:
            starts = datetime.fromisoformat(event["starts_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
        except (KeyError, ValueError):
            continue
        if starts <= now:
            continue
        recipients = set(event.get("participant_ids", [])) | ({event.get("host_id")} if event.get("host_id") else set())
        if user_id:
            recipients &= {user_id}
        sent = event.setdefault("sent_reminders", [])
        for minutes in event.get("reminders_minutes", [60]):
            minutes = int(minutes)
            if not (now >= starts - timedelta(minutes=minutes)):
                continue
            for recipient in recipients:
                marker = f"{recipient}:{minutes}"
                if marker in sent or not find_user(data, recipient):
                    continue
                if minutes >= 1440:
                    timing = f"in {minutes // 1440} day"
                elif minutes >= 60:
                    timing = f"in {minutes // 60} hour"
                else:
                    timing = f"in {minutes} minutes"
                add_notification(
                    data, recipient, "calendar_reminder",
                    f"Reminder: {event.get('title', 'Your session')} starts {timing}.",
                    extra={"event_id": event.get("id")},
                )
                sent.append(marker)
                delivered += 1
    return delivered


def reminder_worker() -> None:
    """Deliver persistent SwapBot calendar reminders while the local server is running."""
    while True:
        threading.Event().wait(30)
        try:
            with STORE_LOCK:
                data = read_store()
                if process_due_reminders(data):
                    write_store(data)
        except (OSError, ValueError, json.JSONDecodeError):
            continue


def start_reminder_worker() -> None:
    global REMINDER_WORKER_STARTED
    if REMINDER_WORKER_STARTED:
        return
    REMINDER_WORKER_STARTED = True
    threading.Thread(target=reminder_worker, name="swaplabs-reminders", daemon=True).start()


def detect_message_attachment(payload: bytes, filename: str) -> tuple[str, str] | None:
    extension = Path(filename).suffix.lower()
    if payload.startswith(b"\xff\xd8\xff") and extension in {".jpg", ".jpeg"}:
        return ".jpg", "image/jpeg"
    if payload.startswith(b"\x89PNG\r\n\x1a\n") and extension == ".png":
        return ".png", "image/png"
    if len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP" and extension == ".webp":
        return ".webp", "image/webp"
    if payload.startswith(b"%PDF-") and extension == ".pdf":
        return ".pdf", "application/pdf"
    if extension in {".txt", ".md", ".csv"} and b"\x00" not in payload:
        try:
            payload.decode("utf-8")
            return extension, mimetypes.guess_type(filename)[0] or "text/plain"
        except UnicodeDecodeError:
            return None
    return None


def add_notification(
    data: dict[str, Any], user_id: str, notification_type: str, message: str,
    *, actor_id: str | None = None, extra: dict[str, Any] | None = None
) -> dict[str, Any]:
    notification = {
        "id": f"notification_{secrets.token_hex(8)}",
        "user_id": user_id,
        "actor_id": actor_id,
        "type": notification_type,
        "message": clean_text(message, "Notification", 300, required=True),
        "read": False,
        "created_at": utc_now(),
        "data": extra or {},
    }
    data.setdefault("notifications", []).insert(0, notification)
    data["notifications"] = data["notifications"][:5000]
    if notification_type not in BOT_NOTIFICATION_EXCLUSIONS:
        deliver_bot_message(
            data, user_id, notification["message"], message_type=notification_type,
            metadata={"notification_id": notification["id"], **(extra or {})},
        )
    return notification


def find_follow_request(data: dict[str, Any], request_id: str) -> dict[str, Any] | None:
    return next((item for item in data.get("follow_requests", []) if item["id"] == request_id), None)


def mark_follow_notification_read(data: dict[str, Any], user_id: str, request_id: str) -> None:
    for notification in data.get("notifications", []):
        if notification["user_id"] == user_id and notification.get("data", {}).get("request_id") == request_id:
            notification["read"] = True


@app.before_request
def protect_api_writes():
    if request.path.startswith("/api/") and request.method in {"POST", "PATCH", "PUT", "DELETE"}:
        expected = session.get("csrf_token")
        received = request.headers.get("X-CSRF-Token")
        if not expected or not received or not secrets.compare_digest(expected, received):
            return json_error("Security token missing or expired. Refresh and try again.", 403)
        STORE_LOCK.acquire()
        request.environ["swaplabs.store_lock"] = True


@app.teardown_request
def release_api_write_lock(_error):
    if request.environ.pop("swaplabs.store_lock", False):
        STORE_LOCK.release()


@app.after_request
def add_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = (
        "camera=(self), microphone=(self), display-capture=(self), geolocation=()"
    )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; "
        "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; "
        "img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
    )
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/auth/csrf")
def csrf_token():
    session.setdefault("csrf_token", secrets.token_urlsafe(24))
    return jsonify({"ok": True, "csrf_token": session["csrf_token"]})


@app.get("/api/auth/me")
def auth_me():
    session.setdefault("csrf_token", secrets.token_urlsafe(24))
    user, _ = current_session_user()
    if not user or user["status"] != "active":
        if user and user["status"] != "active":
            session.pop("user_id", None)
        payload = {"ok": True, "authenticated": False, "csrf_token": session["csrf_token"]}
        if user and user["status"] == "suspended":
            payload.update({
                "access_status": "suspended",
                "error": suspension_message(user),
                "suspended_until": user.get("suspended_until"),
            })
        return jsonify(payload)
    return jsonify({
        "ok": True,
        "authenticated": True,
        "user": safe_user(user),
        "csrf_token": session["csrf_token"],
    })


def login_rate_limited(key: str) -> bool:
    now = datetime.now(timezone.utc)
    attempts = LOGIN_ATTEMPTS[key]
    while attempts and now - attempts[0] > timedelta(minutes=10):
        attempts.popleft()
    if len(attempts) >= 12:
        return True
    attempts.append(now)
    return False


@app.post("/api/auth/login")
def auth_login():
    payload = request.get_json(silent=True) or {}
    try:
        mode = clean_text(payload.get("mode", "member"), "Login mode", 10).lower()
    except ValueError as exc:
        return json_error(str(exc))
    if mode not in {"member", "admin"}:
        return json_error("Login mode must be member or admin.")
    rate_key = f"{request.remote_addr}:{mode}"
    if login_rate_limited(rate_key):
        return json_error("Too many sign-in attempts. Please wait ten minutes.", 429)
    data = read_store()

    try:
        if mode == "admin":
            admin_id = clean_text(payload.get("admin_id"), "Administrator ID", 100, required=True)
            password = str(payload.get("password") or "")
            user = next((candidate for candidate in data["users"] if candidate["role"] == "admin"), None)
            valid = bool(
                user and user.get("admin_id_hash") and check_password_hash(user["admin_id_hash"], admin_id)
                and check_password_hash(user["password_hash"], password)
            )
        else:
            login = clean_text(payload.get("login"), "Username or email", 120, required=True).casefold()
            password = str(payload.get("password") or "")
            user = next((candidate for candidate in data["users"] if candidate["username"].casefold() == login or candidate["email"].casefold() == login), None)
            valid = bool(user and user["role"] != "admin" and check_password_hash(user["password_hash"], password))
    except ValueError as exc:
        return json_error(str(exc))

    if not valid:
        return json_error("The sign-in details are incorrect.", 401)
    if user["status"] != "active":
        return jsonify({
            "ok": False,
            "error": suspension_message(user),
            "access_status": "suspended",
            "suspended_until": user.get("suspended_until"),
        }), 403

    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["csrf_token"] = secrets.token_urlsafe(24)
    user["last_login_at"] = utc_now()
    user["updated_at"] = utc_now()
    add_audit(data, user, "signed_in", user["id"], f"Signed in through {mode} access.")
    write_store(data)
    LOGIN_ATTEMPTS.pop(rate_key, None)
    return jsonify({"ok": True, "user": safe_user(user), "csrf_token": session["csrf_token"]})


@app.post("/api/auth/register")
def auth_register():
    payload = request.get_json(silent=True) or {}
    if session.get("user_id"):
        return json_error("Sign out before creating another account.", 409)
    if payload.get("accepted_terms") is not True:
        return json_error("You must accept the Terms and Privacy Policy.")
    try:
        username = clean_text(payload.get("username"), "Username", 30, required=True)
        email = clean_text(payload.get("email"), "Email", 120, required=True).lower()
        password = str(payload.get("password") or "")
        if not USERNAME_RE.fullmatch(username):
            return json_error("Username must be 3–30 characters using letters, numbers, dots, dashes, or underscores.")
        if not EMAIL_RE.fullmatch(email):
            return json_error("Enter a valid email address.")
        issue = password_error(password)
        if issue:
            return json_error(issue)
        profile = validate_profile(payload)
        profile["avatar_url"] = ""
        preferences = validate_preferences(payload)
        safety = validate_safety(payload, profile, registration=True)
        if safety["is_minor"]:
            preferences["profile_visibility"] = "private"
            preferences["show_location"] = False
    except ValueError as exc:
        return json_error(str(exc))

    with STORE_LOCK:
        data = read_store()
        if any(user["username"].casefold() == username.casefold() for user in data["users"]):
            return json_error("That username is already in use.", 409)
        if any(user["email"].casefold() == email.casefold() for user in data["users"]):
            return json_error("That email is already registered.", 409)
        now = utc_now()
        user = {
            "id": f"usr_{secrets.token_hex(8)}",
            "role": "member",
            "status": "active",
            "username": username,
            "email": email,
            "password_hash": generate_password_hash(password),
            "admin_id_hash": None,
            "profile": profile,
            "preferences": preferences,
            "safety": safety,
            "reputation": {
                "rating": 0,
                "review_count": 0,
                "completed_sessions": 0,
                "reliability_score": 100,
            },
            "time_credits": 3,
            "verified": False,
            "moderation_label": "none",
            "admin_notes": "",
            "created_at": now,
            "updated_at": now,
            "last_login_at": now,
            "terms_accepted_at": now,
        }
        data["users"].append(user)
        ensure_operations_shape(data)
        add_notification(
            data, user["id"], "welcome",
            "Welcome to SwapLabs. Complete your profile photo, skills, and visibility settings to start connecting."
        )
        if safety["is_minor"]:
            add_notification(
                data, user["id"], "guardian_review_pending",
                "Your student account is private by default. Guardian consent and Innovation Lab submissions are reviewed by a safety specialist."
            )
        add_audit(data, user, "registered", user["id"], "Created a member account.")
        write_store(data)

    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["csrf_token"] = secrets.token_urlsafe(24)
    return jsonify({"ok": True, "user": safe_user(user), "csrf_token": session["csrf_token"]}), 201


@app.post("/api/auth/logout")
@login_required
def auth_logout(user, data):
    add_audit(data, user, "signed_out", user["id"], "Signed out of SwapLabs.")
    write_store(data)
    session.clear()
    return jsonify({"ok": True})


@app.patch("/api/profile")
@login_required
def update_profile(user, data):
    payload = request.get_json(silent=True) or {}
    try:
        profile = validate_profile(payload, user.get("profile"))
        preferences = validate_preferences(payload, user.get("preferences"))
        safety = validate_safety(payload, profile, user.get("safety"))
        if safety["is_minor"]:
            preferences["profile_visibility"] = "private"
            preferences["show_location"] = False
        user["profile"] = profile
        user["preferences"] = preferences
        user["safety"] = safety
    except ValueError as exc:
        return json_error(str(exc))
    user["updated_at"] = utc_now()
    add_audit(data, user, "updated_profile", user["id"], "Updated personal profile and account preferences.")
    write_store(data)
    return jsonify({"ok": True, "user": safe_user(user)})


@app.post("/api/profile/photo")
@login_required
def upload_profile_photo(user, data):
    upload = request.files.get("profile_photo")
    if not upload or not upload.filename:
        return json_error("Choose a JPG, PNG, or WebP profile image.")
    payload = upload.stream.read(4_000_001)
    if not payload:
        return json_error("The selected image is empty.")
    if len(payload) > 4_000_000:
        return json_error("Profile images must be 4 MB or smaller.", 413)
    image_type = detect_profile_image(payload)
    if not image_type:
        return json_error("Profile photos must be valid JPG, PNG, or WebP images.")
    extension, _mime_type = image_type
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    delete_profile_image(user)
    filename = f"{user['id']}.{extension}"
    target = UPLOAD_DIR / filename
    descriptor, temporary_name = tempfile.mkstemp(prefix="profile-", suffix=f".{extension}", dir=UPLOAD_DIR)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
        os.replace(temporary_name, target)
        try:
            target.chmod(0o600)
        except OSError:
            pass
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    user["profile"]["avatar_url"] = f"/uploads/{filename}"
    user["profile"]["avatar_updated_at"] = utc_now()
    user["updated_at"] = utc_now()
    add_audit(data, user, "updated_profile_photo", user["id"], "Uploaded a new profile photo.")
    write_store(data)
    return jsonify({"ok": True, "user": safe_user(user), "avatar_url": user["profile"]["avatar_url"]})


@app.delete("/api/profile/photo")
@login_required
def remove_profile_photo(user, data):
    delete_profile_image(user)
    user["profile"]["avatar_url"] = ""
    user["profile"].pop("avatar_updated_at", None)
    user["updated_at"] = utc_now()
    add_audit(data, user, "removed_profile_photo", user["id"], "Removed the profile photo.")
    write_store(data)
    return jsonify({"ok": True, "user": safe_user(user)})


@app.post("/api/profile/password")
@login_required
def update_password(user, data):
    payload = request.get_json(silent=True) or {}
    current_password = str(payload.get("current_password") or "")
    new_password = str(payload.get("new_password") or "")
    if not check_password_hash(user["password_hash"], current_password):
        return json_error("Current password is incorrect.", 401)
    issue = password_error(new_password)
    if issue:
        return json_error(issue)
    if check_password_hash(user["password_hash"], new_password):
        return json_error("Choose a password you have not already used here.")
    user["password_hash"] = generate_password_hash(new_password)
    user["updated_at"] = utc_now()
    add_audit(data, user, "changed_password", user["id"], "Changed account password.")
    write_store(data)
    return jsonify({"ok": True, "message": "Password updated."})


RETENTION_DAYS = {
    "30_days": 30, "90_days": 90, "365_days": 365, "730_days": 730, "forever": None,
}


def privacy_counts(data: dict[str, Any], user: dict[str, Any]) -> dict[str, int]:
    conversation_ids = {
        item["id"] for item in data.get("conversations", []) if conversation_member(item, user["id"])
    }
    event_ids = {
        item["id"] for item in data.get("calendar_events", []) if can_access_event(item, user)
    }
    return {
        "conversations": len(conversation_ids),
        "messages": sum(item.get("conversation_id") in conversation_ids for item in data.get("messages", [])),
        "calendar_events": len(event_ids),
        "video_attendance": sum(item.get("user_id") == user["id"] for item in data.get("video_attendance", [])),
        "ledger_entries": sum(item.get("user_id") == user["id"] for item in data.get("credit_ledger", [])),
        "ideas": sum(item.get("owner_id") == user["id"] for item in data.get("ideas", [])),
        "notifications": sum(item.get("user_id") == user["id"] for item in data.get("notifications", [])),
    }


def privacy_schedule(user: dict[str, Any]) -> dict[str, Any]:
    preferences = user.get("preferences", {})
    now = datetime.now(timezone.utc)

    def cutoff(choice: str) -> str | None:
        days = RETENTION_DAYS.get(choice)
        return (now - timedelta(days=days)).replace(microsecond=0).isoformat() if days else None

    general_days = {"standard": 365, "reduced": 180, "minimal": 90}.get(
        preferences.get("data_retention", "standard"), 365
    )
    return {
        "general_cleanup_before": (now - timedelta(days=general_days)).replace(microsecond=0).isoformat(),
        "messages_cleanup_before": cutoff(preferences.get("message_retention", "forever")),
        "session_history_cleanup_before": cutoff(preferences.get("session_history_retention", "forever")),
        "safety_and_ledger_records": "Retained or pseudonymized where required for safety, disputes, and the immutable credit ledger.",
    }


def account_export_payload(data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    conversation_ids = {
        item["id"] for item in data.get("conversations", []) if conversation_member(item, user["id"])
    }
    return {
        "exported_at": utc_now(),
        "account": safe_user(user),
        "follow_requests": [
            item for item in data.get("follow_requests", [])
            if user["id"] in {item.get("requester_id"), item.get("target_id")}
        ],
        "notifications": [item for item in data.get("notifications", []) if item.get("user_id") == user["id"]],
        "conversations": [item for item in data.get("conversations", []) if item.get("id") in conversation_ids],
        "messages": [item for item in data.get("messages", []) if item.get("conversation_id") in conversation_ids],
        "blocks": [
            item for item in data.get("user_blocks", [])
            if user["id"] in {item.get("blocker_id"), item.get("blocked_id")}
        ],
        "message_reports": [
            item for item in data.get("message_reports", [])
            if user["id"] in {item.get("reporter_id"), item.get("reported_user_id")}
        ],
        "calendar_events": [
            item for item in data.get("calendar_events", []) if can_access_event(item, user)
        ],
        "availability": [
            item for item in data.get("availability_rules", []) if item.get("user_id") == user["id"]
        ],
        "video_rooms": [
            item for item in data.get("video_rooms", []) if video_room_member(item, user["id"])
        ],
        "video_attendance": [
            item for item in data.get("video_attendance", []) if item.get("user_id") == user["id"]
        ],
        "credit_ledger": [
            item for item in data.get("credit_ledger", []) if item.get("user_id") == user["id"]
        ],
        "credit_disputes": [
            item for item in data.get("credit_disputes", [])
            if user["id"] in {item.get("user_id"), item.get("counterparty_id")}
        ],
        "ideas": [item for item in data.get("ideas", []) if item.get("owner_id") == user["id"]],
        "idea_comments": [
            {"idea_id": idea.get("id"), **comment}
            for idea in data.get("ideas", []) for comment in idea.get("comments", [])
            if comment.get("user_id") == user["id"]
        ],
        "workshop_registrations": [
            item for item in data.get("workshop_registrations", []) if item.get("user_id") == user["id"]
        ],
        "submissions": {
            collection: [item for item in data.get(collection, []) if item.get("user_id") == user["id"]]
            for collection in ("feedback", "contact_messages", "complaints")
        },
        "audit_activity": [
            item for item in data.get("audit_log", []) if item.get("actor_id") == user["id"]
        ],
    }


def remove_stored_attachment(message: dict[str, Any]) -> None:
    stored_name = (message.get("attachment") or {}).get("stored_name", "")
    if re.fullmatch(r"attachment_[A-Za-z0-9_-]+\.(?:jpg|png|webp|pdf|txt|md|csv)", stored_name):
        path = MESSAGE_UPLOAD_DIR / stored_name
        if path.is_file():
            path.unlink()


def apply_account_retention(data: dict[str, Any], user: dict[str, Any]) -> dict[str, int]:
    preferences = user.get("preferences", {})
    now = datetime.now(timezone.utc)
    removed = {"notifications": 0, "bot_messages": 0, "message_content": 0, "session_records": 0, "signals": 0}
    general_days = {"standard": 365, "reduced": 180, "minimal": 90}.get(
        preferences.get("data_retention", "standard"), 365
    )
    general_cutoff = now - timedelta(days=general_days)
    kept_notifications = []
    for item in data.get("notifications", []):
        created = parse_utc_timestamp(item.get("created_at")) or now
        if item.get("user_id") == user["id"] and item.get("read") and created < general_cutoff:
            removed["notifications"] += 1
        else:
            kept_notifications.append(item)
    data["notifications"] = kept_notifications

    message_days = RETENTION_DAYS.get(preferences.get("message_retention", "forever"))
    if message_days:
        cutoff = now - timedelta(days=message_days)
        bot_ids = {
            item["id"] for item in data.get("conversations", [])
            if item.get("kind") == "bot" and conversation_member(item, user["id"])
        }
        kept_messages = []
        for message in data.get("messages", []):
            created = parse_utc_timestamp(message.get("created_at")) or now
            if created >= cutoff:
                kept_messages.append(message)
            elif message.get("conversation_id") in bot_ids:
                remove_stored_attachment(message)
                removed["bot_messages"] += 1
            elif message.get("sender_id") == user["id"] and not message.get("metadata", {}).get("retention_removed"):
                remove_stored_attachment(message)
                message["body"] = "Message content removed under the sender's retention setting."
                message["attachment"] = None
                message["metadata"] = {**message.get("metadata", {}), "retention_removed": True}
                removed["message_content"] += 1
                kept_messages.append(message)
            else:
                kept_messages.append(message)
        data["messages"] = kept_messages

    session_days = RETENTION_DAYS.get(preferences.get("session_history_retention", "forever"))
    if session_days:
        cutoff = now - timedelta(days=session_days)
        kept_attendance = []
        for record in data.get("video_attendance", []):
            ended = parse_utc_timestamp(record.get("left_at") or record.get("updated_at")) or now
            if record.get("user_id") == user["id"] and ended < cutoff:
                removed["session_records"] += 1
            else:
                kept_attendance.append(record)
        data["video_attendance"] = kept_attendance

    signal_cutoff = now - timedelta(hours=24)
    kept_signals = []
    for signal in data.get("video_signals", []):
        created = parse_utc_timestamp(signal.get("created_at")) or now
        if user["id"] in {signal.get("from_id"), signal.get("target_id")} and created < signal_cutoff:
            removed["signals"] += 1
        else:
            kept_signals.append(signal)
    data["video_signals"] = kept_signals
    return removed


def purge_user_data(data: dict[str, Any], target: dict[str, Any]) -> None:
    user_id = target["id"]
    deleted_reference = f"deleted_{secrets.token_hex(8)}"
    delete_profile_image(target)
    conversation_ids = {
        item["id"] for item in data.get("conversations", []) if conversation_member(item, user_id)
    }
    for message in data.get("messages", []):
        if message.get("conversation_id") in conversation_ids:
            remove_stored_attachment(message)
    data["conversations"] = [item for item in data.get("conversations", []) if item.get("id") not in conversation_ids]
    data["messages"] = [item for item in data.get("messages", []) if item.get("conversation_id") not in conversation_ids]
    data["users"] = [item for item in data.get("users", []) if item.get("id") != user_id]
    data["follow_requests"] = [
        item for item in data.get("follow_requests", [])
        if user_id not in {item.get("requester_id"), item.get("target_id")}
    ]
    data["notifications"] = [
        item for item in data.get("notifications", [])
        if user_id not in {item.get("user_id"), item.get("actor_id")}
    ]
    data["user_blocks"] = [
        item for item in data.get("user_blocks", [])
        if user_id not in {item.get("blocker_id"), item.get("blocked_id")}
    ]
    data["availability_rules"] = [
        item for item in data.get("availability_rules", []) if item.get("user_id") != user_id
    ]
    for report in data.get("message_reports", []):
        for field in ("reporter_id", "reported_user_id"):
            if report.get(field) == user_id:
                report[field] = deleted_reference
    for event in data.get("calendar_events", []):
        event["participant_ids"] = [member_id for member_id in event.get("participant_ids", []) if member_id != user_id]
        if event.get("host_id") == user_id:
            event["host_id"] = None
            event["status"] = "cancelled"
            event["cancelled_at"] = utc_now()
    for room in data.get("video_rooms", []):
        room["participant_ids"] = [member_id for member_id in room.get("participant_ids", []) if member_id != user_id]
        if room.get("host_id") == user_id:
            room["host_id"] = None
            room["status"] = "closed"
            room["closed_at"] = utc_now()
    data["video_signals"] = [
        item for item in data.get("video_signals", [])
        if user_id not in {item.get("from_id"), item.get("target_id")}
    ]
    data["video_attendance"] = [
        item for item in data.get("video_attendance", []) if item.get("user_id") != user_id
    ]
    data["ideas"] = [item for item in data.get("ideas", []) if item.get("owner_id") != user_id]
    for idea in data.get("ideas", []):
        idea["liked_by"] = [member_id for member_id in idea.get("liked_by", []) if member_id != user_id]
        idea["saved_by"] = [member_id for member_id in idea.get("saved_by", []) if member_id != user_id]
        idea["comments"] = [comment for comment in idea.get("comments", []) if comment.get("user_id") != user_id]
    data["workshop_registrations"] = [
        item for item in data.get("workshop_registrations", []) if item.get("user_id") != user_id
    ]
    for collection in ("feedback", "contact_messages", "complaints"):
        data[collection] = [item for item in data.get(collection, []) if item.get("user_id") != user_id]
    for entry in data.get("credit_ledger", []):
        for field in ("user_id", "counterparty_id", "created_by"):
            if entry.get(field) == user_id:
                entry[field] = deleted_reference
    for dispute in data.get("credit_disputes", []):
        for field in ("user_id", "counterparty_id"):
            if dispute.get(field) == user_id:
                dispute[field] = deleted_reference
    for audit in data.get("audit_log", []):
        if audit.get("actor_id") == user_id:
            audit["actor_id"] = deleted_reference
            audit["actor_name"] = "Deleted member"
        if audit.get("target_id") == user_id:
            audit["target_id"] = deleted_reference


@app.get("/api/account/privacy")
@login_required
def account_privacy(user, data):
    return jsonify({
        "ok": True,
        "preferences": {
            key: user.get("preferences", {}).get(key)
            for key in ("data_retention", "message_retention", "session_history_retention", "allow_research_analytics")
        },
        "schedule": privacy_schedule(user),
        "counts": privacy_counts(data, user),
        "safety": user.get("safety", {}),
    })


@app.patch("/api/account/privacy")
@login_required
def update_account_privacy(user, data):
    payload = request.get_json(silent=True) or {}
    supported = {"data_retention", "message_retention", "session_history_retention", "allow_research_analytics"}
    source = {key: value for key, value in payload.items() if key in supported}
    if not source:
        return json_error("No supported privacy controls were supplied.")
    try:
        user["preferences"] = validate_preferences(
            {"preferences": source}, user.get("preferences")
        )
    except ValueError as exc:
        return json_error(str(exc))
    user["updated_at"] = utc_now()
    add_audit(data, user, "updated_privacy_controls", user["id"], "Updated account retention and analytics choices.")
    write_store(data)
    return jsonify({"ok": True, "preferences": user["preferences"], "schedule": privacy_schedule(user)})


@app.post("/api/account/privacy/cleanup")
@login_required
def cleanup_account_data(user, data):
    removed = apply_account_retention(data, user)
    add_audit(data, user, "applied_retention_cleanup", user["id"], f"Applied privacy cleanup: {removed}.")
    write_store(data)
    return jsonify({"ok": True, "removed": removed, "counts": privacy_counts(data, user)})


@app.get("/api/account/export")
@login_required
def export_account_data(user, data):
    content = json.dumps(account_export_payload(data, user), indent=2, ensure_ascii=False)
    filename = f"swaplabs-{re.sub(r'[^A-Za-z0-9_-]', '-', user['username'])}-data.json"
    add_audit(data, user, "exported_account_data", user["id"], "Downloaded a complete account data export.")
    write_store(data)
    return Response(
        content + "\n", mimetype="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/account/session-history.csv")
@login_required
def export_session_history(user, data):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "event_id", "title", "status", "starts_at", "ends_at", "timezone", "role",
        "room_id", "attendance_state", "joined_at", "left_at", "duration_minutes",
        "member_confirmed", "host_confirmed", "confirmation_complete",
    ])
    for event in sorted(
        (item for item in data.get("calendar_events", []) if can_access_event(item, user)),
        key=lambda item: item.get("starts_at", ""), reverse=True,
    ):
        room = next((item for item in data.get("video_rooms", []) if item.get("event_id") == event["id"]), None)
        attendance = find_video_attendance(data, room["id"], user["id"]) if room else None
        writer.writerow([
            event["id"], event.get("title"), event.get("status"), event.get("starts_at"), event.get("ends_at"),
            event.get("timezone"), "host" if event.get("host_id") == user["id"] else "participant",
            room.get("id") if room else "", attendance.get("state") if attendance else "not_recorded",
            attendance.get("joined_at") if attendance else "", attendance.get("left_at") if attendance else "",
            round(attendance_duration(attendance) / 60, 2) if attendance else 0,
            bool(attendance and attendance.get("participant_confirmed")),
            bool(attendance and attendance.get("host_confirmed")),
            bool(attendance and attendance.get("participant_confirmed") and attendance.get("host_confirmed")),
        ])
    add_audit(data, user, "exported_session_history", user["id"], "Downloaded session history as CSV.")
    write_store(data)
    return Response(
        output.getvalue(), mimetype="text/csv",
        headers={"Content-Disposition": 'attachment; filename="swaplabs-session-history.csv"'},
    )


@app.delete("/api/account")
@login_required
def delete_own_account(user, data):
    if user.get("role") == "admin":
        return json_error("The primary administrator account cannot be deleted here.", 403)
    payload = request.get_json(silent=True) or {}
    if not check_password_hash(user["password_hash"], str(payload.get("password") or "")):
        return json_error("Password is incorrect.", 401)
    expected = f"DELETE {user['username']}"
    if str(payload.get("confirmation") or "").strip() != expected:
        return json_error(f"Type {expected} exactly to confirm account deletion.")
    name = user.get("profile", {}).get("display_name", user["username"])
    add_audit(data, user, "requested_account_deletion", user["id"], "Confirmed permanent self-service account deletion.")
    purge_user_data(data, user)
    write_store(data)
    session.clear()
    return jsonify({"ok": True, "message": f"{name}'s SwapLabs account and personal profile were deleted."})


@app.get("/api/members")
@login_required
def member_directory(user, data):
    members = [
        community_member(candidate, user, data) for candidate in data["users"]
        if candidate["status"] == "active" and candidate.get("preferences", {}).get("match_visibility", True)
    ]
    return jsonify({"ok": True, "members": members, "viewer_role": user["role"]})


@app.get("/api/community")
def community_directory():
    viewer, data = current_session_user()
    if viewer and viewer.get("status") != "active":
        viewer = None
    users = [
        community_member(candidate, viewer, data)
        for candidate in data["users"] if candidate["status"] == "active"
    ]
    return jsonify({
        "ok": True,
        "authenticated": bool(viewer),
        "viewer_id": viewer["id"] if viewer else None,
        "users": users,
        "stats": {
            "total": len(users),
            "public": sum(item["visibility"] == "public" for item in users),
            "private": sum(item["visibility"] == "private" for item in users),
            "countries": len({item["profile"].get("country") for item in users if item["profile"].get("country") not in {None, "", "Private"}}),
        },
    })


@app.get("/api/community/users/<user_id>")
def community_profile(user_id: str):
    viewer, data = current_session_user()
    target = find_user(data, user_id)
    if not target or target["status"] != "active":
        return json_error("Community profile not found.", 404)
    return jsonify({"ok": True, "user": community_member(target, viewer, data), "authenticated": bool(viewer)})


@app.post("/api/community/users/<user_id>/follow")
@login_required
def request_follow(user, data, user_id: str):
    target = find_user(data, user_id)
    if not target or target["status"] != "active":
        return json_error("Community profile not found.", 404)
    if target["id"] == user["id"]:
        return json_error("You cannot follow your own profile.")
    existing = active_follow(data, user["id"], target["id"])
    if existing:
        message = "You already follow this member." if existing["status"] == "accepted" else "Your follow request is already pending."
        return json_error(message, 409)
    automatic = (
        target.get("preferences", {}).get("profile_visibility", "public") == "public"
        and not target.get("safety", {}).get("is_minor")
    )
    follow = {
        "id": f"follow_{secrets.token_hex(8)}",
        "requester_id": user["id"],
        "target_id": target["id"],
        "status": "accepted" if automatic else "pending",
        "created_at": utc_now(),
        "responded_at": utc_now() if automatic else None,
    }
    data.setdefault("follow_requests", []).append(follow)
    requester_name = user["profile"]["display_name"]
    if automatic:
        add_notification(
            data, target["id"], "new_follower", f"{requester_name} started following you.",
            actor_id=user["id"], extra={"request_id": follow["id"]}
        )
        action = "followed_member"
        message = f"You are now following {target['profile']['display_name']}."
    else:
        add_notification(
            data, target["id"], "follow_request", f"{requester_name} sent you a follow request.",
            actor_id=user["id"], extra={"request_id": follow["id"]}
        )
        action = "requested_private_follow"
        message = f"Follow request sent to {target['profile']['display_name']}."
    add_audit(data, user, action, target["id"], message)
    write_store(data)
    return jsonify({
        "ok": True, "message": message,
        "relationship": "following" if automatic else "requested",
        "user": community_member(target, user, data),
    }), 201


@app.delete("/api/community/users/<user_id>/follow")
@login_required
def remove_follow(user, data, user_id: str):
    target = find_user(data, user_id)
    if not target:
        return json_error("Community profile not found.", 404)
    existing = active_follow(data, user["id"], target["id"])
    if not existing:
        return json_error("There is no active follow or request to remove.", 404)
    previous_status = existing["status"]
    existing["status"] = "cancelled"
    existing["responded_at"] = utc_now()
    mark_follow_notification_read(data, target["id"], existing["id"])
    action = "unfollowed_member" if previous_status == "accepted" else "cancelled_follow_request"
    message = f"You are no longer following {target['profile']['display_name']}." if previous_status == "accepted" else f"Follow request to {target['profile']['display_name']} was cancelled."
    add_audit(data, user, action, target["id"], message)
    write_store(data)
    return jsonify({"ok": True, "message": message, "relationship": "none", "user": community_member(target, user, data)})


@app.get("/api/notifications")
@login_required
def notification_center(user, data):
    incoming = []
    for follow in data.get("follow_requests", []):
        if follow["target_id"] == user["id"] and follow["status"] == "pending":
            requester = find_user(data, follow["requester_id"])
            if requester and requester["status"] == "active":
                incoming.append({
                    **follow,
                    "requester": community_member(requester, user, data),
                })
    notifications = []
    for item in data.get("notifications", []):
        if item["user_id"] != user["id"]:
            continue
        actor = find_user(data, item.get("actor_id")) if item.get("actor_id") else None
        notifications.append({
            **item,
            "actor": community_member(actor, user, data) if actor and actor["status"] == "active" else None,
        })
    inbox_unread = sum(
        user["id"] not in item.get("read_by", []) and item.get("sender_id") != user["id"]
        and bool(find_conversation(data, item.get("conversation_id", "")))
        and conversation_member(find_conversation(data, item.get("conversation_id", "")), user["id"])
        for item in data.get("messages", [])
    )
    return jsonify({
        "ok": True,
        "incoming_requests": incoming,
        "notifications": notifications[:100],
        "unread_count": sum(not item.get("read", False) for item in notifications),
        "pending_count": len(incoming),
        "inbox_unread_count": inbox_unread,
    })


@app.post("/api/notifications/follow-requests/<request_id>/accept")
@login_required
def accept_follow_request(user, data, request_id: str):
    follow = find_follow_request(data, request_id)
    if not follow or follow["target_id"] != user["id"] or follow["status"] != "pending":
        return json_error("Pending follow request not found.", 404)
    requester = find_user(data, follow["requester_id"])
    if not requester or requester["status"] != "active":
        follow["status"] = "declined"
        follow["responded_at"] = utc_now()
        write_store(data)
        return json_error("The requesting account is no longer available.", 410)
    follow["status"] = "accepted"
    follow["responded_at"] = utc_now()
    mark_follow_notification_read(data, user["id"], request_id)
    add_notification(
        data, requester["id"], "follow_accepted",
        f"{user['profile']['display_name']} accepted your follow request.",
        actor_id=user["id"], extra={"request_id": request_id}
    )
    add_audit(data, user, "accepted_follow_request", requester["id"], f"Accepted {requester['profile']['display_name']}'s follow request.")
    write_store(data)
    return jsonify({"ok": True, "message": f"{requester['profile']['display_name']} can now view your full profile."})


@app.delete("/api/notifications/follow-requests/<request_id>")
@login_required
def decline_follow_request(user, data, request_id: str):
    follow = find_follow_request(data, request_id)
    if not follow or follow["target_id"] != user["id"] or follow["status"] != "pending":
        return json_error("Pending follow request not found.", 404)
    requester = find_user(data, follow["requester_id"])
    follow["status"] = "declined"
    follow["responded_at"] = utc_now()
    mark_follow_notification_read(data, user["id"], request_id)
    if requester:
        add_notification(
            data, requester["id"], "follow_declined",
            f"{user['profile']['display_name']} declined your follow request.",
            actor_id=user["id"], extra={"request_id": request_id}
        )
    add_audit(data, user, "declined_follow_request", follow["requester_id"], "Declined a private-profile follow request.")
    write_store(data)
    return jsonify({"ok": True, "message": "Follow request deleted."})


@app.patch("/api/notifications/<notification_id>/read")
@login_required
def mark_notification_read(user, data, notification_id: str):
    item = next((entry for entry in data.get("notifications", []) if entry["id"] == notification_id and entry["user_id"] == user["id"]), None)
    if not item:
        return json_error("Notification not found.", 404)
    item["read"] = True
    write_store(data)
    return jsonify({"ok": True})


@app.post("/api/notifications/read-all")
@login_required
def mark_all_notifications_read(user, data):
    updated = 0
    for item in data.get("notifications", []):
        if item["user_id"] == user["id"] and not item.get("read", False):
            item["read"] = True
            updated += 1
    write_store(data)
    return jsonify({"ok": True, "updated": updated})


def message_view(message: dict[str, Any], data: dict[str, Any], viewer: dict[str, Any]) -> dict[str, Any]:
    sender = find_user(data, message.get("sender_id")) if message.get("sender_id") else None
    result = {
        **message,
        "sender": public_member_card(sender) if sender else None,
        "attachment": dict(message["attachment"]) if message.get("attachment") else None,
    }
    if result.get("attachment"):
        result["attachment"]["url"] = f"/message-attachments/{result['attachment']['id']}"
        result["attachment"].pop("stored_name", None)
    if message.get("moderation_status") == "removed" and viewer.get("role") != "admin":
        result["body"] = "This message was removed by a SwapLabs moderator."
        result["attachment"] = None
        result.pop("original_body", None)
    return result


def conversation_view(conversation: dict[str, Any], data: dict[str, Any], viewer: dict[str, Any]) -> dict[str, Any]:
    messages = [item for item in data.get("messages", []) if item.get("conversation_id") == conversation["id"]]
    messages.sort(key=lambda item: item.get("created_at", ""))
    latest = messages[-1] if messages else None
    others = [find_user(data, member_id) for member_id in conversation.get("participant_ids", []) if member_id != viewer["id"]]
    others = [member for member in others if member]
    if conversation.get("kind") == "bot":
        title = "SwapBot"
        subtitle = "Platform assistant and account updates"
    elif conversation.get("kind") == "meeting":
        title = conversation.get("title") or "SwapLabs meeting"
        attendee_total = len(conversation.get("participant_ids", []))
        subtitle = f"Meeting thread · {attendee_total} member{'s' if attendee_total != 1 else ''}"
    else:
        title = ", ".join(member["profile"].get("display_name", member["username"]) for member in others) or "Conversation"
        subtitle = ", ".join(f"@{member['username']}" for member in others)
    unread = sum(
        viewer["id"] not in item.get("read_by", []) and item.get("sender_id") != viewer["id"]
        for item in messages
    )
    result = {
        **conversation,
        "title": title,
        "subtitle": subtitle,
        "members": [public_member_card(member) for member in others],
        "latest_message": message_view(latest, data, viewer) if latest else None,
        "unread_count": unread,
        "muted": viewer["id"] in conversation.get("muted_by", []),
        "blocked": any(users_blocked(data, viewer["id"], member["id"]) for member in others),
    }
    if conversation.get("kind") == "meeting":
        meeting_event = next((
            event for event in data.get("calendar_events", [])
            if event.get("id") == conversation.get("event_id") and can_access_event(event, viewer)
        ), None)
        result["event"] = event_view(meeting_event, data, viewer) if meeting_event else None
    return result


@app.get("/api/inbox")
@login_required
def inbox_overview(user, data):
    ensure_bot_conversation(data, user["id"])
    conversations = [
        conversation_view(item, data, user) for item in data.get("conversations", [])
        if conversation_member(item, user["id"])
    ]
    conversations.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
    contacts = [
        public_member_card(member) for member in data.get("users", [])
        if member["id"] != user["id"] and member.get("status") == "active"
    ]
    contacts.sort(key=lambda item: item["display_name"].casefold())
    incoming = []
    for follow in data.get("follow_requests", []):
        if follow.get("target_id") != user["id"] or follow.get("status") != "pending":
            continue
        requester = find_user(data, follow.get("requester_id"))
        if requester and requester.get("status") == "active":
            incoming.append({**follow, "requester": public_member_card(requester)})
    return jsonify({
        "ok": True,
        "conversations": conversations,
        "contacts": contacts,
        "incoming_requests": incoming,
        "blocks": [item for item in data.get("user_blocks", []) if item.get("blocker_id") == user["id"]],
        "unread_count": sum(item["unread_count"] for item in conversations),
    })


@app.post("/api/inbox/conversations")
@login_required
def create_conversation(user, data):
    payload = request.get_json(silent=True) or {}
    target_id = clean_text(payload.get("target_user_id"), "Member", 80, required=True)
    target = find_user(data, target_id)
    if not target or target.get("status") != "active":
        return json_error("That member is not available.", 404)
    if target["id"] == user["id"]:
        return json_error("Choose another member to start a conversation.")
    if users_blocked(data, user["id"], target["id"]):
        return json_error("This conversation is unavailable because one member has blocked the other.", 403)
    if not minor_messaging_allowed(data, user, target):
        return json_error(
            "Student safety settings allow messages only after an accepted follow connection.", 403
        )
    member_ids = {user["id"], target["id"]}
    existing = next((
        item for item in data.get("conversations", [])
        if item.get("kind") == "direct" and set(item.get("participant_ids", [])) == member_ids
    ), None)
    if existing:
        return jsonify({"ok": True, "conversation": conversation_view(existing, data, user)})
    now = utc_now()
    conversation = {
        "id": f"conversation_{secrets.token_hex(9)}", "kind": "direct",
        "participant_ids": [user["id"], target["id"]], "created_by": user["id"],
        "muted_by": [], "created_at": now, "updated_at": now,
    }
    data.setdefault("conversations", []).append(conversation)
    append_message(
        data, conversation,
        f"Conversation started by {user['profile']['display_name']}.",
        sender_kind="system", metadata={"type": "conversation_started"},
    )
    add_audit(data, user, "started_conversation", target["id"], f"Started a member conversation with {target['profile']['display_name']}.")
    write_store(data)
    return jsonify({"ok": True, "conversation": conversation_view(conversation, data, user)}), 201


@app.get("/api/inbox/conversations/<conversation_id>")
@login_required
def get_conversation(user, data, conversation_id: str):
    conversation = find_conversation(data, conversation_id)
    if not conversation or (not conversation_member(conversation, user["id"]) and user.get("role") != "admin"):
        return json_error("Conversation not found.", 404)
    now = datetime.now(timezone.utc)
    typing_users = []
    for (active_conversation, member_id), expires in list(TYPING_STATES.items()):
        if expires <= now:
            TYPING_STATES.pop((active_conversation, member_id), None)
        elif active_conversation == conversation_id and member_id != user["id"]:
            member = find_user(data, member_id)
            if member:
                typing_users.append(public_member_card(member))
    messages = [
        message_view(item, data, user) for item in data.get("messages", [])
        if item.get("conversation_id") == conversation_id
    ]
    messages.sort(key=lambda item: item.get("created_at", ""))
    return jsonify({
        "ok": True, "conversation": conversation_view(conversation, data, user),
        "messages": messages[-500:], "typing_users": typing_users,
    })


@app.post("/api/inbox/conversations/<conversation_id>/messages")
@login_required
def send_conversation_message(user, data, conversation_id: str):
    conversation = find_conversation(data, conversation_id)
    if not conversation or not conversation_member(conversation, user["id"]):
        return json_error("Conversation not found.", 404)
    if user.get("messaging_restricted"):
        return json_error("Messaging is restricted while an administrator reviews this account.", 403)
    others = [member_id for member_id in conversation.get("participant_ids", []) if member_id != user["id"]]
    if any(users_blocked(data, user["id"], member_id) for member_id in others):
        return json_error("Messages cannot be sent because one member has blocked the other.", 403)
    for member_id in others:
        other_member = find_user(data, member_id)
        if other_member and not minor_messaging_allowed(data, user, other_member):
            return json_error(
                "Student safety settings allow messages only between accepted connections.", 403
            )
    payload = request.form if request.content_type and request.content_type.startswith("multipart/form-data") else (request.get_json(silent=True) or {})
    try:
        body = clean_text(payload.get("body"), "Message", 4000)
    except ValueError as exc:
        return json_error(str(exc))
    attachment = None
    uploaded = request.files.get("attachment")
    if uploaded and uploaded.filename:
        raw = uploaded.read()
        if not raw or len(raw) > 4_000_000:
            return json_error("Attachments must be between 1 byte and 4 MB.")
        detected = detect_message_attachment(raw, uploaded.filename)
        if not detected:
            return json_error("Attach a JPG, PNG, WebP, PDF, TXT, Markdown, or CSV file.")
        extension, mime_type = detected
        attachment_id = f"attachment_{secrets.token_hex(10)}"
        stored_name = f"{attachment_id}{extension}"
        MESSAGE_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        (MESSAGE_UPLOAD_DIR / stored_name).write_bytes(raw)
        attachment = {
            "id": attachment_id, "name": Path(uploaded.filename).name[:180],
            "mime": mime_type, "size": len(raw), "stored_name": stored_name,
        }
    if not body and not attachment:
        return json_error("Write a message or attach a file.")
    message = append_message(data, conversation, body, sender_id=user["id"], attachment=attachment)
    TYPING_STATES.pop((conversation_id, user["id"]), None)
    replies = []
    if conversation.get("kind") == "bot":
        replies.append(append_message(data, conversation, bot_reply_for(body or "attachment"), sender_kind="bot", metadata={"type": "assistant_reply"}))
    else:
        for recipient_id in others:
            if recipient_id not in conversation.get("muted_by", []):
                add_notification(
                    data, recipient_id, "new_message",
                    f"{user['profile']['display_name']} sent you a new message. Open their conversation to read it.",
                    actor_id=user["id"],
                    extra={"conversation_id": conversation_id, "message_id": message["id"]},
                )
    add_audit(data, user, "sent_message", conversation_id, "Sent a message in a member conversation." if conversation.get("kind") != "bot" else "Asked SwapBot for help.")
    write_store(data)
    return jsonify({
        "ok": True, "message": message_view(message, data, user),
        "replies": [message_view(item, data, user) for item in replies],
    }), 201


@app.post("/api/inbox/conversations/<conversation_id>/read")
@login_required
def read_conversation(user, data, conversation_id: str):
    conversation = find_conversation(data, conversation_id)
    if not conversation or not conversation_member(conversation, user["id"]):
        return json_error("Conversation not found.", 404)
    updated = 0
    for message in data.get("messages", []):
        if message.get("conversation_id") == conversation_id and user["id"] not in message.setdefault("read_by", []):
            message["read_by"].append(user["id"])
            updated += 1
    if conversation.get("kind") == "bot":
        for notification in data.get("notifications", []):
            if notification.get("user_id") == user["id"]:
                notification["read"] = True
    write_store(data)
    return jsonify({"ok": True, "updated": updated})


@app.post("/api/inbox/conversations/<conversation_id>/typing")
@login_required
def set_typing_state(user, data, conversation_id: str):
    conversation = find_conversation(data, conversation_id)
    if not conversation or not conversation_member(conversation, user["id"]):
        return json_error("Conversation not found.", 404)
    typing = bool((request.get_json(silent=True) or {}).get("typing"))
    key = (conversation_id, user["id"])
    if typing:
        TYPING_STATES[key] = datetime.now(timezone.utc) + timedelta(seconds=7)
    else:
        TYPING_STATES.pop(key, None)
    return jsonify({"ok": True, "typing": typing})


@app.post("/api/inbox/conversations/<conversation_id>/mute")
@login_required
def mute_conversation(user, data, conversation_id: str):
    conversation = find_conversation(data, conversation_id)
    if not conversation or not conversation_member(conversation, user["id"]):
        return json_error("Conversation not found.", 404)
    payload = request.get_json(silent=True) or {}
    muted = bool(payload.get("muted", user["id"] not in conversation.setdefault("muted_by", [])))
    muted_by = conversation.setdefault("muted_by", [])
    if muted and user["id"] not in muted_by:
        muted_by.append(user["id"])
    if not muted and user["id"] in muted_by:
        muted_by.remove(user["id"])
    write_store(data)
    return jsonify({"ok": True, "muted": muted})


@app.post("/api/inbox/users/<target_id>/block")
@login_required
def block_member(user, data, target_id: str):
    target = find_user(data, target_id)
    if not target or target["id"] == user["id"]:
        return json_error("That member cannot be blocked.", 404)
    existing = next((item for item in data.get("user_blocks", []) if item.get("blocker_id") == user["id"] and item.get("blocked_id") == target_id), None)
    if not existing:
        existing = {"id": f"block_{secrets.token_hex(8)}", "blocker_id": user["id"], "blocked_id": target_id, "created_at": utc_now()}
        data.setdefault("user_blocks", []).append(existing)
        add_audit(data, user, "blocked_member", target_id, f"Blocked {target['profile']['display_name']} from direct messaging.")
        write_store(data)
    return jsonify({"ok": True, "blocked": True})


@app.delete("/api/inbox/users/<target_id>/block")
@login_required
def unblock_member(user, data, target_id: str):
    before = len(data.get("user_blocks", []))
    data["user_blocks"] = [
        item for item in data.get("user_blocks", [])
        if not (item.get("blocker_id") == user["id"] and item.get("blocked_id") == target_id)
    ]
    if len(data["user_blocks"]) == before:
        return json_error("This member is not blocked.", 404)
    add_audit(data, user, "unblocked_member", target_id, "Restored direct messaging access for a member.")
    write_store(data)
    return jsonify({"ok": True, "blocked": False})


@app.post("/api/inbox/reports")
@login_required
def report_message_activity(user, data):
    payload = request.get_json(silent=True) or {}
    conversation_id = clean_text(payload.get("conversation_id"), "Conversation", 100, required=True)
    reported_user_id = clean_text(payload.get("reported_user_id"), "Reported member", 100, required=True)
    conversation = find_conversation(data, conversation_id)
    reported = find_user(data, reported_user_id)
    if not conversation or not conversation_member(conversation, user["id"]):
        return json_error("Conversation not found.", 404)
    if not reported or reported_user_id == user["id"] or not conversation_member(conversation, reported_user_id):
        return json_error("Reported member is not part of this conversation.")
    try:
        category = clean_text(payload.get("category"), "Category", 50, required=True).lower()
        details = clean_text(payload.get("details"), "Report details", 2000, required=True)
        message_id = clean_text(payload.get("message_id"), "Message", 100)
    except ValueError as exc:
        return json_error(str(exc))
    if category not in {"harassment", "spam", "unsafe_content", "fraud", "privacy", "other"}:
        return json_error("Choose a valid report category.")
    reported_message = next((item for item in data.get("messages", []) if item.get("id") == message_id and item.get("conversation_id") == conversation_id), None) if message_id else None
    if message_id and (not reported_message or reported_message.get("sender_id") != reported_user_id):
        return json_error("The selected message cannot be reported.")
    now = utc_now()
    report = {
        "id": f"report_{secrets.token_hex(9)}", "reporter_id": user["id"],
        "reported_user_id": reported_user_id, "conversation_id": conversation_id,
        "message_id": message_id or None, "category": category, "details": details,
        "status": "open", "admin_notes": "", "action": "pending",
        "evidence_message_ids": [
            item["id"] for item in data.get("messages", [])
            if item.get("conversation_id") == conversation_id
        ][-200:],
        "evidence_captured_at": now,
        "created_at": now, "updated_at": now,
    }
    data.setdefault("message_reports", []).append(report)
    for admin in data.get("users", []):
        if admin.get("role") == "admin" and admin.get("status") == "active":
            add_notification(
                data, admin["id"], "moderation_report",
                f"New {category.replace('_', ' ')} report concerning {reported['profile']['display_name']}.",
                actor_id=user["id"], extra={"report_id": report["id"], "conversation_id": conversation_id},
            )
    add_audit(data, user, "reported_message_activity", reported_user_id, f"Submitted report {report['id']} for administrator review.")
    write_store(data)
    return jsonify({"ok": True, "message": "Your report is securely queued for administrator review.", "report": report}), 201


CALENDAR_DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")


def can_access_event(event: dict[str, Any], user: dict[str, Any]) -> bool:
    return bool(
        user.get("role") == "admin" or user["id"] == event.get("host_id")
        or user["id"] == event.get("created_by") or user["id"] in event.get("participant_ids", [])
    )


def normalize_reminders(value: Any) -> list[int]:
    source = value if isinstance(value, list) else [60]
    reminders = []
    for item in source:
        try:
            minutes = int(item)
        except (TypeError, ValueError):
            continue
        if 0 <= minutes <= 10080 and minutes not in reminders:
            reminders.append(minutes)
    return sorted(reminders, reverse=True)[:5] or [60]


def validate_event_payload(payload: dict[str, Any], data: dict[str, Any], user: dict[str, Any], existing: dict[str, Any] | None = None) -> dict[str, Any]:
    result = dict(existing or {})
    zone_name = clean_text(payload.get("timezone", result.get("timezone") or user.get("profile", {}).get("timezone") or "UTC"), "Timezone", 80, required=True)
    try:
        ZoneInfo(zone_name)
    except ZoneInfoNotFoundError:
        raise ValueError("Choose a valid IANA timezone.") from None
    result["timezone"] = zone_name
    for field, maximum, required in (
        ("title", 160, True), ("description", 2000, False), ("location", 180, False), ("meeting_url", 400, False),
    ):
        if field in payload or not existing:
            result[field] = clean_text(payload.get(field), field.replace("_", " ").title(), maximum, required=required)
    if result.get("meeting_url") and not re.match(r"^https?://", result["meeting_url"], re.I):
        raise ValueError("Meeting URL must begin with http:// or https://.")
    if "starts_at" in payload or not existing:
        result["starts_at"] = parse_local_datetime(payload.get("starts_at"), zone_name).isoformat()
    if "ends_at" in payload or not existing:
        result["ends_at"] = parse_local_datetime(payload.get("ends_at"), zone_name).isoformat()
    starts = datetime.fromisoformat(result["starts_at"])
    ends = datetime.fromisoformat(result["ends_at"])
    if ends <= starts:
        raise ValueError("The session must end after it starts.")
    if ends - starts > timedelta(days=7):
        raise ValueError("A single calendar event cannot be longer than seven days.")
    if "participant_ids" in payload or not existing:
        participant_ids = payload.get("participant_ids", [])
        if not isinstance(participant_ids, list):
            raise ValueError("Participants must be supplied as a list.")
        unique_ids = []
        for member_id in participant_ids[:30]:
            member = find_user(data, str(member_id))
            if not member or member.get("status") != "active":
                raise ValueError("One of the selected participants is not available.")
            if member["id"] != user["id"] and member["id"] not in unique_ids:
                if users_blocked(data, user["id"], member["id"]):
                    raise ValueError("A selected participant is unavailable because one member blocked the other.")
                if not minor_messaging_allowed(data, user, member):
                    raise ValueError(
                        "Student safety settings require an accepted connection before scheduling a direct session."
                    )
                unique_ids.append(member["id"])
        result["participant_ids"] = unique_ids
    if "reminders_minutes" in payload or not existing:
        result["reminders_minutes"] = normalize_reminders(payload.get("reminders_minutes"))
    return result


def notify_event_members(data: dict[str, Any], event: dict[str, Any], actor: dict[str, Any], message: str, notification_type: str) -> None:
    recipients = set(event.get("participant_ids", [])) | ({event.get("host_id")} if event.get("host_id") else set())
    recipients.discard(actor["id"])
    for recipient_id in recipients:
        if find_user(data, recipient_id):
            add_notification(data, recipient_id, notification_type, message, actor_id=actor["id"], extra={"event_id": event["id"]})


@app.get("/api/calendar")
@login_required
def calendar_overview(user, data):
    events = [event_view(item, data, user) for item in data.get("calendar_events", []) if can_access_event(item, user)]
    events.sort(key=lambda item: item.get("starts_at", ""))
    availability = next((item for item in data.get("availability_rules", []) if item.get("user_id") == user["id"]), None)
    if not availability:
        availability = default_availability(user)
        data.setdefault("availability_rules", []).append(availability)
    return jsonify({
        "ok": True, "events": events, "availability": availability,
        "contacts": [
            public_member_card(member) for member in data.get("users", [])
            if member["id"] != user["id"] and member.get("status") == "active"
            and not users_blocked(data, user["id"], member["id"])
            and minor_messaging_allowed(data, user, member)
        ],
        "server_time": utc_now(),
    })


@app.patch("/api/calendar/availability")
@login_required
def update_availability(user, data):
    payload = request.get_json(silent=True) or {}
    try:
        zone_name = clean_text(payload.get("timezone"), "Timezone", 80, required=True)
        ZoneInfo(zone_name)
        buffer_minutes = int(payload.get("buffer_minutes", 15))
        if buffer_minutes < 0 or buffer_minutes > 240:
            raise ValueError("Session buffer must be between 0 and 240 minutes.")
        weekly_source = payload.get("weekly")
        if not isinstance(weekly_source, dict):
            raise ValueError("Weekly availability is required.")
        weekly = {}
        for day in CALENDAR_DAYS:
            slots = weekly_source.get(day, [])
            if not isinstance(slots, list) or len(slots) > 6:
                raise ValueError(f"{day.title()} can contain up to six time ranges.")
            cleaned_slots = []
            for slot in slots:
                start = clean_text(slot.get("start") if isinstance(slot, dict) else "", "Start time", 5, required=True)
                end = clean_text(slot.get("end") if isinstance(slot, dict) else "", "End time", 5, required=True)
                if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", start) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", end) or start >= end:
                    raise ValueError(f"{day.title()} has an invalid time range.")
                cleaned_slots.append({"start": start, "end": end})
            cleaned_slots.sort(key=lambda item: item["start"])
            if any(cleaned_slots[index]["start"] < cleaned_slots[index - 1]["end"] for index in range(1, len(cleaned_slots))):
                raise ValueError(f"{day.title()} availability ranges cannot overlap.")
            weekly[day] = cleaned_slots
    except (TypeError, ValueError, ZoneInfoNotFoundError) as exc:
        return json_error(str(exc) or "Availability settings are invalid.")
    record = next((item for item in data.get("availability_rules", []) if item.get("user_id") == user["id"]), None)
    if not record:
        record = {"user_id": user["id"]}
        data.setdefault("availability_rules", []).append(record)
    record.update({"timezone": zone_name, "weekly": weekly, "buffer_minutes": buffer_minutes, "updated_at": utc_now()})
    user.setdefault("profile", {})["timezone"] = zone_name
    user["updated_at"] = utc_now()
    add_audit(data, user, "updated_availability", user["id"], f"Updated weekly availability in {zone_name}.")
    write_store(data)
    return jsonify({"ok": True, "availability": record})


@app.post("/api/calendar/events")
@login_required
def create_calendar_event(user, data):
    payload = request.get_json(silent=True) or {}
    try:
        event = validate_event_payload(payload, data, user)
    except ValueError as exc:
        return json_error(str(exc))
    now = utc_now()
    source_conversation_id = clean_text(payload.get("conversation_id"), "Conversation", 100) or None
    event.update({
        "id": f"event_{secrets.token_hex(9)}", "host_id": user["id"], "status": "scheduled",
        "sent_reminders": [], "reschedule_history": [], "workshop_id": None,
        "conversation_id": source_conversation_id,
        "source_conversation_id": source_conversation_id,
        "created_by": user["id"], "created_at": now, "updated_at": now,
    })
    if source_conversation_id:
        conversation = find_conversation(data, source_conversation_id)
        if not conversation or not conversation_member(conversation, user["id"]):
            return json_error("Linked conversation not found.")
    data.setdefault("calendar_events", []).append(event)
    ensure_event_conversation(data, event)
    append_event_inbox_message(data, event, user, "scheduled")
    notify_event_members(
        data, event, user,
        f"New meeting invitation: {event['title']}. Open its meeting thread in Inbox for the complete details.",
        "calendar_invitation",
    )
    add_audit(data, user, "created_calendar_event", event["id"], f"Scheduled {event['title']}.")
    write_store(data)
    return jsonify({"ok": True, "event": event_view(event, data, user)}), 201


@app.patch("/api/calendar/events/<event_id>")
@login_required
def update_calendar_event(user, data, event_id: str):
    event = next((item for item in data.get("calendar_events", []) if item.get("id") == event_id), None)
    if not event or not can_access_event(event, user) or not (user["id"] in {event.get("created_by"), event.get("host_id")} or user.get("role") == "admin"):
        return json_error("Editable calendar event not found.", 404)
    if event.get("status") == "cancelled":
        return json_error("A cancelled event cannot be rescheduled.", 409)
    payload = request.get_json(silent=True) or {}
    previous = {
        key: event.get(key) for key in (
            "title", "starts_at", "ends_at", "timezone", "location", "meeting_url", "participant_ids"
        )
    }
    try:
        updated = validate_event_payload(payload, data, user, event)
    except ValueError as exc:
        return json_error(str(exc))
    schedule_changed = any(previous.get(key) != updated.get(key) for key in ("starts_at", "ends_at", "timezone"))
    if schedule_changed:
        updated.setdefault("reschedule_history", []).append({
            "starts_at": previous["starts_at"], "ends_at": previous["ends_at"],
            "timezone": previous["timezone"], "changed_by": user["id"], "changed_at": utc_now(),
        })
        updated["sent_reminders"] = []
    updated["updated_at"] = utc_now()
    event.clear()
    event.update(updated)
    notice = f"{user['profile']['display_name']} rescheduled {event['title']}." if schedule_changed else f"{user['profile']['display_name']} updated {event['title']}."
    ensure_event_conversation(data, event)
    append_event_inbox_message(data, event, user, "rescheduled" if schedule_changed else "updated")
    notify_event_members(data, event, user, notice, "calendar_rescheduled" if schedule_changed else "calendar_updated")
    removed_members = set(previous.get("participant_ids") or []) - set(event.get("participant_ids") or [])
    for removed_id in removed_members:
        if find_user(data, removed_id):
            add_notification(
                data, removed_id, "calendar_removed",
                f"You are no longer included in {event['title']}.",
                actor_id=user["id"], extra={"event_id": event["id"]},
            )
    add_audit(data, user, "rescheduled_calendar_event" if schedule_changed else "updated_calendar_event", event_id, notice)
    write_store(data)
    return jsonify({"ok": True, "event": event_view(event, data, user)})


@app.delete("/api/calendar/events/<event_id>")
@login_required
def cancel_calendar_event(user, data, event_id: str):
    event = next((item for item in data.get("calendar_events", []) if item.get("id") == event_id), None)
    if not event or not (user["id"] in {event.get("created_by"), event.get("host_id")} or user.get("role") == "admin"):
        return json_error("Cancellable calendar event not found.", 404)
    if event.get("status") == "cancelled":
        return jsonify({"ok": True, "event": event_view(event, data, user)})
    event["status"] = "cancelled"
    event["cancelled_by"] = user["id"]
    event["cancelled_at"] = utc_now()
    event["updated_at"] = event["cancelled_at"]
    ensure_event_conversation(data, event)
    append_event_inbox_message(data, event, user, "cancelled")
    notify_event_members(data, event, user, f"{event['title']} was cancelled by {user['profile']['display_name']}.", "calendar_cancelled")
    add_audit(data, user, "cancelled_calendar_event", event_id, f"Cancelled {event['title']}.")
    write_store(data)
    return jsonify({"ok": True, "event": event_view(event, data, user)})


def ics_escape(value: Any) -> str:
    return str(value or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


@app.get("/api/calendar/events/<event_id>/ics")
@login_required
def export_calendar_event(user, data, event_id: str):
    event = next((item for item in data.get("calendar_events", []) if item.get("id") == event_id), None)
    if not event or not can_access_event(event, user):
        return json_error("Calendar event not found.", 404)
    starts = datetime.fromisoformat(event["starts_at"]).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ends = datetime.fromisoformat(event["ends_at"]).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    location = event.get("meeting_url") or event.get("location", "")
    status = "CANCELLED" if event.get("status") == "cancelled" else "CONFIRMED"
    content = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SwapLabs//Calendar//EN", "CALSCALE:GREGORIAN",
        "BEGIN:VEVENT", f"UID:{ics_escape(event['id'])}@swaplabs.local", f"DTSTAMP:{stamp}",
        f"DTSTART:{starts}", f"DTEND:{ends}", f"SUMMARY:{ics_escape(event['title'])}",
        f"DESCRIPTION:{ics_escape(event.get('description', ''))}", f"LOCATION:{ics_escape(location)}", f"STATUS:{status}",
        "END:VEVENT", "END:VCALENDAR", "",
    ])
    filename = re.sub(r"[^A-Za-z0-9_-]+", "-", event.get("title", "swaplabs-event")).strip("-")[:60] or "swaplabs-event"
    return Response(content, mimetype="text/calendar", headers={"Content-Disposition": f'attachment; filename="{filename}.ics"'})


def find_video_room(data: dict[str, Any], room_id: str) -> dict[str, Any] | None:
    return next((room for room in data.get("video_rooms", []) if room.get("id") == room_id), None)


def video_room_member(room: dict[str, Any], user_id: str) -> bool:
    return user_id == room.get("host_id") or user_id in room.get("participant_ids", [])


def can_access_video_room(room: dict[str, Any], user: dict[str, Any]) -> bool:
    return user.get("role") == "admin" or video_room_member(room, user["id"])


def find_video_attendance(
    data: dict[str, Any], room_id: str, user_id: str,
) -> dict[str, Any] | None:
    return next((
        record for record in data.get("video_attendance", [])
        if record.get("room_id") == room_id and record.get("user_id") == user_id
    ), None)


def attendance_duration(record: dict[str, Any]) -> int:
    joined = parse_utc_timestamp(record.get("joined_at"))
    left = parse_utc_timestamp(record.get("left_at")) or datetime.now(timezone.utc)
    if not joined:
        return int(record.get("duration_seconds", 0) or 0)
    return max(int((left - joined).total_seconds()), 0)


def connection_check(payload: Any) -> dict[str, Any]:
    source = payload if isinstance(payload, dict) else {}
    quality = clean_text(source.get("quality", "unknown"), "Connection quality", 20).lower()
    if quality not in {"excellent", "good", "fair", "poor", "unknown"}:
        quality = "unknown"

    def number(name: str, maximum: float) -> float | None:
        raw_value = source.get(name)
        if raw_value in {None, ""}:
            return None
        try:
            value = round(float(raw_value), 2)
        except (TypeError, ValueError):
            return None
        return value if 0 <= value <= maximum else None

    return {
        "quality": quality,
        "rtt_ms": number("rtt_ms", 60_000),
        "packet_loss_pct": number("packet_loss_pct", 100),
        "downlink_mbps": number("downlink_mbps", 10_000),
        "effective_type": clean_text(source.get("effective_type"), "Network type", 30),
        "camera_ready": bool(source.get("camera_ready")),
        "microphone_ready": bool(source.get("microphone_ready")),
        "checked_at": utc_now(),
    }


def attendance_view(record: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    member = find_user(data, record.get("user_id"))
    return {
        **record,
        "duration_seconds": attendance_duration(record),
        "confirmation_complete": bool(record.get("participant_confirmed") and record.get("host_confirmed")),
        "member": public_member_card(member) if member else None,
    }


def video_room_view(room: dict[str, Any], data: dict[str, Any], viewer: dict[str, Any]) -> dict[str, Any]:
    viewer_is_host = viewer["id"] == room.get("host_id") or viewer.get("role") == "admin"
    records = [
        attendance_view(record, data) for record in data.get("video_attendance", [])
        if record.get("room_id") == room["id"]
    ]
    if not viewer_is_host:
        for record in records:
            if record.get("user_id") != viewer["id"]:
                record["connection_checks"] = []
    records.sort(key=lambda record: record.get("requested_at", ""))
    event = next((item for item in data.get("calendar_events", []) if item.get("id") == room.get("event_id")), None)
    participant_ids = list(dict.fromkeys([room.get("host_id"), *room.get("participant_ids", [])]))
    participants = [
        public_member_card(member) for member_id in participant_ids
        if member_id and (member := find_user(data, member_id))
    ]
    viewer_attendance = next((record for record in records if record.get("user_id") == viewer["id"]), None)
    return {
        **room,
        "participants": participants,
        "attendance": records,
        "viewer_attendance": viewer_attendance,
        "viewer_is_host": viewer_is_host,
        "event": event_view(event, data, viewer) if event and can_access_event(event, viewer) else None,
    }


def room_or_error(data: dict[str, Any], user: dict[str, Any], room_id: str):
    room = find_video_room(data, room_id)
    if not room or not can_access_video_room(room, user):
        return None, json_error("Video room not found.", 404)
    return room, None


@app.post("/api/video/rooms")
@login_required
def create_video_room(user, data):
    payload = request.get_json(silent=True) or {}
    event_id = clean_text(payload.get("event_id"), "Calendar event", 100)
    event = next((item for item in data.get("calendar_events", []) if item.get("id") == event_id), None) if event_id else None
    if event_id and (not event or not can_access_event(event, user)):
        return json_error("Calendar event not found.", 404)
    if event and event.get("status") == "cancelled":
        return json_error("A video room cannot be opened for a cancelled event.", 409)
    existing = next((room for room in data.get("video_rooms", []) if event_id and room.get("event_id") == event_id), None)
    if existing:
        return jsonify({"ok": True, "room": video_room_view(existing, data, user)})

    try:
        if event:
            title = event.get("title", "SwapLabs video session")
            host_id = event.get("host_id") or event.get("created_by") or user["id"]
            participant_ids = list(event.get("participant_ids", []))
        else:
            title = clean_text(payload.get("title"), "Room title", 160, required=True)
            host_id = user["id"]
            supplied = payload.get("participant_ids", [])
            if not isinstance(supplied, list):
                raise ValueError("Room participants must be supplied as a list.")
            participant_ids = []
            for member_id in supplied[:7]:
                member = find_user(data, str(member_id))
                if not member or member.get("status") != "active":
                    raise ValueError("One of the room participants is unavailable.")
                if member["id"] != user["id"] and member["id"] not in participant_ids:
                    if not minor_messaging_allowed(data, user, member):
                        raise ValueError("Student video sessions require an accepted member connection.")
                    participant_ids.append(member["id"])
    except ValueError as exc:
        return json_error(str(exc))

    if host_id not in participant_ids:
        participant_ids = [member_id for member_id in participant_ids if member_id != host_id]
    now = utc_now()
    waiting_room_enabled = bool(payload.get("waiting_room_enabled", True))
    screen_sharing_enabled = bool(payload.get("screen_sharing_enabled", True))
    if event and user["id"] != host_id and user.get("role") != "admin":
        waiting_room_enabled = True
        screen_sharing_enabled = True
    room = {
        "id": f"room_{secrets.token_hex(10)}",
        "event_id": event_id or None,
        "title": title,
        "host_id": host_id,
        "participant_ids": participant_ids,
        "status": "open",
        "waiting_room_enabled": waiting_room_enabled,
        "screen_sharing_enabled": screen_sharing_enabled,
        "max_participants": 8,
        "created_by": user["id"],
        "created_at": now,
        "updated_at": now,
        "closed_at": None,
    }
    data.setdefault("video_rooms", []).append(room)
    add_audit(data, user, "created_video_room", room["id"], f"Created video room for {title}.")
    write_store(data)
    return jsonify({"ok": True, "room": video_room_view(room, data, user)}), 201


@app.get("/api/video/rooms/<room_id>")
@login_required
def get_video_room(user, data, room_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    return jsonify({"ok": True, "room": video_room_view(room, data, user)})


@app.post("/api/video/rooms/<room_id>/join")
@login_required
def join_video_room(user, data, room_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    if room.get("status") != "open":
        return json_error("This video room is closed.", 409)
    record = find_video_attendance(data, room_id, user["id"])
    now = utc_now()
    is_host = user["id"] == room.get("host_id") or user.get("role") == "admin"
    state = "admitted" if is_host or not room.get("waiting_room_enabled", True) else "waiting"
    if not record:
        record = {
            "id": f"attendance_{secrets.token_hex(10)}", "room_id": room_id,
            "event_id": room.get("event_id"), "user_id": user["id"], "state": state,
            "requested_at": now, "admitted_at": now if state == "admitted" else None,
            "joined_at": None, "left_at": None, "duration_seconds": 0,
            "participant_confirmed": False, "host_confirmed": is_host,
            "connection_checks": [], "updated_at": now,
        }
        data.setdefault("video_attendance", []).append(record)
    else:
        if record.get("state") in {"denied", "removed"} and not is_host:
            record["state"] = "waiting"
            record["requested_at"] = now
        elif record.get("state") in {"left", "waiting"}:
            record["state"] = state
            record["left_at"] = None
            if state == "admitted" and not record.get("admitted_at"):
                record["admitted_at"] = now
        record["updated_at"] = now
    if isinstance((request.get_json(silent=True) or {}).get("connection_check"), dict):
        record.setdefault("connection_checks", []).append(
            connection_check((request.get_json(silent=True) or {}).get("connection_check"))
        )
        record["connection_checks"] = record["connection_checks"][-30:]
    if record["state"] == "waiting":
        host = find_user(data, room.get("host_id"))
        if host:
            add_notification(
                data, host["id"], "video_waiting_room",
                f"{user['profile']['display_name']} is waiting to join {room['title']}.",
                actor_id=user["id"], extra={"room_id": room_id},
            )
    add_audit(data, user, "requested_video_room", room_id, f"Entered the {record['state']} state for {room['title']}.")
    write_store(data)
    return jsonify({"ok": True, "room": video_room_view(room, data, user)})


@app.patch("/api/video/rooms/<room_id>")
@login_required
def update_video_room(user, data, room_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    if user["id"] != room.get("host_id") and user.get("role") != "admin":
        return json_error("Only the room host can change room settings.", 403)
    payload = request.get_json(silent=True) or {}
    changes = []
    if "waiting_room_enabled" in payload:
        room["waiting_room_enabled"] = bool(payload.get("waiting_room_enabled"))
        changes.append("waiting room")
    if "screen_sharing_enabled" in payload:
        room["screen_sharing_enabled"] = bool(payload.get("screen_sharing_enabled"))
        changes.append("screen sharing")
    if "status" in payload:
        status = clean_text(payload.get("status"), "Room status", 20).lower()
        if status not in {"open", "closed"}:
            return json_error("Room status must be open or closed.")
        room["status"] = status
        room["closed_at"] = utc_now() if status == "closed" else None
        changes.append(f"status={status}")
        if status == "closed":
            for record in data.get("video_attendance", []):
                if record.get("room_id") == room_id and record.get("state") in {"admitted", "in_call", "waiting"}:
                    record["state"] = "left"
                    record["left_at"] = utc_now()
                    record["duration_seconds"] = attendance_duration(record)
    if not changes:
        return json_error("No supported room settings were supplied.")
    room["updated_at"] = utc_now()
    add_audit(data, user, "updated_video_room", room_id, "; ".join(changes))
    write_store(data)
    return jsonify({"ok": True, "room": video_room_view(room, data, user)})


@app.patch("/api/video/rooms/<room_id>/participants/<target_id>")
@login_required
def moderate_video_waiting_room(user, data, room_id: str, target_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    if user["id"] != room.get("host_id") and user.get("role") != "admin":
        return json_error("Only the room host can manage the waiting room.", 403)
    if not video_room_member(room, target_id):
        return json_error("Room participant not found.", 404)
    target = find_user(data, target_id)
    record = find_video_attendance(data, room_id, target_id)
    if not target or not record:
        return json_error("Waiting-room request not found.", 404)
    action = clean_text((request.get_json(silent=True) or {}).get("action"), "Waiting-room action", 20).lower()
    if action not in {"admit", "deny", "remove"}:
        return json_error("Choose admit, deny, or remove.")
    now = utc_now()
    if action == "admit":
        record["state"] = "admitted"
        record["admitted_at"] = now
        record["left_at"] = None
    elif action == "deny":
        record["state"] = "denied"
    else:
        record["state"] = "removed"
        record["left_at"] = now
        record["duration_seconds"] = attendance_duration(record)
    record["updated_at"] = now
    action_messages = {
        "admit": "admitted",
        "deny": "denied",
        "remove": "removed",
    }
    add_notification(
        data, target_id, "video_room_access",
        f"The host {action_messages[action]} your request for {room['title']}.",
        actor_id=user["id"], extra={"room_id": room_id, "action": action},
    )
    add_audit(data, user, f"video_participant_{action}", target_id, f"{action.title()} action in room {room_id}.")
    write_store(data)
    return jsonify({"ok": True, "room": video_room_view(room, data, user)})


@app.post("/api/video/rooms/<room_id>/signals")
@login_required
def send_video_signal(user, data, room_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    sender_attendance = find_video_attendance(data, room_id, user["id"])
    if not sender_attendance or sender_attendance.get("state") not in {"admitted", "in_call"}:
        return json_error("You must be admitted before sending connection signals.", 403)
    payload = request.get_json(silent=True) or {}
    target_id = clean_text(payload.get("target_id"), "Signal recipient", 100, required=True)
    signal_type = clean_text(payload.get("type"), "Signal type", 20, required=True).lower()
    if signal_type not in {"offer", "answer", "ice"}:
        return json_error("Signal type must be offer, answer, or ice.")
    if target_id == user["id"] or not video_room_member(room, target_id):
        return json_error("Signal recipient is not in this room.", 404)
    target_attendance = find_video_attendance(data, room_id, target_id)
    if not target_attendance or target_attendance.get("state") not in {"admitted", "in_call"}:
        return json_error("The selected participant is not admitted yet.", 409)
    signal_payload = payload.get("payload")
    try:
        encoded = json.dumps(signal_payload, ensure_ascii=False)
    except (TypeError, ValueError):
        return json_error("Connection signal payload is invalid.")
    if len(encoded.encode("utf-8")) > 80_000:
        return json_error("Connection signal payload is too large.", 413)
    signal = {
        "id": f"signal_{secrets.token_hex(10)}", "room_id": room_id,
        "from_id": user["id"], "target_id": target_id, "type": signal_type,
        "payload": signal_payload, "created_at": utc_now(),
    }
    data.setdefault("video_signals", []).append(signal)
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    data["video_signals"] = [
        item for item in data["video_signals"]
        if (parse_utc_timestamp(item.get("created_at")) or cutoff) >= cutoff
    ][-5000:]
    write_store(data)
    return jsonify({"ok": True, "signal_id": signal["id"], "created_at": signal["created_at"]}), 201


@app.get("/api/video/rooms/<room_id>/signals")
@login_required
def receive_video_signals(user, data, room_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    attendance = find_video_attendance(data, room_id, user["id"])
    if not attendance or attendance.get("state") not in {"admitted", "in_call"}:
        return json_error("You must be admitted before receiving connection signals.", 403)
    after = parse_utc_timestamp(request.args.get("after"))
    signals = [
        item for item in data.get("video_signals", [])
        if item.get("room_id") == room_id and item.get("target_id") == user["id"]
        and (not after or (parse_utc_timestamp(item.get("created_at")) or after) >= after)
    ]
    return jsonify({"ok": True, "signals": signals[-250:], "server_time": utc_now()})


@app.post("/api/video/rooms/<room_id>/attendance")
@login_required
def update_video_attendance(user, data, room_id: str):
    room, error = room_or_error(data, user, room_id)
    if error:
        return error
    payload = request.get_json(silent=True) or {}
    action = clean_text(payload.get("action"), "Attendance action", 30, required=True).lower()
    target_id = clean_text(payload.get("target_id", user["id"]), "Attendance member", 100, required=True)
    is_host = user["id"] == room.get("host_id") or user.get("role") == "admin"
    if target_id != user["id"] and (not is_host or action != "confirm"):
        return json_error("Only the host can confirm another member's attendance.", 403)
    record = find_video_attendance(data, room_id, target_id)
    if not record:
        return json_error("Attendance record not found. Join the room first.", 404)
    now = utc_now()
    if action == "joined":
        if target_id != user["id"] or record.get("state") not in {"admitted", "in_call"}:
            return json_error("You must be admitted before joining the call.", 403)
        record["state"] = "in_call"
        record["joined_at"] = record.get("joined_at") or now
        record["left_at"] = None
    elif action == "left":
        if target_id != user["id"]:
            return json_error("Members can only leave their own call.", 403)
        record["state"] = "left"
        record["left_at"] = now
        record["duration_seconds"] = attendance_duration(record)
    elif action == "confirm":
        if target_id == user["id"]:
            record["participant_confirmed"] = True
            if is_host:
                record["host_confirmed"] = True
        else:
            record["host_confirmed"] = True
    elif action == "quality":
        if target_id != user["id"]:
            return json_error("Members can only update their own connection quality.", 403)
        record.setdefault("connection_checks", []).append(connection_check(payload.get("connection_check")))
        record["connection_checks"] = record["connection_checks"][-30:]
    else:
        return json_error("Choose joined, left, confirm, or quality.")
    record["updated_at"] = now
    add_audit(data, user, f"video_attendance_{action}", target_id, f"Attendance action in room {room_id}.")
    write_store(data)
    return jsonify({"ok": True, "attendance": attendance_view(record, data), "room": video_room_view(room, data, user)})


@app.get("/api/credits")
@login_required
def credit_overview(user, data):
    entries = [item for item in data.get("credit_ledger", []) if item.get("user_id") == user["id"]]
    entries.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    disputes = [item for item in data.get("credit_disputes", []) if item.get("user_id") == user["id"] or item.get("counterparty_id") == user["id"]]
    disputes.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    total_earned = sum(max(0, int(item.get("amount", 0))) for item in entries if item.get("type") in {"earned", "refund", "correction", "initial_balance"})
    total_spent = abs(sum(min(0, int(item.get("amount", 0))) for item in entries if item.get("type") in {"payment", "refund_reversal"}))
    enriched = []
    for entry in entries:
        counterparty = find_user(data, entry.get("counterparty_id"))
        enriched.append({**entry, "counterparty": public_member_card(counterparty) if counterparty else None})
    return jsonify({
        "ok": True, "balance": int(user.get("time_credits", 0)), "entries": enriched, "disputes": disputes,
        "stats": {"earned": total_earned, "spent": total_spent, "transactions": len(entries), "open_disputes": sum(item.get("status") in {"open", "reviewing"} for item in disputes)},
        "contacts": [public_member_card(member) for member in data.get("users", []) if member["id"] != user["id"] and member.get("status") == "active" and member.get("role") != "admin"],
    })


@app.post("/api/credits/transfer")
@login_required
def transfer_credits(user, data):
    payload = request.get_json(silent=True) or {}
    try:
        recipient_id = clean_text(payload.get("recipient_id"), "Recipient", 100, required=True)
        description = clean_text(payload.get("description"), "Payment note", 300, required=True)
        amount = int(payload.get("amount"))
    except (TypeError, ValueError) as exc:
        return json_error(str(exc) or "Enter a whole credit amount.")
    recipient = find_user(data, recipient_id)
    if not recipient or recipient.get("status") != "active" or recipient_id == user["id"] or recipient.get("role") == "admin":
        return json_error("Choose an active member to receive this payment.")
    if amount < 1 or amount > 10000:
        return json_error("Transfer between 1 and 10,000 credits at a time.")
    transaction_id = f"transaction_{secrets.token_hex(10)}"
    try:
        outgoing = append_credit_entry(
            data, user["id"], "payment", -amount, description, reference_type="transfer",
            reference_id=transaction_id, counterparty_id=recipient_id, created_by=user["id"],
        )
        incoming = append_credit_entry(
            data, recipient_id, "earned", amount, description, reference_type="transfer",
            reference_id=transaction_id, counterparty_id=user["id"], created_by=user["id"],
        )
    except ValueError as exc:
        return json_error(str(exc), 409)
    add_notification(data, recipient_id, "credit_payment", f"{user['profile']['display_name']} paid you {amount} time credit{'s' if amount != 1 else ''}: {description}", actor_id=user["id"], extra={"transaction_id": transaction_id})
    deliver_bot_message(data, user["id"], f"Payment complete: {amount} credit{'s' if amount != 1 else ''} sent to {recipient['profile']['display_name']}. Your balance is {outgoing['balance_after']}.", message_type="credit_receipt", metadata={"transaction_id": transaction_id})
    add_audit(data, user, "transferred_time_credits", recipient_id, f"Transferred {amount} credits in {transaction_id}.")
    write_store(data)
    return jsonify({"ok": True, "transaction_id": transaction_id, "outgoing": outgoing, "incoming": incoming, "balance": outgoing["balance_after"]}), 201


@app.post("/api/credits/disputes")
@login_required
def create_credit_dispute(user, data):
    payload = request.get_json(silent=True) or {}
    entry_id = clean_text(payload.get("ledger_entry_id"), "Ledger entry", 120, required=True)
    entry = next((item for item in data.get("credit_ledger", []) if item.get("id") == entry_id and item.get("user_id") == user["id"]), None)
    if not entry or entry.get("type") != "payment" or int(entry.get("amount", 0)) >= 0:
        return json_error("Only an outgoing member payment can be disputed.", 404)
    if any(item.get("ledger_entry_id") == entry_id and item.get("status") in {"open", "reviewing"} for item in data.get("credit_disputes", [])):
        return json_error("This payment already has an open dispute.", 409)
    try:
        reason = clean_text(payload.get("reason"), "Reason", 80, required=True)
        details = clean_text(payload.get("details"), "Dispute details", 2000, required=True)
    except ValueError as exc:
        return json_error(str(exc))
    now = utc_now()
    dispute = {
        "id": f"dispute_{secrets.token_hex(9)}", "ledger_entry_id": entry_id,
        "user_id": user["id"], "counterparty_id": entry.get("counterparty_id"),
        "reason": reason, "details": details, "status": "open", "resolution": "pending",
        "admin_notes": "", "created_at": now, "updated_at": now,
    }
    data.setdefault("credit_disputes", []).append(dispute)
    append_credit_entry(
        data, user["id"], "dispute_opened", 0, f"Dispute opened: {reason}",
        reference_type="dispute", reference_id=dispute["id"], counterparty_id=entry.get("counterparty_id"), created_by=user["id"],
    )
    for admin in data.get("users", []):
        if admin.get("role") == "admin" and admin.get("status") == "active":
            add_notification(data, admin["id"], "credit_dispute", f"A new time-credit dispute requires review: {reason}.", actor_id=user["id"], extra={"dispute_id": dispute["id"]})
    add_audit(data, user, "opened_credit_dispute", entry_id, f"Opened dispute {dispute['id']}.")
    write_store(data)
    return jsonify({"ok": True, "dispute": dispute}), 201


@app.get("/api/workshops")
def list_workshops():
    viewer, data = current_session_user()
    if viewer and viewer.get("status") != "active":
        viewer = None
    workshops = [workshop_view(item, data, viewer) for item in data.get("workshops", []) if item.get("status") != "archived"]
    workshops.sort(key=lambda item: item.get("starts_at", ""))
    return jsonify({
        "ok": True, "authenticated": bool(viewer), "viewer_id": viewer["id"] if viewer else None,
        "workshops": workshops,
        "stats": {
            "scheduled": sum(item.get("status") == "scheduled" for item in workshops),
            "seats": sum(int(item.get("seat_limit", 0)) for item in workshops),
            "registered": sum(int(item.get("registered_count", 0)) for item in workshops),
            "hosts": len({item.get("host_id") for item in workshops if item.get("host_id")}),
        },
    })


@app.post("/api/workshops/<workshop_id>/register")
@login_required
def register_for_workshop(user, data, workshop_id: str):
    workshop = find_content(data, "workshops", workshop_id)
    if not workshop or workshop.get("status") != "scheduled":
        return json_error("This workshop is not open for registration.", 404)
    existing = next((
        item for item in data.get("workshop_registrations", [])
        if item.get("workshop_id") == workshop_id and item.get("user_id") == user["id"]
    ), None)
    active_count = sum(
        item.get("workshop_id") == workshop_id and item.get("status") == "registered"
        for item in data.get("workshop_registrations", [])
    )
    if existing and existing.get("status") == "registered":
        return json_error("You already have a place in this workshop.", 409)
    if active_count >= int(workshop.get("seat_limit", 0)):
        return json_error("This workshop is currently full.", 409)
    now = utc_now()
    if existing:
        existing.update({"status": "registered", "updated_at": now})
        registration = existing
    else:
        registration = {
            "id": f"registration_{secrets.token_hex(8)}", "workshop_id": workshop_id,
            "user_id": user["id"], "status": "registered", "admin_notes": "",
            "created_at": now, "updated_at": now,
        }
        data.setdefault("workshop_registrations", []).append(registration)
    starts = datetime.fromisoformat(workshop["starts_at"].replace("Z", "+00:00")).astimezone(timezone.utc)
    calendar_event = next((item for item in data.get("calendar_events", []) if item.get("id") == f"calendar_{registration['id']}"), None)
    calendar_values = {
        "title": workshop["title"], "description": workshop.get("description", ""),
        "host_id": workshop.get("host_id"), "participant_ids": [user["id"]],
        "starts_at": starts.replace(microsecond=0).isoformat(),
        "ends_at": (starts + timedelta(minutes=int(workshop.get("duration_minutes", 60)))).replace(microsecond=0).isoformat(),
        "timezone": user.get("profile", {}).get("timezone") or "UTC",
        "location": workshop.get("location", "SwapLabs Live Room"), "meeting_url": "", "status": "scheduled",
        "reminders_minutes": [1440, 60], "sent_reminders": [], "reschedule_history": [],
        "workshop_id": workshop_id, "conversation_id": None, "created_by": user["id"], "updated_at": now,
    }
    if calendar_event:
        calendar_event.update(calendar_values)
    else:
        calendar_event = {"id": f"calendar_{registration['id']}", "created_at": now, **calendar_values}
        data.setdefault("calendar_events", []).append(calendar_event)
    ensure_event_conversation(data, calendar_event)
    append_event_inbox_message(data, calendar_event, user, "scheduled")
    notify_event_members(
        data, calendar_event, user,
        f"{user['profile']['display_name']} joined {workshop['title']}. Open the meeting thread for details.",
        "workshop_attendee_added",
    )
    add_notification(
        data, user["id"], "workshop_registration",
        f"Your place in {workshop['title']} is confirmed.", extra={"workshop_id": workshop_id}
    )
    add_audit(data, user, "registered_for_workshop", workshop_id, f"Reserved a place in {workshop['title']}.")
    write_store(data)
    return jsonify({"ok": True, "message": "Your workshop place is confirmed.", "workshop": workshop_view(workshop, data, user)}), 201


@app.delete("/api/workshops/<workshop_id>/register")
@login_required
def cancel_workshop_registration(user, data, workshop_id: str):
    workshop = find_content(data, "workshops", workshop_id)
    registration = next((
        item for item in data.get("workshop_registrations", [])
        if item.get("workshop_id") == workshop_id and item.get("user_id") == user["id"] and item.get("status") == "registered"
    ), None)
    if not workshop or not registration:
        return json_error("Active workshop registration not found.", 404)
    registration["status"] = "cancelled"
    registration["updated_at"] = utc_now()
    for event in data.get("calendar_events", []):
        if event.get("workshop_id") == workshop_id and user["id"] in event.get("participant_ids", []):
            event["status"] = "cancelled"
            event["cancelled_by"] = user["id"]
            event["cancelled_at"] = utc_now()
            event["updated_at"] = event["cancelled_at"]
            ensure_event_conversation(data, event)
            append_event_inbox_message(data, event, user, "cancelled")
            notify_event_members(
                data, event, user,
                f"{user['profile']['display_name']} cancelled their place in {workshop['title']}.",
                "workshop_attendee_cancelled",
            )
    add_audit(data, user, "cancelled_workshop_registration", workshop_id, f"Cancelled a place in {workshop['title']}.")
    write_store(data)
    return jsonify({"ok": True, "message": "Your workshop registration was cancelled.", "workshop": workshop_view(workshop, data, user)})


@app.post("/api/contact")
def submit_contact_message():
    data = read_store()
    user = optional_session_user(data)
    payload = request.get_json(silent=True) or {}
    try:
        name, email = submitter_identity(payload, user)
        topic = clean_text(payload.get("topic"), "Topic", 80, required=True)
        subject = clean_text(payload.get("subject"), "Subject", 160, required=True)
        message = clean_text(payload.get("message"), "Message", 4000, required=True)
        preferred_contact = clean_text(payload.get("preferred_contact", "Email"), "Preferred contact", 40)
    except ValueError as exc:
        return json_error(str(exc))
    now = utc_now()
    item = {
        "id": f"contact_{secrets.token_hex(8)}", "user_id": user["id"] if user else None,
        "name": name, "email": email, "topic": topic, "subject": subject, "message": message,
        "preferred_contact": preferred_contact, "status": "new", "admin_notes": "",
        "created_at": now, "updated_at": now,
    }
    data.setdefault("contact_messages", []).insert(0, item)
    add_audit(data, user, "submitted_contact_message", item["id"], f"Submitted a {topic} contact message.")
    write_store(data)
    return jsonify({"ok": True, "reference": item["id"].replace("contact_", "SL-C-").upper(), "message": "Your message has reached the SwapLabs team."}), 201


@app.post("/api/complaints")
def submit_complaint():
    data = read_store()
    user = optional_session_user(data)
    payload = request.get_json(silent=True) or {}
    try:
        name, email = submitter_identity(payload, user)
        category = clean_text(payload.get("category"), "Complaint category", 100, required=True)
        priority = clean_text(payload.get("priority", "standard"), "Priority", 30, required=True).lower()
        if priority not in {"standard", "time-sensitive", "urgent"}:
            raise ValueError("Choose a valid complaint priority.")
        subject = clean_text(payload.get("subject"), "Subject", 180, required=True)
        reference = clean_text(payload.get("reference"), "Related reference", 160)
        details = clean_text(payload.get("details"), "Complaint details", 6000, required=True)
        resolution = clean_text(payload.get("resolution"), "Requested resolution", 1600, required=True)
    except ValueError as exc:
        return json_error(str(exc))
    now = utc_now()
    item = {
        "id": f"complaint_{secrets.token_hex(8)}", "user_id": user["id"] if user else None,
        "name": name, "email": email, "category": category, "priority": priority,
        "subject": subject, "reference": reference, "details": details, "resolution": resolution,
        "status": "received", "admin_notes": "", "created_at": now, "updated_at": now,
    }
    data.setdefault("complaints", []).insert(0, item)
    add_audit(data, user, "submitted_complaint", item["id"], f"Submitted a {priority} {category} complaint.")
    write_store(data)
    return jsonify({"ok": True, "reference": item["id"].replace("complaint_", "SL-K-").upper(), "message": "Your complaint has been recorded for review."}), 201


@app.get("/api/testimonials")
def list_testimonials():
    data = read_store()
    try:
        limit = min(max(int(request.args.get("limit", 20)), 1), 50)
    except ValueError:
        limit = 20
    items = [feedback_view(item) for item in data.get("feedback", []) if item.get("status") == "published" and item.get("permission_to_publish")]
    items.sort(key=lambda item: (not bool(item.get("featured")), item.get("created_at", "")), reverse=False)
    return jsonify({"ok": True, "testimonials": items[:limit]})


@app.post("/api/feedback")
def submit_feedback():
    data = read_store()
    user = optional_session_user(data)
    payload = request.get_json(silent=True) or {}
    try:
        name, email = submitter_identity(payload, user)
        role = clean_text(payload.get("role"), "Role or learning context", 120, required=True)
        title = clean_text(payload.get("title"), "Testimonial title", 140, required=True)
        message = clean_text(payload.get("message"), "Feedback", 1800, required=True)
        rating = int(payload.get("rating"))
        if rating < 1 or rating > 5:
            raise ValueError
    except (TypeError, ValueError) as exc:
        if isinstance(exc, ValueError) and str(exc):
            return json_error(str(exc))
        return json_error("Choose a rating from 1 to 5.")
    permission = bool(payload.get("permission_to_publish"))
    now = utc_now()
    item = {
        "id": f"feedback_{secrets.token_hex(8)}", "user_id": user["id"] if user else None,
        "name": name, "email": email, "role": role, "rating": rating, "title": title, "message": message,
        "permission_to_publish": permission, "status": "published" if permission else "private",
        "featured": False, "admin_notes": "", "created_at": now, "updated_at": now,
    }
    data.setdefault("feedback", []).insert(0, item)
    add_audit(data, user, "submitted_feedback", item["id"], "Submitted feedback with homepage permission." if permission else "Submitted private feedback.")
    write_store(data)
    return jsonify({
        "ok": True, "testimonial": feedback_view(item) if permission else None,
        "message": "Thank you. Your testimonial is now part of the homepage community belt." if permission else "Thank you. Your feedback was saved privately for the team.",
    }), 201


@app.get("/api/ideas")
def list_ideas():
    viewer, data = current_session_user()
    if viewer and viewer.get("status") != "active":
        viewer = None
    visible_statuses = {"published", "funded", "pilot", "seeking_support"}
    ideas = [
        idea_view(item, data, viewer) for item in data.get("ideas", [])
        if item.get("status") in visible_statuses
        or viewer and viewer["id"] == item.get("owner_id") and item.get("status") in {"specialist_review", "under_review"}
    ]
    ideas.sort(key=lambda item: (item.get("status") == "funded", item.get("like_count", 0), item.get("updated_at", "")), reverse=True)
    return jsonify({
        "ok": True, "authenticated": bool(viewer), "viewer_id": viewer["id"] if viewer else None,
        "ideas": ideas,
        "stats": {
            "ideas": len(ideas), "supporters": len({user_id for item in data.get("ideas", []) for user_id in item.get("liked_by", [])}),
            "funding_requested": sum(int(item.get("funding_needed", 0)) for item in ideas),
            "comments": sum(len(item.get("comments", [])) for item in ideas),
        },
    })


@app.post("/api/ideas")
@login_required
def submit_idea(user, data):
    payload = request.get_json(silent=True) or {}
    try:
        idea = validate_idea(payload)
    except ValueError as exc:
        return json_error(str(exc))
    if not bool(payload.get("community_agreement")):
        return json_error("Accept the community idea agreement before submitting.")
    safety = user.get("safety", {})
    is_minor = bool(safety.get("is_minor"))
    if is_minor and safety.get("guardian_consent_status") == "rejected":
        return json_error("Guardian consent was not approved. Update the guardian details before submitting.", 403)
    now = utc_now()
    status = "specialist_review" if is_minor else "published"
    idea.update({
        "id": f"idea_{secrets.token_hex(8)}", "owner_id": user["id"], "status": status,
        "moderation_notes": "", "created_at": now, "updated_at": now,
        "liked_by": [], "saved_by": [], "comments": [],
        "safety_review_status": "pending" if is_minor else "not_required",
        "owner_age_group": ("13–15" if int(user["profile"]["age"]) <= 15 else "16–17") if is_minor else "adult",
        "guardian_consent_status": safety.get("guardian_consent_status", "not_required"),
        "specialist_reviewer_id": None, "specialist_reviewed_at": None,
    })
    data.setdefault("ideas", []).insert(0, idea)
    if is_minor:
        add_notification(
            data, user["id"], "idea_safety_review",
            f"Your idea, {idea['title']}, is in specialist safety review before community publication.",
            extra={"idea_id": idea["id"]},
        )
        for admin in (member for member in data.get("users", []) if member.get("role") == "admin"):
            add_notification(
                data, admin["id"], "student_idea_review",
                f"A student idea, {idea['title']}, needs specialist moderation.",
                actor_id=user["id"], extra={"idea_id": idea["id"]},
            )
        audit_action = "submitted_student_idea"
        message = "Your idea was saved and sent to a student-safety specialist before publication."
    else:
        add_notification(data, user["id"], "idea_published", f"Your idea, {idea['title']}, is now visible in the Innovation Lab.", extra={"idea_id": idea["id"]})
        audit_action = "published_idea"
        message = "Your idea is now visible to the community."
    add_audit(data, user, audit_action, idea["id"], f"Submitted the idea {idea['title']} with status {status}.")
    write_store(data)
    return jsonify({"ok": True, "message": message, "idea": idea_view(idea, data, user)}), 201


@app.patch("/api/ideas/<idea_id>")
@login_required
def update_own_idea(user, data, idea_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea:
        return json_error("Idea not found.", 404)
    if idea.get("owner_id") != user["id"]:
        return json_error("Only the idea owner can edit this submission.", 403)
    payload = request.get_json(silent=True) or {}
    try:
        updated = validate_idea(payload, idea)
    except ValueError as exc:
        return json_error(str(exc))
    updated["updated_at"] = utc_now()
    if user.get("safety", {}).get("is_minor"):
        updated["status"] = "specialist_review"
        updated["safety_review_status"] = "pending"
        updated["specialist_reviewer_id"] = None
        updated["specialist_reviewed_at"] = None
    idea.clear()
    idea.update(updated)
    add_audit(data, user, "updated_idea", idea_id, f"Updated the idea {idea['title']}.")
    write_store(data)
    return jsonify({"ok": True, "message": "Idea changes saved.", "idea": idea_view(idea, data, user)})


@app.post("/api/ideas/<idea_id>/like")
@login_required
def toggle_idea_like(user, data, idea_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea or idea.get("status") not in {"published", "funded", "pilot", "seeking_support"}:
        return json_error("Idea not found.", 404)
    liked_by = idea.setdefault("liked_by", [])
    liked = user["id"] not in liked_by
    if liked:
        liked_by.append(user["id"])
    else:
        liked_by.remove(user["id"])
    idea["updated_at"] = utc_now()
    write_store(data)
    return jsonify({"ok": True, "liked": liked, "like_count": len(liked_by)})


@app.post("/api/ideas/<idea_id>/save")
@login_required
def toggle_idea_save(user, data, idea_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea or idea.get("status") not in {"published", "funded", "pilot", "seeking_support"}:
        return json_error("Idea not found.", 404)
    saved_by = idea.setdefault("saved_by", [])
    saved = user["id"] not in saved_by
    if saved:
        saved_by.append(user["id"])
    else:
        saved_by.remove(user["id"])
    write_store(data)
    return jsonify({"ok": True, "saved": saved, "save_count": len(saved_by)})


@app.post("/api/ideas/<idea_id>/comments")
@login_required
def comment_on_idea(user, data, idea_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea or idea.get("status") not in {"published", "funded", "pilot", "seeking_support"}:
        return json_error("Idea not found.", 404)
    payload = request.get_json(silent=True) or {}
    try:
        message = clean_text(payload.get("message"), "Comment", 1200, required=True)
    except ValueError as exc:
        return json_error(str(exc))
    comment = {"id": f"comment_{secrets.token_hex(8)}", "user_id": user["id"], "message": message, "created_at": utc_now()}
    idea.setdefault("comments", []).append(comment)
    idea["updated_at"] = utc_now()
    if idea.get("owner_id") != user["id"]:
        add_notification(
            data, idea["owner_id"], "idea_comment",
            f"{user['profile']['display_name']} commented on {idea['title']}.",
            actor_id=user["id"], extra={"idea_id": idea_id, "comment_id": comment["id"]}
        )
    add_audit(data, user, "commented_on_idea", idea_id, f"Commented on {idea['title']}.")
    write_store(data)
    return jsonify({"ok": True, "comment": comment_view(comment, data), "comment_count": len(idea["comments"])}), 201


@app.delete("/api/ideas/<idea_id>/comments/<comment_id>")
@login_required
def delete_idea_comment(user, data, idea_id: str, comment_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea:
        return json_error("Idea not found.", 404)
    comment = next((item for item in idea.get("comments", []) if item.get("id") == comment_id), None)
    if not comment:
        return json_error("Comment not found.", 404)
    if comment.get("user_id") != user["id"] and idea.get("owner_id") != user["id"] and user.get("role") != "admin":
        return json_error("You cannot remove this comment.", 403)
    idea["comments"] = [item for item in idea.get("comments", []) if item.get("id") != comment_id]
    idea["updated_at"] = utc_now()
    add_audit(data, user, "deleted_idea_comment", idea_id, f"Removed a comment from {idea['title']}.")
    write_store(data)
    return jsonify({"ok": True, "message": "Comment removed."})


@app.get("/api/admin/content")
@admin_required
def admin_content_overview(admin, data):
    return jsonify({
        "ok": True,
        "stats": {
            "ideas": len(data.get("ideas", [])), "published_testimonials": sum(item.get("status") == "published" for item in data.get("feedback", [])),
            "open_complaints": sum(item.get("status") not in {"resolved", "closed"} for item in data.get("complaints", [])),
            "new_contacts": sum(item.get("status") == "new" for item in data.get("contact_messages", [])),
            "workshop_registrations": sum(item.get("status") == "registered" for item in data.get("workshop_registrations", [])),
            "student_reviews": sum(item.get("status") == "specialist_review" for item in data.get("ideas", [])),
        },
        "ideas": [idea_view(item, data, admin, admin_view=True) for item in data.get("ideas", [])],
        "feedback": data.get("feedback", []), "complaints": data.get("complaints", []),
        "contact_messages": data.get("contact_messages", []),
        "workshops": [workshop_view(item, data, admin) for item in data.get("workshops", [])],
        "workshop_registrations": [
            {**item, "user": safe_user(find_user(data, item.get("user_id")), admin_view=True) if find_user(data, item.get("user_id")) else None}
            for item in data.get("workshop_registrations", [])
        ],
    })


@app.patch("/api/admin/ideas/<idea_id>")
@admin_required
def admin_update_idea(admin, data, idea_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea:
        return json_error("Idea not found.", 404)
    payload = request.get_json(silent=True) or {}
    try:
        updated = validate_idea(payload, idea)
        if "status" in payload:
            status = clean_text(payload.get("status"), "Status", 40, required=True).lower()
            if status not in {"published", "specialist_review", "under_review", "funded", "pilot", "seeking_support", "archived", "rejected"}:
                raise ValueError("Choose a valid idea status.")
            updated["status"] = status
        if "moderation_notes" in payload:
            updated["moderation_notes"] = clean_text(payload.get("moderation_notes"), "Moderation notes", 2400)
    except ValueError as exc:
        return json_error(str(exc))
    updated["updated_at"] = utc_now()
    if idea.get("safety_review_status") not in {None, "not_required"}:
        updated["safety_review_status"] = (
            "approved" if updated.get("status") in {"published", "funded", "pilot", "seeking_support"}
            else "rejected" if updated.get("status") == "rejected"
            else "reviewing"
        )
        updated["specialist_reviewer_id"] = admin["id"]
        updated["specialist_reviewed_at"] = utc_now()
    idea.clear()
    idea.update(updated)
    owner = find_user(data, idea.get("owner_id"))
    if owner:
        add_notification(data, owner["id"], "idea_moderated", f"An administrator updated {idea['title']}.", actor_id=admin["id"], extra={"idea_id": idea_id})
    add_audit(data, admin, "admin_updated_idea", idea_id, f"Edited and moderated {idea['title']}.")
    write_store(data)
    return jsonify({"ok": True, "message": "Idea record updated.", "idea": idea_view(idea, data, admin, admin_view=True)})


@app.delete("/api/admin/ideas/<idea_id>")
@admin_required
def admin_delete_idea(admin, data, idea_id: str):
    idea = find_content(data, "ideas", idea_id)
    if not idea:
        return json_error("Idea not found.", 404)
    title = idea.get("title", "Idea")
    owner = find_user(data, idea.get("owner_id"))
    data["ideas"] = [item for item in data.get("ideas", []) if item.get("id") != idea_id]
    if owner:
        add_notification(data, owner["id"], "idea_removed", f"An administrator removed {title} from the Innovation Lab.", actor_id=admin["id"])
    add_audit(data, admin, "admin_deleted_idea", idea_id, f"Permanently deleted {title}.")
    write_store(data)
    return jsonify({"ok": True, "message": f"{title} was deleted."})


ADMIN_CONTENT_COLLECTIONS = {
    "contacts": "contact_messages", "complaints": "complaints", "feedback": "feedback",
    "registrations": "workshop_registrations", "workshops": "workshops",
}


@app.patch("/api/admin/content/<collection>/<content_id>")
@admin_required
def admin_update_content(admin, data, collection: str, content_id: str):
    store_key = ADMIN_CONTENT_COLLECTIONS.get(collection)
    if not store_key:
        return json_error("Unknown content collection.", 404)
    item = find_content(data, store_key, content_id)
    if not item:
        return json_error("Content record not found.", 404)
    payload = request.get_json(silent=True) or {}
    try:
        if "status" in payload:
            item["status"] = clean_text(payload.get("status"), "Status", 40, required=True).lower()
        if "admin_notes" in payload:
            item["admin_notes"] = clean_text(payload.get("admin_notes"), "Administrator notes", 2400)
        if collection == "complaints" and "priority" in payload:
            item["priority"] = clean_text(payload.get("priority"), "Priority", 30, required=True).lower()
        if collection == "feedback":
            for field, maximum in (("title", 140), ("message", 1800), ("role", 120)):
                if field in payload:
                    item[field] = clean_text(payload.get(field), field.title(), maximum, required=True)
            if "rating" in payload:
                rating = int(payload.get("rating"))
                if rating < 1 or rating > 5:
                    raise ValueError("Rating must be between 1 and 5.")
                item["rating"] = rating
            if "featured" in payload:
                item["featured"] = bool(payload.get("featured"))
            if item.get("status") == "published" and not item.get("permission_to_publish"):
                raise ValueError("This feedback cannot be published because the author did not grant permission.")
        if collection == "workshops":
            for field, maximum in (("title", 140), ("description", 1200), ("location", 160)):
                if field in payload:
                    item[field] = clean_text(payload.get(field), field.title(), maximum, required=True)
    except (TypeError, ValueError) as exc:
        return json_error(str(exc) or "The supplied value is invalid.")
    item["updated_at"] = utc_now()
    add_audit(data, admin, f"admin_updated_{store_key}", content_id, f"Updated {store_key.replace('_', ' ')} record {content_id}.")
    write_store(data)
    return jsonify({"ok": True, "message": "Administrative changes saved.", "item": item})


@app.delete("/api/admin/content/<collection>/<content_id>")
@admin_required
def admin_delete_content(admin, data, collection: str, content_id: str):
    store_key = ADMIN_CONTENT_COLLECTIONS.get(collection)
    if not store_key or store_key == "workshops":
        return json_error("This content collection cannot be deleted here.", 400)
    item = find_content(data, store_key, content_id)
    if not item:
        return json_error("Content record not found.", 404)
    data[store_key] = [record for record in data.get(store_key, []) if record.get("id") != content_id]
    add_audit(data, admin, f"admin_deleted_{store_key}", content_id, f"Deleted {store_key.replace('_', ' ')} record {content_id}.")
    write_store(data)
    return jsonify({"ok": True, "message": "The record was deleted."})


def admin_report_view(report: dict[str, Any], data: dict[str, Any], admin: dict[str, Any]) -> dict[str, Any]:
    reporter = find_user(data, report.get("reporter_id"))
    reported = find_user(data, report.get("reported_user_id"))
    conversation = find_conversation(data, report.get("conversation_id", ""))
    conversation_activity = [
        message_view(item, data, admin) for item in data.get("messages", [])
        if item.get("conversation_id") == report.get("conversation_id")
    ]
    conversation_activity.sort(key=lambda item: item.get("created_at", ""))
    captured_ids = set(report.get("evidence_message_ids") or [])
    evidence = [item for item in conversation_activity if not captured_ids or item.get("id") in captured_ids]
    return {
        **report,
        "reporter": public_member_card(reporter) if reporter else None,
        "reported_user": safe_user(reported, admin_view=True) if reported else None,
        "conversation": conversation_view(conversation, data, admin) if conversation else None,
        "evidence": evidence[-200:],
        "conversation_activity": conversation_activity[-300:],
        "evidence_count": len(evidence[-200:]),
    }


@app.get("/api/admin/message-reports/<report_id>")
@admin_required
def admin_message_report(admin, data, report_id: str):
    report = next((item for item in data.get("message_reports", []) if item.get("id") == report_id), None)
    if not report:
        return json_error("Message report not found.", 404)
    return jsonify({"ok": True, "report": admin_report_view(report, data, admin)})


def admin_dispute_view(dispute: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    user = find_user(data, dispute.get("user_id"))
    counterparty = find_user(data, dispute.get("counterparty_id"))
    entry = next((item for item in data.get("credit_ledger", []) if item.get("id") == dispute.get("ledger_entry_id")), None)
    return {
        **dispute, "ledger_entry": entry,
        "user": safe_user(user, admin_view=True) if user else None,
        "counterparty": safe_user(counterparty, admin_view=True) if counterparty else None,
    }


@app.get("/api/admin/operations")
@admin_required
def admin_operations(admin, data):
    reports = [admin_report_view(item, data, admin) for item in data.get("message_reports", [])]
    reports.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    disputes = [admin_dispute_view(item, data) for item in data.get("credit_disputes", [])]
    disputes.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    activity = []
    for member in data.get("users", []):
        member_messages = [item for item in data.get("messages", []) if item.get("sender_id") == member["id"]]
        member_reports = [item for item in data.get("message_reports", []) if item.get("reported_user_id") == member["id"]]
        member_events = [item for item in data.get("calendar_events", []) if can_access_event(item, member)]
        member_ledger = [item for item in data.get("credit_ledger", []) if item.get("user_id") == member["id"]]
        activity.append({
            "user": safe_user(member, admin_view=True), "messages_sent": len(member_messages),
            "reports_received": len(member_reports), "open_reports": sum(item.get("status") in {"open", "reviewing"} for item in member_reports),
            "calendar_events": len(member_events), "ledger_entries": len(member_ledger),
            "last_message_at": max((item.get("created_at", "") for item in member_messages), default=""),
        })
    return jsonify({
        "ok": True,
        "stats": {
            "conversations": len([item for item in data.get("conversations", []) if item.get("kind") == "direct"]),
            "messages": len(data.get("messages", [])), "open_reports": sum(item.get("status") in {"open", "reviewing"} for item in reports),
            "scheduled_events": sum(item.get("status") == "scheduled" for item in data.get("calendar_events", [])),
            "ledger_entries": len(data.get("credit_ledger", [])), "open_disputes": sum(item.get("status") in {"open", "reviewing"} for item in disputes),
            "blocked_relationships": len(data.get("user_blocks", [])),
        },
        "reports": reports, "disputes": disputes, "activity": activity,
        "events": [event_view(item, data, admin) for item in data.get("calendar_events", [])],
        "ledger": list(reversed(data.get("credit_ledger", [])[-500:])),
    })


@app.patch("/api/admin/message-reports/<report_id>")
@admin_required
def admin_update_message_report(admin, data, report_id: str):
    report = next((item for item in data.get("message_reports", []) if item.get("id") == report_id), None)
    if not report:
        return json_error("Message report not found.", 404)
    payload = request.get_json(silent=True) or {}
    try:
        status = clean_text(payload.get("status", report.get("status", "reviewing")), "Status", 30, required=True).lower()
        action = clean_text(payload.get("action", report.get("action", "pending")), "Action", 30, required=True).lower()
        notes = clean_text(payload.get("admin_notes", report.get("admin_notes", "")), "Administrator notes", 3000)
    except ValueError as exc:
        return json_error(str(exc))
    if status not in {"open", "reviewing", "resolved", "dismissed"}:
        return json_error("Choose a valid report status.")
    if action not in {"pending", "dismissed", "warning", "restricted", "suspended", "restored"}:
        return json_error("Choose a valid moderation action.")
    target = find_user(data, report.get("reported_user_id"))
    if target:
        if action == "warning":
            target["moderation_label"] = "warning"
        elif action == "restricted":
            target["moderation_label"] = "review"
            target["messaging_restricted"] = True
        elif action == "suspended":
            if target.get("role") == "admin":
                return json_error("The primary administrator cannot be suspended here.")
            try:
                deadline = apply_timed_suspension(
                    target,
                    admin,
                    payload,
                    default_reason=f"Moderation report {report_id}: {report.get('category', 'safety review')}",
                )
            except ValueError as exc:
                return json_error(str(exc))
            report["suspended_until"] = deadline
        elif action == "restored":
            clear_account_suspension(target)
            target["messaging_restricted"] = False
            target["moderation_label"] = "none"
        target["updated_at"] = utc_now()
    report.update({"status": status, "action": action, "admin_notes": notes, "reviewed_by": admin["id"], "updated_at": utc_now()})
    reporter = find_user(data, report.get("reporter_id"))
    if reporter:
        add_notification(data, reporter["id"], "report_reviewed", f"An administrator marked your safety report as {status}.", actor_id=admin["id"], extra={"report_id": report_id})
    if target and action in {"warning", "restricted", "suspended", "restored"}:
        action_copy = suspension_message(target) if action == "suspended" else f"A SwapLabs administrator applied this account action: {action}."
        add_notification(data, target["id"], "moderation_action", action_copy, actor_id=admin["id"], extra={"report_id": report_id})
    add_audit(data, admin, "reviewed_message_report", report.get("reported_user_id"), f"Report {report_id}: status={status}; action={action}.")
    write_store(data)
    return jsonify({"ok": True, "report": admin_report_view(report, data, admin)})


@app.patch("/api/admin/messages/<message_id>/moderate")
@admin_required
def admin_moderate_message(admin, data, message_id: str):
    message = next((item for item in data.get("messages", []) if item.get("id") == message_id), None)
    if not message:
        return json_error("Message not found.", 404)
    payload = request.get_json(silent=True) or {}
    status = clean_text(payload.get("status"), "Moderation status", 20, required=True).lower()
    if status not in {"visible", "removed"}:
        return json_error("Moderation status must be visible or removed.")
    try:
        reason = clean_text(payload.get("reason"), "Moderation reason", 1000, required=status == "removed")
    except ValueError as exc:
        return json_error(str(exc))
    if status == "removed" and "original_body" not in message:
        message["original_body"] = message.get("body", "")
    message.update({"moderation_status": status, "moderation_reason": reason, "moderated_by": admin["id"], "moderated_at": utc_now()})
    sender = find_user(data, message.get("sender_id"))
    if sender and status == "removed":
        add_notification(data, sender["id"], "message_moderated", "A message was removed after a safety review. Check your Inbox for account guidance.", actor_id=admin["id"], extra={"message_id": message_id})
    add_audit(data, admin, "moderated_message", message_id, f"Set message visibility to {status}.")
    write_store(data)
    return jsonify({"ok": True, "message": message_view(message, data, admin)})


@app.patch("/api/admin/credit-disputes/<dispute_id>")
@admin_required
def admin_resolve_credit_dispute(admin, data, dispute_id: str):
    dispute = next((item for item in data.get("credit_disputes", []) if item.get("id") == dispute_id), None)
    if not dispute:
        return json_error("Credit dispute not found.", 404)
    if dispute.get("status") in {"resolved", "dismissed"}:
        return json_error("This dispute already has a final decision.", 409)
    payload = request.get_json(silent=True) or {}
    try:
        resolution = clean_text(payload.get("resolution"), "Resolution", 30, required=True).lower()
        notes = clean_text(payload.get("admin_notes"), "Administrator notes", 3000, required=True)
    except ValueError as exc:
        return json_error(str(exc))
    if resolution not in {"approved", "partial", "denied"}:
        return json_error("Resolution must be approved, partial, or denied.")
    source_entry = next((item for item in data.get("credit_ledger", []) if item.get("id") == dispute.get("ledger_entry_id")), None)
    if not source_entry:
        return json_error("The disputed ledger entry no longer exists.", 409)
    maximum_refund = abs(int(source_entry.get("amount", 0)))
    try:
        refund_amount = maximum_refund if resolution == "approved" else int(payload.get("refund_amount", 0))
    except (TypeError, ValueError):
        return json_error("Refund amount must be a whole number.")
    if resolution == "denied":
        refund_amount = 0
    if refund_amount < 0 or refund_amount > maximum_refund or (resolution == "partial" and refund_amount == 0):
        return json_error(f"Refund must be between 1 and {maximum_refund} credits for this decision.")
    claimant = find_user(data, dispute.get("user_id"))
    counterparty = find_user(data, dispute.get("counterparty_id"))
    refund_entry = None
    reversal_entry = None
    if refund_amount and claimant:
        refund_entry = append_credit_entry(
            data, claimant["id"], "refund", refund_amount,
            f"Refund for dispute {dispute_id}", reference_type="dispute", reference_id=dispute_id,
            counterparty_id=counterparty["id"] if counterparty else None, created_by=admin["id"], metadata={"resolution": resolution},
        )
        if counterparty and int(counterparty.get("time_credits", 0)) >= refund_amount:
            reversal_entry = append_credit_entry(
                data, counterparty["id"], "refund_reversal", -refund_amount,
                f"Payment reversed for dispute {dispute_id}", reference_type="dispute", reference_id=dispute_id,
                counterparty_id=claimant["id"], created_by=admin["id"], metadata={"resolution": resolution},
            )
        elif counterparty:
            reversal_entry = append_credit_entry(
                data, counterparty["id"], "correction", 0,
                f"System-funded refund recorded for dispute {dispute_id}", reference_type="dispute", reference_id=dispute_id,
                counterparty_id=claimant["id"], created_by=admin["id"], metadata={"system_funded": True},
            )
    dispute.update({
        "status": "resolved" if resolution != "denied" else "dismissed", "resolution": resolution,
        "refund_amount": refund_amount, "admin_notes": notes, "resolved_by": admin["id"], "updated_at": utc_now(),
    })
    if claimant:
        add_notification(data, claimant["id"], "credit_dispute_resolved", f"Your credit dispute was {resolution}. Refund: {refund_amount} credits.", actor_id=admin["id"], extra={"dispute_id": dispute_id})
    if counterparty:
        add_notification(data, counterparty["id"], "credit_dispute_resolved", f"A payment dispute was {resolution}. Reversal: {refund_amount} credits.", actor_id=admin["id"], extra={"dispute_id": dispute_id})
    add_audit(data, admin, "resolved_credit_dispute", dispute_id, f"Resolution={resolution}; refund={refund_amount}.")
    write_store(data)
    return jsonify({"ok": True, "dispute": admin_dispute_view(dispute, data), "refund_entry": refund_entry, "reversal_entry": reversal_entry})


@app.get("/api/admin/overview")
@admin_required
def admin_overview(admin, data):
    users = data["users"]
    return jsonify({
        "ok": True,
        "stats": {
            "total": len(users),
            "members": sum(user["role"] == "member" for user in users),
            "active": sum(user["status"] == "active" for user in users),
            "suspended": sum(user["status"] == "suspended" for user in users),
            "verified": sum(bool(user.get("verified")) for user in users),
            "credits": sum(int(user.get("time_credits", 0)) for user in users),
            "public_profiles": sum(user.get("preferences", {}).get("profile_visibility", "public") == "public" for user in users),
            "private_profiles": sum(user.get("preferences", {}).get("profile_visibility", "public") == "private" for user in users),
            "accepted_follows": sum(item["status"] == "accepted" for item in data.get("follow_requests", [])),
            "pending_follows": sum(item["status"] == "pending" for item in data.get("follow_requests", [])),
            "direct_conversations": sum(item.get("kind") == "direct" for item in data.get("conversations", [])),
            "messages": len(data.get("messages", [])),
            "open_message_reports": sum(item.get("status") in {"open", "reviewing"} for item in data.get("message_reports", [])),
            "scheduled_events": sum(item.get("status") == "scheduled" for item in data.get("calendar_events", [])),
            "ledger_entries": len(data.get("credit_ledger", [])),
            "open_credit_disputes": sum(item.get("status") in {"open", "reviewing"} for item in data.get("credit_disputes", [])),
            "student_accounts": sum(bool(item.get("safety", {}).get("is_minor")) for item in users),
            "pending_guardian_consents": sum(
                item.get("safety", {}).get("guardian_consent_status") == "pending" for item in users
            ),
            "student_ideas_in_review": sum(
                item.get("status") == "specialist_review" for item in data.get("ideas", [])
            ),
            "video_rooms": len(data.get("video_rooms", [])),
            "confirmed_attendance": sum(
                bool(item.get("participant_confirmed") and item.get("host_confirmed"))
                for item in data.get("video_attendance", [])
            ),
        },
        "users": [safe_user(user, admin_view=True) for user in users],
        "audit_log": data.get("audit_log", [])[:100],
    })


@app.patch("/api/admin/users/<user_id>")
@admin_required
def admin_update_user(admin, data, user_id: str):
    target = find_user(data, user_id)
    if not target:
        return json_error("Account not found.", 404)
    payload = request.get_json(silent=True) or {}
    changes = []
    if "status" in payload:
        status = clean_text(payload["status"], "Status", 20).lower()
        if status not in {"active", "suspended"}:
            return json_error("Status must be active or suspended.")
        if target["id"] == admin["id"] and status != "active":
            return json_error("The primary administrator cannot suspend their own account.")
        if status == "suspended":
            if target.get("role") == "admin":
                return json_error("The primary administrator cannot be suspended.")
            try:
                deadline = apply_timed_suspension(target, admin, payload, default_reason="Administrative account review")
            except ValueError as exc:
                return json_error(str(exc))
            changes.append(f"status=suspended until {deadline}")
        else:
            clear_account_suspension(target)
            changes.append("status=active")
    if "moderation_label" in payload:
        label = clean_text(payload["moderation_label"], "Moderation label", 30).lower()
        if label not in {"none", "review", "trusted", "warning"}:
            return json_error("Unknown moderation label.")
        target["moderation_label"] = label
        changes.append(f"label={label}")
    if "admin_notes" in payload:
        target["admin_notes"] = clean_text(payload["admin_notes"], "Admin notes", 2000)
        changes.append("notes updated")
    if "verified" in payload:
        target["verified"] = bool(payload["verified"])
        changes.append(f"verified={target['verified']}")
    if "time_credits" in payload:
        try:
            credits = int(payload["time_credits"])
        except (TypeError, ValueError):
            return json_error("Time credits must be a whole number.")
        if credits < 0 or credits > 100000:
            return json_error("Time credits must be between 0 and 100,000.")
        append_credit_entry(
            data, target["id"], "correction", credits - int(target.get("time_credits", 0)),
            f"Administrator balance correction to {credits} credits", reference_type="admin_correction",
            reference_id=f"correction_{secrets.token_hex(8)}", created_by=admin["id"],
            metadata={"requested_balance": credits},
        )
        changes.append(f"credits={credits}")
    if "profile" in payload:
        try:
            target["profile"] = validate_profile({"profile": payload["profile"]}, target.get("profile"))
        except ValueError as exc:
            return json_error(str(exc))
        changes.append("profile corrected")
    if not changes:
        return json_error("No supported account changes were supplied.")
    target["updated_at"] = utc_now()
    add_audit(data, admin, "admin_updated_account", target["id"], "; ".join(changes))
    write_store(data)
    return jsonify({"ok": True, "user": safe_user(target, admin_view=True)})


@app.patch("/api/admin/users/<user_id>/guardian-consent")
@admin_required
def admin_guardian_consent(admin, data, user_id: str):
    target = find_user(data, user_id)
    if not target:
        return json_error("Account not found.", 404)
    safety = target.get("safety", {})
    if not safety.get("is_minor"):
        return json_error("Guardian consent applies only to student accounts under 18.")
    payload = request.get_json(silent=True) or {}
    status = clean_text(payload.get("status"), "Guardian consent status", 30, required=True).lower()
    if status not in {"pending", "verified", "rejected"}:
        return json_error("Guardian consent status must be pending, verified, or rejected.")
    if status == "verified" and not safety.get("guardian_consent_declared"):
        return json_error("Guardian consent must be declared before it can be verified.")
    safety["guardian_consent_status"] = status
    safety["guardian_notes"] = clean_text(payload.get("guardian_notes"), "Guardian review notes", 2000)
    safety["guardian_verified_at"] = utc_now() if status == "verified" else None
    safety["guardian_verified_by"] = admin["id"] if status == "verified" else None
    target["safety"] = safety
    target["updated_at"] = utc_now()
    add_notification(
        data, target["id"], "guardian_consent_reviewed",
        f"Your guardian consent status is now {status}.",
        actor_id=admin["id"], extra={"guardian_consent_status": status},
    )
    add_audit(data, admin, "reviewed_guardian_consent", target["id"], f"Set guardian consent to {status}.")
    write_store(data)
    return jsonify({"ok": True, "user": safe_user(target, admin_view=True)})


@app.delete("/api/admin/users/<user_id>")
@admin_required
def admin_delete_user(admin, data, user_id: str):
    target = find_user(data, user_id)
    if not target:
        return json_error("Account not found.", 404)
    if target["role"] == "admin" or target["id"] == admin["id"]:
        return json_error("The primary administrator account cannot be deleted.")
    target_name = target["profile"]["display_name"]
    add_audit(data, admin, "admin_deleted_account", user_id, f"Permanently deleted {target_name}'s member account.")
    purge_user_data(data, target)
    write_store(data)
    return jsonify({"ok": True, "message": f"{target_name}'s account was deleted."})


@app.get("/")
def root_page():
    return redirect("/swaplabs.html")


@app.get("/message-attachments/<attachment_id>")
@login_required
def download_message_attachment(user, data, attachment_id: str):
    if not re.fullmatch(r"attachment_[A-Za-z0-9_-]+", attachment_id):
        return json_error("Attachment not found.", 404)
    message = next((
        item for item in data.get("messages", [])
        if (item.get("attachment") or {}).get("id") == attachment_id
    ), None)
    if not message or message.get("moderation_status") == "removed" and user.get("role") != "admin":
        return json_error("Attachment not found.", 404)
    conversation = find_conversation(data, message.get("conversation_id", ""))
    if not conversation or (user.get("role") != "admin" and not conversation_member(conversation, user["id"])):
        return json_error("Attachment not found.", 404)
    attachment = message["attachment"]
    stored_name = attachment.get("stored_name", "")
    if not re.fullmatch(r"attachment_[A-Za-z0-9_-]+\.(?:jpg|png|webp|pdf|txt|md|csv)", stored_name):
        return json_error("Attachment not found.", 404)
    if not (MESSAGE_UPLOAD_DIR / stored_name).is_file():
        return json_error("Attachment not found.", 404)
    return send_from_directory(
        MESSAGE_UPLOAD_DIR, stored_name, as_attachment=True,
        download_name=attachment.get("name") or stored_name, mimetype=attachment.get("mime"), max_age=0,
    )


@app.get("/uploads/<filename>")
def uploaded_profile_image(filename: str):
    if not re.fullmatch(r"usr_[A-Za-z0-9_-]+\.(jpg|png|webp)", filename):
        return json_error("Image not found.", 404)
    target = UPLOAD_DIR / filename
    if not target.is_file():
        return json_error("Image not found.", 404)
    return send_from_directory(UPLOAD_DIR, filename, max_age=3600)


@app.get("/<path:filename>")
def static_file(filename: str):
    requested = Path(filename)
    if requested.is_absolute() or ".." in requested.parts or requested.suffix.lower() not in ALLOWED_STATIC_EXTENSIONS:
        return json_error("File not found.", 404)
    target = (ROOT / requested).resolve()
    if ROOT not in target.parents or not target.is_file():
        return json_error("File not found.", 404)
    return send_from_directory(ROOT, filename)


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return json_error("Endpoint not found.", 404)
    return redirect("/swaplabs.html")


@app.errorhandler(413)
def request_too_large(_error):
    return json_error("Request is too large.", 413)


@app.errorhandler(ValueError)
def invalid_value(error):
    if request.path.startswith("/api/"):
        return json_error(str(error))
    return redirect("/swaplabs.html")


def main() -> None:
    read_store()
    start_reminder_worker()
    port = int(os.environ.get("SWAPLABS_PORT", "8765"))
    host = os.environ.get("SWAPLABS_HOST", "127.0.0.1")
    print(f"SwapLabs is running at http://{host}:{port}/swaplabs.html")
    print("Press Control-C to stop the server.")
    app.run(host=host, port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()
