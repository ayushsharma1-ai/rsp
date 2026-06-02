import os
import json
import httpx
from datetime import datetime, timezone
from typing import Optional, List
from fastapi import HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.modules.models import Feedback, FeedbackCategory, User
from app.core.database import SessionLocal


class FeedbackCreate(BaseModel):
    message:   str
    category:  FeedbackCategory = FeedbackCategory.OTHER
    page_url:  Optional[str] = None
    page_name: Optional[str] = None
    browser:   Optional[str] = None


class FeedbackOut(BaseModel):
    id:           str
    message:      str
    category:     str
    page_url:     Optional[str]
    page_name:    Optional[str]
    browser:      Optional[str]
    submitted_at: datetime
    user_name:    Optional[str] = None
    user_role:    Optional[str] = None

    class Config:
        from_attributes = True


# ── Optional: Discord webhook URL from environment ────────────
# Set this in your .env file:
# DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL", "")


def _send_to_discord(feedback: Feedback, user: Optional[User]):
    """
    Sends feedback to a Discord channel via webhook.
    Non-blocking best-effort — never crashes if Discord is unreachable.
    """
    if not DISCORD_WEBHOOK_URL:
        return

    category_emoji = {
        "bug":        "🐛",
        "suggestion": "💡",
        "question":   "❓",
        "other":      "💬",
    }

    emoji    = category_emoji.get(feedback.category.value, "💬")
    username = user.full_name if user else "Anonymous"
    role     = user.role.value if user else "unknown"

    embed = {
        "title":       f"{emoji} {feedback.category.value.upper()} — {feedback.page_name or 'Unknown page'}",
        "description": feedback.message,
        "color":       0x5b6ef5,
        "fields": [
            {"name": "User",    "value": f"{username} ({role})", "inline": True},
            {"name": "Page",    "value": feedback.page_url or "—",  "inline": True},
            {"name": "Browser", "value": feedback.browser or "—",   "inline": True},
        ],
        "footer": {"text": feedback.submitted_at.strftime("%Y-%m-%d %H:%M UTC")},
    }

    try:
        httpx.post(
            DISCORD_WEBHOOK_URL,
            json={"embeds": [embed]},
            timeout=5.0,
        )
    except Exception:
        pass   # never crash the request if Discord is down


class FeedbackService:
    def __init__(self, db: Session):
        self.db = db

    def submit(self, data: FeedbackCreate, actor: Optional[User]) -> Feedback:
        if not data.message.strip():
            raise HTTPException(status_code=400, detail="Message cannot be empty")

        if len(data.message) > 2000:
            raise HTTPException(status_code=400, detail="Message too long (max 2000 chars)")

        fb = Feedback(
            user_id      = actor.id if actor else None,
            message      = data.message.strip(),
            category     = data.category,
            page_url     = data.page_url,
            page_name    = data.page_name,
            browser      = data.browser,
        )
        self.db.add(fb)
        self.db.commit()
        self.db.refresh(fb)

        # Send to Discord in background (best effort)
        _send_to_discord(fb, actor)

        return fb

    def list_all(self, limit: int = 100) -> List[dict]:
        """Admin only — read all feedback with user details."""
        rows = (
            self.db.query(Feedback, User)
            .outerjoin(User, Feedback.user_id == User.id)
            .order_by(Feedback.submitted_at.desc())
            .limit(limit)
            .all()
        )
        result = []
        for fb, user in rows:
            result.append({
                "id":           fb.id,
                "message":      fb.message,
                "category":     fb.category.value,
                "page_url":     fb.page_url,
                "page_name":    fb.page_name,
                "browser":      fb.browser,
                "submitted_at": fb.submitted_at.isoformat(),
                "user_name":    user.full_name if user else "Anonymous",
                "user_role":    user.role.value if user else None,
                "user_email":   user.email if user else None,
            })
        return result