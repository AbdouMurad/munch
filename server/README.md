# Munch server

The whole backend: Python 3.12+, FastAPI, WebSockets, Pydantic v2, asyncpg, managed with `uv`.
Architecture and contracts: [`docs/DESIGN.md`](../docs/DESIGN.md).

## Setup

1. Install [uv](https://docs.astral.sh/uv/): `brew install uv`
2. Install dependencies (from `server/`): `uv sync`
3. Create `.env` at the **repo root** (copy `.env.example`; never commit it):

   | Variable | Needed for |
   |---|---|
   | `DATABASE_URL` | Real restaurants, ranking, migrations. Leave empty to run with fixture data |
   | `GOOGLE_PLACES_API_KEY` | The crawl and the photo proxy only |
   | `WEB_ORIGIN` | CORS. `http://localhost:8081` for Expo web |
   | `GOOGLE_CLIENT_IDS` | Google sign-in: your OAuth client ids, comma-separated |

## Run

```bash
cd server
uv run uvicorn munch.main:app --reload --port 8000
```

Check it: <http://localhost:8000/api/health> returns `{"ok":true}`, and
<http://localhost:8000/docs> lists every endpoint.

- **Without `DATABASE_URL`** it still works end to end: rooms live in memory and decks come
  from 36 made-up Vancouver restaurants (`munch/rooms/fixture_restaurants.json`).
- **Testing from a phone**: add `--host 0.0.0.0`, then point the app at your computer's LAN
  address (see [`frontend/README.md`](../frontend/README.md)).
- Run **one worker only**; live rooms are in memory.

## Before you push

```bash
uv run pytest            # tests
uv run ruff check .      # lint
uv run ruff format .     # format
uv run mypy munch tests  # types (strict)
```

All four must pass. Pure logic (matching, scoring, grid maths) gets a test.

The account tests (`tests/test_accounts_db.py`) need a Postgres they can create a throwaway
`munch_test` database on, and are skipped otherwise. **Never point this at the shared Tiger
DB.** A local Postgres works, e.g. `brew install postgresql@16`, then:

```bash
MUNCH_TEST_DATABASE_URL=postgresql://localhost/postgres uv run pytest
```

## Other commands

| Command | What it does | Docs |
|---|---|---|
| `uv run python -m munch.db.migrate` | Apply pending DB migrations (`--status`, `--baseline N`) | [`db/README.md`](../db/README.md) |
| `uv run python -m munch.ingest --dry-run` | Crawl restaurants from Google into the DB. **Costs money**, dry-run first | [`munch/ingest/README.md`](munch/ingest/README.md) |
| `uv run python -m munch.ranking --count 15` | Print a ranked deck from the DB (`--price`, `--type`, `--open-now`, ...) | `munch/ranking/__main__.py` |

## Layout

| Path | What's there |
|---|---|
| `munch/models.py` | **The contract**: every REST body and WebSocket message. Change it only together with DESIGN.md §5 |
| `munch/main.py` | App setup, error handling, `/api/health` |
| `munch/config.py` | Settings from `.env` (timeouts, ranking weights) |
| `munch/routes/` | REST endpoints (`/api/rooms`, `/auth`, `/me`, `/friends`, invites) |
| `munch/accounts/` | Sign-in (Google, email codes), sessions, friends, invites, all account SQL |
| `munch/realtime/` | `/ws/{code}` room socket, `/ws/me` per-user socket, broadcasting, sweeper |
| `munch/rooms/` | In-memory rooms and match logic, fixture deck |
| `munch/ranking/` | Candidate query and scoring |
| `munch/ingest/` | Google Places crawler |
| `munch/db/` | Migration runner |
| `tests/` | pytest |
