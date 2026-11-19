"""Unit tests for the deleted-schedule tombstones (in-memory SQLite, no infra)."""

import sqlite3
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine

from backend.executor.schedule_tombstones import ScheduleTombstones

_TTL_SECONDS = 7 * 24 * 3600


def _tombstones() -> ScheduleTombstones:
    connection = sqlite3.connect(":memory:")
    connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
    tombstones = ScheduleTombstones(
        create_engine("sqlite://", creator=lambda: connection)
    )
    tombstones.ensure_table()
    return tombstones


def _days_ago(days: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def test_record_makes_a_key_deleted():
    tombstones = _tombstones()

    tombstones.record("k1", "user-1", ttl_seconds=_TTL_SECONDS)

    assert tombstones.is_deleted("k1")


def test_an_unknown_key_is_not_deleted():
    tombstones = _tombstones()

    assert not tombstones.is_deleted("k1")


def test_a_tombstone_inside_its_ttl_is_deleted():
    tombstones = _tombstones()

    tombstones.record("k1", "user-1", ttl_seconds=_TTL_SECONDS, deleted_at=_days_ago(6))

    assert tombstones.is_deleted("k1")


def test_an_expired_tombstone_is_not_deleted():
    tombstones = _tombstones()

    tombstones.record("k1", "user-1", ttl_seconds=_TTL_SECONDS, deleted_at=_days_ago(8))

    assert not tombstones.is_deleted("k1")


def test_recording_again_refreshes_the_tombstone():
    tombstones = _tombstones()
    tombstones.record("k1", "user-1", ttl_seconds=_TTL_SECONDS, deleted_at=_days_ago(8))
    assert not tombstones.is_deleted("k1")

    tombstones.record("k1", "user-1", ttl_seconds=_TTL_SECONDS)

    assert tombstones.is_deleted("k1")


def test_prune_expired_removes_only_expired_rows():
    tombstones = _tombstones()
    tombstones.record("live", "user-1", ttl_seconds=_TTL_SECONDS)
    tombstones.record(
        "stale", "user-1", ttl_seconds=_TTL_SECONDS, deleted_at=_days_ago(8)
    )

    removed = tombstones.prune_expired()

    assert removed == 1
    assert tombstones.is_deleted("live")
    assert not tombstones.is_deleted("stale")
