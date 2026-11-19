"""Durable record of schedules deleted under an idempotent create key.

A create whose answer was lost is retried under the same key. If the
schedule was deleted between the lost answer and the retry, the retry
finds no job under its key and would make a second schedule — so the
delete leaves a tombstone, and a retry under a tombstoned key gets a 409
instead. The tombstone is a row in the jobstore database, not process
memory: a restart, or another replica, remembers it too.

The table is owned and auto-created by the scheduler service over the
same SQLAlchemy engine as the jobstore itself — mirroring how APScheduler
manages ``apscheduler_jobs`` and how ``schedule_index.py`` owns its
sidecar — rather than via Prisma, which the scheduler process never
connects to. It is a NEW table, so ``create_all(checkfirst=True)`` makes
it; no migration of an existing table is needed.

A tombstone lives for seven days (``_DELETED_SCHEDULE_KEY_TTL_SECONDS``
in ``scheduler.py``), which bounds the frontend's retry window: the
create key it answers lives in sessionStorage, so a tab closing already
ends it well inside that. Expiry is enforced on every read, and expired
rows are pruned by the scheduler's reconcile (startup + daily).

Concurrency: the scheduler serializes a delete's tombstone-write +
job-remove against a replay's tombstone-check + job-lookup with one
in-process lock, and the delete writes the tombstone before removing the
job. Two replicas can still interleave a delete and a retry in the same
millisecond — the retry then makes one schedule, which its own listing
shows, and the tombstone blocks any further retry under the key; the
owner deletes it again and it stays deleted. That window is a single
commit, not the whole retry window.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import Column, DateTime, MetaData, String, Table, delete, insert, select
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Matches APScheduler's default id column length so every job id that fits
# the jobstore fits the tombstones.
_JOB_ID_LENGTH = 191


class ScheduleTombstones:
    def __init__(self, engine: Engine, schema: str | None = None):
        self._engine = engine
        self._metadata = MetaData(schema=schema)
        self._table = Table(
            "apscheduler_jobs_deleted_keys",
            self._metadata,
            Column("schedule_id", String(_JOB_ID_LENGTH), primary_key=True),
            Column("user_id", String, nullable=False, index=True),
            Column("deleted_at", DateTime(timezone=True), nullable=False),
            Column("expires_at", DateTime(timezone=True), nullable=False, index=True),
        )

    def ensure_table(self) -> None:
        """Create the table if missing (same auto-DDL model as APScheduler)."""
        self._metadata.create_all(self._engine, checkfirst=True)

    def record(
        self,
        schedule_id: str,
        user_id: str,
        *,
        ttl_seconds: int,
        deleted_at: datetime | None = None,
    ) -> None:
        """Remember a delete: a retry under this key is refused until the
        TTL passes. Recording again replaces the row, so a key deleted,
        reused after expiry and deleted again starts a fresh TTL."""
        deleted = deleted_at or datetime.now(timezone.utc)
        row = {
            "schedule_id": schedule_id,
            "user_id": user_id,
            "deleted_at": deleted,
            "expires_at": deleted + timedelta(seconds=ttl_seconds),
        }
        with self._engine.begin() as conn:
            conn.execute(
                delete(self._table).where(self._table.c.schedule_id == schedule_id)
            )
            conn.execute(insert(self._table), [row])

    def is_deleted(self, schedule_id: str) -> bool:
        """Whether a live (unexpired) tombstone holds this key."""
        now = datetime.now(timezone.utc)
        with self._engine.connect() as conn:
            return (
                conn.execute(
                    select(self._table.c.schedule_id).where(
                        self._table.c.schedule_id == schedule_id,
                        self._table.c.expires_at > now,
                    )
                ).scalar()
                is not None
            )

    def prune_expired(self) -> int:
        """Drop tombstones past their TTL; returns how many went."""
        now = datetime.now(timezone.utc)
        with self._engine.begin() as conn:
            result = conn.execute(
                delete(self._table).where(self._table.c.expires_at <= now)
            )
            return result.rowcount
