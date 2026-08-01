from typing import List
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user, require_admin
from app.modules.models import User
from app.modules.feedback.service import FeedbackService, FeedbackCreate

router = APIRouter(prefix="/feedback", tags=["feedback"])


@router.post("", status_code=201)
def submit_feedback(
    data: FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # anonymous: login is still required (spam guard), but the identity is dropped
    # HERE, before the service layer — nothing downstream ever sees who sent it.
    fb = FeedbackService(db).submit(data, None if data.anonymous else current_user)
    return {"id": fb.id, "message": "Feedback submitted. Thank you!"}


@router.get("", dependencies=[Depends(require_admin)])
def list_feedback(
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return FeedbackService(db).list_all(limit=limit)