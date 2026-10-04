"""Apply `db/migrations/NNN_name.sql` files in order, each exactly once.

    uv run python -m munch.db.migrate              # apply pending migrations
    uv run python -m munch.db.migrate --status     # list applied / pending, change nothing
    uv run python -m munch.db.migrate --baseline 1 # record 001 as applied without running it

Applied versions are recorded in `schema_migrations`. Each file runs in its own transaction
together with its bookkeeping row, so a failing migration leaves no trace. A checksum of each
applied file is stored; if an applied file is later edited, the runner refuses to continue
(add a new migration instead, DESIGN.md §12).
"""

import argparse
import asyncio
import hashlib
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import asyncpg

from munch.config import REPO_ROOT, get_settings

MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
FILENAME_RE = re.compile(r"^(\d+)_([a-z0-9_]+)\.sql$")
LOCK_KEY = 0x6D756E6368  # "munch": one migrator at a time

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     integer PRIMARY KEY,
  name        text NOT NULL,
  checksum    text NOT NULL,          -- sha256 of the file, to catch edits after applying
  applied_at  timestamptz NOT NULL DEFAULT now(),
  baselined   boolean NOT NULL DEFAULT false  -- recorded by --baseline, not actually run
)
"""


class MigrationError(Exception):
    pass


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    path: Path
    checksum: str

    @property
    def label(self) -> str:
        return f"{self.version:03d}_{self.name}"


@dataclass(frozen=True)
class Applied:
    version: int
    name: str
    checksum: str
    applied_at: datetime
    baselined: bool


def checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode()).hexdigest()


def discover(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """All migration files, sorted by version. Rejects bad names and duplicate versions."""
    migrations: dict[int, Migration] = {}
    for path in sorted(directory.glob("*.sql")):
        m = FILENAME_RE.match(path.name)
        if m is None:
            raise MigrationError(f"{path.name}: expected NNN_lowercase_name.sql")
        version = int(m.group(1))
        if version in migrations:
            raise MigrationError(
                f"{path.name}: version {version} already used by {migrations[version].path.name}"
            )
        migrations[version] = Migration(
            version=version, name=m.group(2), path=path, checksum=checksum(path.read_text())
        )
    return [migrations[v] for v in sorted(migrations)]


def plan(migrations: list[Migration], applied: dict[int, Applied]) -> list[Migration]:
    """Migrations still to run. Fails if an applied file was edited or has gone missing."""
    by_version = {m.version: m for m in migrations}
    for version, row in applied.items():
        current = by_version.get(version)
        if current is None:
            raise MigrationError(f"{version:03d}_{row.name} is applied but its file is missing")
        if current.checksum != row.checksum:
            raise MigrationError(
                f"{current.label} was edited after it was applied. "
                "Revert the edit and put the change in a new migration."
            )
    return [m for m in migrations if m.version not in applied]


async def load_applied(conn: asyncpg.Connection) -> dict[int, Applied]:
    rows = await conn.fetch(
        "SELECT version, name, checksum, applied_at, baselined FROM schema_migrations"
    )
    return {r["version"]: Applied(**dict(r)) for r in rows}


async def record(conn: asyncpg.Connection, m: Migration, *, baselined: bool) -> None:
    await conn.execute(
        "INSERT INTO schema_migrations (version, name, checksum, baselined)"
        " VALUES ($1, $2, $3, $4)",
        m.version,
        m.name,
        m.checksum,
        baselined,
    )


async def run(dsn: str, *, status: bool, baseline: int | None) -> None:
    migrations = discover()
    conn = await asyncpg.connect(dsn)
    try:
        await conn.execute(CREATE_TABLE)
        await conn.execute("SELECT pg_advisory_lock($1)", LOCK_KEY)
        try:
            applied = await load_applied(conn)
            pending = plan(migrations, applied)

            if status:
                for m in migrations:
                    row = applied.get(m.version)
                    if row is None:
                        print(f"  pending   {m.label}")
                    else:
                        how = "baselined" if row.baselined else "applied  "
                        print(f"  {how} {m.label}  ({row.applied_at:%Y-%m-%d %H:%M})")
                return

            if baseline is not None:
                to_mark = [m for m in pending if m.version <= baseline]
                if not to_mark:
                    print(f"Nothing to baseline: no pending migrations at or below {baseline}.")
                for m in to_mark:
                    await record(conn, m, baselined=True)
                    print(f"  baselined {m.label} (recorded, not run)")
                return

            if not pending:
                print("Up to date.")
                return
            for m in pending:
                print(f"  applying  {m.label} ...", end=" ", flush=True)
                async with conn.transaction():
                    await conn.execute(m.path.read_text())
                    await record(conn, m, baselined=False)
                print("done")
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", LOCK_KEY)
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply pending db/migrations in order.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--status", action="store_true", help="show applied/pending and exit")
    group.add_argument(
        "--baseline",
        type=int,
        metavar="N",
        help="record migrations up to N as applied without running them "
        "(for a DB that already has them)",
    )
    args = parser.parse_args()

    dsn = get_settings().database_url
    if not dsn:
        sys.exit("DATABASE_URL is not set (see .env.example)")
    try:
        asyncio.run(run(dsn, status=args.status, baseline=args.baseline))
    except MigrationError as e:
        sys.exit(f"error: {e}")
    except asyncpg.PostgresError as e:
        sys.exit(f"migration failed and was rolled back: {e}")


if __name__ == "__main__":
    main()
