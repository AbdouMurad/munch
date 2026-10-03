# Database migrations

The schema lives in `migrations/` as numbered SQL files, applied in order to the Tiger Cloud
Postgres (PostGIS + TimescaleDB). A runner applies each file **exactly once** and records it in
the `schema_migrations` table.

| File | Creates |
|---|---|
| `001_init.sql` | `restaurants` (filled by the crawl) |
| `002_rooms_swipe_events.sql` | `rooms`, `room_members`, the `swipe_events` hypertable, the daily popularity aggregate |
| `003_accounts.sql` | `users`, sign-in (`auth_identities`, `sessions`, `email_login_codes`), `user_preferences`, `friendships`, `blocks`, per-user `swipes` |

## Setup

1. Install [uv](https://docs.astral.sh/uv/): `brew install uv`
2. Put the connection string in `.env` at the **repo root** (ask the team; never commit it):
   ```
   DATABASE_URL=postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require
   ```

All commands below run from `server/`.

## Apply migrations

```bash
cd server
uv run python -m munch.db.migrate --status   # what's applied, what's pending
uv run python -m munch.db.migrate            # apply everything pending, in order
```

Each file runs in its own transaction with its `schema_migrations` row. If one fails, it is
rolled back completely, the error is printed, and later files are not run. Fix it and run again.

### First run on a DB that already has tables

If the DB was set up by hand before the runner existed (our Tiger DB already has `001`), mark
those files as applied **without running them**, then migrate as normal:

```bash
uv run python -m munch.db.migrate --baseline 1
uv run python -m munch.db.migrate
```

A brand-new empty DB doesn't need this; plain `migrate` runs everything from `001`.

## Add a migration

1. Create the next number: `migrations/004_short_name.sql` (lowercase, underscores).
2. Write plain SQL. Don't add `BEGIN`/`COMMIT`; the runner wraps the file in a transaction.
3. Run `uv run python -m munch.db.migrate`.
4. Commit the file in the same PR as the code that needs it, and tell the team to migrate.

## Rules

- **Never edit a migration that has been applied anywhere.** The runner stores each file's
  checksum and refuses to run if an applied file changed. Put fixes in a new migration.
- **Never reuse a number.** Two people adding `004` at once: whoever merges second renumbers.
- **Never delete an applied file.** The runner stops if one is missing.
- Only one person needs to migrate the shared DB; a lock stops two runs overlapping.

## Troubleshooting

| Error | Meaning |
|---|---|
| `DATABASE_URL is not set` | No `.env` at the repo root, or the variable is empty |
| `relation "restaurants" already exists` | The DB already has `001`; run `--baseline 1` first |
| `... was edited after it was applied` | Undo your edit to that file and make a new migration |
| `... is applied but its file is missing` | Someone deleted or renamed an applied file; restore it |
| `expected NNN_lowercase_name.sql` | A file in `migrations/` has the wrong name format |
