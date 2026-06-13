"""
Group & Roster service (Phase 2)
────────────────────────────────
Manages the "students" side of the app:
  • RosterPerson — a lightweight person (name + optional email)
  • Group        — a named roster (e.g. "First-year CS")
  • membership   — which people are in which group (the group_members junction)

Events later target Groups (event_groups), and clash detection expands
groups → people to decide whether two events share students.

For v1 any logged-in user may manage groups/roster (it's an internal tool);
tighten with role guards later if needed.
"""

from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.modules.models import Group, GroupMember, RosterPerson


# ── Schemas (the JSON shapes) ─────────────────────────────────────────────────

class GroupCreate(BaseModel):
    name: str
    description: Optional[str] = None
    group_type: Optional[str] = None


class GroupOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    group_type: Optional[str] = None
    member_count: int


class RosterPersonCreate(BaseModel):
    full_name: str
    email: Optional[str] = None


class RosterPersonOut(BaseModel):
    id: str
    full_name: str
    email: Optional[str] = None


class GroupDetail(GroupOut):
    members: List[RosterPersonOut]


# ── Service ───────────────────────────────────────────────────────────────────

class GroupService:
    def __init__(self, db: Session):
        self.db = db

    # -- groups ---------------------------------------------------------------
    def list_groups(self) -> List[GroupOut]:
        groups = self.db.query(Group).order_by(Group.name).all()
        out: List[GroupOut] = []
        for g in groups:
            count = self.db.query(GroupMember).filter(GroupMember.group_id == g.id).count()
            out.append(GroupOut(
                id=g.id, name=g.name, description=g.description,
                group_type=g.group_type, member_count=count,
            ))
        return out

    def create_group(self, data: GroupCreate) -> GroupOut:
        g = Group(name=data.name, description=data.description, group_type=data.group_type)
        self.db.add(g)
        self.db.commit()
        self.db.refresh(g)
        return GroupOut(id=g.id, name=g.name, description=g.description,
                        group_type=g.group_type, member_count=0)

    def get_group(self, group_id: str) -> GroupDetail:
        g = self.db.query(Group).filter(Group.id == group_id).first()
        if not g:
            raise HTTPException(status_code=404, detail="Group not found")
        # JOIN group_members -> roster_people to list everyone in the group
        people = (
            self.db.query(RosterPerson)
            .join(GroupMember, GroupMember.roster_person_id == RosterPerson.id)
            .filter(GroupMember.group_id == group_id)
            .order_by(RosterPerson.full_name)
            .all()
        )
        members = [RosterPersonOut(id=p.id, full_name=p.full_name, email=p.email) for p in people]
        return GroupDetail(
            id=g.id, name=g.name, description=g.description, group_type=g.group_type,
            member_count=len(members), members=members,
        )

    def delete_group(self, group_id: str) -> None:
        g = self.db.query(Group).filter(Group.id == group_id).first()
        if not g:
            raise HTTPException(status_code=404, detail="Group not found")
        # relationship cascades delete the group_members + event_groups rows
        self.db.delete(g)
        self.db.commit()

    # -- membership -----------------------------------------------------------
    def add_member(self, group_id: str, roster_person_id: str) -> None:
        if not self.db.query(Group).filter(Group.id == group_id).first():
            raise HTTPException(status_code=404, detail="Group not found")
        if not self.db.query(RosterPerson).filter(RosterPerson.id == roster_person_id).first():
            raise HTTPException(status_code=404, detail="Person not found")
        existing = self.db.query(GroupMember).filter(
            GroupMember.group_id == group_id,
            GroupMember.roster_person_id == roster_person_id,
        ).first()
        if existing:
            return  # idempotent — already a member
        self.db.add(GroupMember(group_id=group_id, roster_person_id=roster_person_id))
        self.db.commit()

    def remove_member(self, group_id: str, roster_person_id: str) -> None:
        m = self.db.query(GroupMember).filter(
            GroupMember.group_id == group_id,
            GroupMember.roster_person_id == roster_person_id,
        ).first()
        if m:
            self.db.delete(m)
            self.db.commit()

    # -- roster people --------------------------------------------------------
    def list_roster(self) -> List[RosterPersonOut]:
        people = self.db.query(RosterPerson).order_by(RosterPerson.full_name).all()
        return [RosterPersonOut(id=p.id, full_name=p.full_name, email=p.email) for p in people]

    def create_roster_person(self, data: RosterPersonCreate) -> RosterPersonOut:
        p = RosterPerson(full_name=data.full_name, email=data.email)
        self.db.add(p)
        self.db.commit()
        self.db.refresh(p)
        return RosterPersonOut(id=p.id, full_name=p.full_name, email=p.email)
