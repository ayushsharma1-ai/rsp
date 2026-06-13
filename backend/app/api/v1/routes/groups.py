"""HTTP routes for group & roster management (Phase 2)."""

from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.modules.auth.service import get_current_user
from app.modules.models import User
from app.modules.groups.service import (
    GroupService, GroupCreate, GroupOut, GroupDetail,
    RosterPersonCreate, RosterPersonOut,
)

router = APIRouter()
groups_router = APIRouter(prefix="/groups", tags=["groups"])
roster_router = APIRouter(prefix="/roster", tags=["roster"])


# ── Groups ────────────────────────────────────────────────────────────────────
@groups_router.get("", response_model=List[GroupOut])
def list_groups(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return GroupService(db).list_groups()


@groups_router.post("", response_model=GroupOut, status_code=201)
def create_group(data: GroupCreate, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    return GroupService(db).create_group(data)


@groups_router.get("/{group_id}", response_model=GroupDetail)
def get_group(group_id: str, db: Session = Depends(get_db),
              current_user: User = Depends(get_current_user)):
    return GroupService(db).get_group(group_id)


@groups_router.delete("/{group_id}", status_code=204)
def delete_group(group_id: str, db: Session = Depends(get_db),
                 current_user: User = Depends(get_current_user)):
    GroupService(db).delete_group(group_id)


@groups_router.post("/{group_id}/members/{person_id}", status_code=204)
def add_member(group_id: str, person_id: str, db: Session = Depends(get_db),
               current_user: User = Depends(get_current_user)):
    GroupService(db).add_member(group_id, person_id)


@groups_router.delete("/{group_id}/members/{person_id}", status_code=204)
def remove_member(group_id: str, person_id: str, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    GroupService(db).remove_member(group_id, person_id)


# ── Roster people ───────────────────────────────────────────────────────────
@roster_router.get("", response_model=List[RosterPersonOut])
def list_roster(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return GroupService(db).list_roster()


@roster_router.post("", response_model=RosterPersonOut, status_code=201)
def create_person(data: RosterPersonCreate, db: Session = Depends(get_db),
                  current_user: User = Depends(get_current_user)):
    return GroupService(db).create_roster_person(data)


router.include_router(groups_router)
router.include_router(roster_router)
