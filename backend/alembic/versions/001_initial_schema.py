"""initial schema

Revision ID: 001
Revises: 
Create Date: 2025-01-01 00:00:00

This is the baseline migration — represents the initial state
of the database that was previously created by create_all().

For a fresh database: alembic upgrade head
For existing database already set up by create_all():
  alembic stamp head   (marks DB as already at this revision without running it)
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Users
    op.create_table('users',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('email', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=False),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('role', sa.Enum('admin','professor','staff','viewer', name='userrole'), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('email')
    )
    op.create_index('ix_users_email', 'users', ['email'])

    # Resources
    op.create_table('resources',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('resource_type', sa.Enum('classroom','lab','seminar_hall','meeting_room','equipment','other', name='resourcetype'), nullable=False),
        sa.Column('location', sa.String(255), nullable=True),
        sa.Column('capacity', sa.Integer(), nullable=True),
        sa.Column('requires_approval', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_resources_type', 'resources', ['resource_type'])

    # Recurrence rules
    op.create_table('recurrence_rules',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('rrule', sa.String(500), nullable=False),
        sa.Column('start_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_date', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # Events
    op.create_table('events',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('organizer_id', sa.String(), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.Enum('draft','confirmed','cancelled', name='eventstatus'), nullable=False),
        sa.Column('recurrence_rule_id', sa.String(), nullable=True),
        sa.Column('parent_event_id', sa.String(), nullable=True),
        sa.Column('occurrence_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_public', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['organizer_id'], ['users.id']),
        sa.ForeignKeyConstraint(['recurrence_rule_id'], ['recurrence_rules.id']),
        sa.ForeignKeyConstraint(['parent_event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_events_organizer', 'events', ['organizer_id'])
    op.create_index('ix_events_start_time', 'events', ['start_time'])
    op.create_index('ix_events_recurrence', 'events', ['recurrence_rule_id'])

    # Event participants
    op.create_table('event_participants',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('event_id', sa.String(), nullable=False),
        sa.Column('user_id', sa.String(), nullable=False),
        sa.Column('rsvp_status', sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('event_id', 'user_id', name='uq_event_participant')
    )

    # Bookings
    op.create_table('bookings',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('event_id', sa.String(), nullable=False),
        sa.Column('resource_id', sa.String(), nullable=False),
        sa.Column('requester_id', sa.String(), nullable=False),
        sa.Column('start_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_time', sa.DateTime(timezone=True), nullable=False),
        sa.Column('status', sa.Enum('pending','approved','confirmed','rejected','cancelled', name='bookingstatus'), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('reviewed_by_id', sa.String(), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['event_id'], ['events.id']),
        sa.ForeignKeyConstraint(['resource_id'], ['resources.id']),
        sa.ForeignKeyConstraint(['requester_id'], ['users.id']),
        sa.ForeignKeyConstraint(['reviewed_by_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_bookings_resource_time', 'bookings', ['resource_id', 'start_time', 'end_time'])
    op.create_index('ix_bookings_status', 'bookings', ['status'])
    op.create_index('ix_bookings_requester', 'bookings', ['requester_id'])

    # Notifications
    op.create_table('notifications',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('recipient_id', sa.String(), nullable=False),
        sa.Column('notification_type', sa.Enum('booking_confirmed','booking_rejected','booking_pending','booking_cancelled','event_updated','event_cancelled','reminder', name='notificationtype'), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('message', sa.Text(), nullable=False),
        sa.Column('is_read', sa.Boolean(), nullable=False),
        sa.Column('related_booking_id', sa.String(), nullable=True),
        sa.Column('related_event_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['recipient_id'], ['users.id']),
        sa.ForeignKeyConstraint(['related_booking_id'], ['bookings.id']),
        sa.ForeignKeyConstraint(['related_event_id'], ['events.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_notifications_recipient_read', 'notifications', ['recipient_id', 'is_read'])

    # Audit logs
    op.create_table('audit_logs',
        sa.Column('id', sa.String(), nullable=False),
        sa.Column('actor_id', sa.String(), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('entity_type', sa.String(100), nullable=False),
        sa.Column('entity_id', sa.String(255), nullable=False),
        sa.Column('old_values', sa.Text(), nullable=True),
        sa.Column('new_values', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['actor_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_audit_entity', 'audit_logs', ['entity_type', 'entity_id'])
    op.create_index('ix_audit_actor', 'audit_logs', ['actor_id'])
    op.create_index('ix_audit_created', 'audit_logs', ['created_at'])


def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('notifications')
    op.drop_table('bookings')
    op.drop_table('event_participants')
    op.drop_table('events')
    op.drop_table('recurrence_rules')
    op.drop_table('resources')
    op.drop_table('users')
