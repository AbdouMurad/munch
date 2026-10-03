from datetime import UTC, datetime
from pathlib import Path

import pytest

from munch.db.migrate import Applied, MigrationError, checksum, discover, plan


def write(d: Path, name: str, sql: str = "SELECT 1;") -> None:
    (d / name).write_text(sql)


def applied(version: int, name: str, sql: str = "SELECT 1;") -> Applied:
    return Applied(
        version=version,
        name=name,
        checksum=checksum(sql),
        applied_at=datetime(2026, 1, 1, tzinfo=UTC),
        baselined=False,
    )


def test_discover_sorts_by_number(tmp_path: Path) -> None:
    write(tmp_path, "010_later.sql")
    write(tmp_path, "002_second.sql")
    write(tmp_path, "001_init.sql")
    assert [m.label for m in discover(tmp_path)] == ["001_init", "002_second", "010_later"]


def test_discover_rejects_bad_names_and_duplicates(tmp_path: Path) -> None:
    write(tmp_path, "add_users.sql")
    with pytest.raises(MigrationError, match="expected"):
        discover(tmp_path)
    (tmp_path / "add_users.sql").unlink()
    write(tmp_path, "002_a.sql")
    write(tmp_path, "002_b.sql")
    with pytest.raises(MigrationError, match="already used"):
        discover(tmp_path)


def test_plan_skips_applied(tmp_path: Path) -> None:
    write(tmp_path, "001_init.sql")
    write(tmp_path, "002_next.sql")
    pending = plan(discover(tmp_path), {1: applied(1, "init")})
    assert [m.label for m in pending] == ["002_next"]


def test_plan_rejects_edited_migration(tmp_path: Path) -> None:
    write(tmp_path, "001_init.sql", "SELECT 2;")
    with pytest.raises(MigrationError, match="edited after it was applied"):
        plan(discover(tmp_path), {1: applied(1, "init", "SELECT 1;")})


def test_plan_rejects_missing_file(tmp_path: Path) -> None:
    write(tmp_path, "002_next.sql")
    with pytest.raises(MigrationError, match="file is missing"):
        plan(discover(tmp_path), {1: applied(1, "init")})


def test_repo_migrations_are_well_formed() -> None:
    labels = [m.label for m in discover()]
    assert labels[0] == "001_init"
