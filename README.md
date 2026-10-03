# munch

Tinder for food. Make a room, share the code, everyone swipes on nearby restaurants, and the
first place everybody likes wins.

| Part | What | Instructions |
|---|---|---|
| `server/` | Python backend (FastAPI, WebSockets) | [`server/README.md`](server/README.md) |
| `frontend/` | Expo / React Native app | [`frontend/README.md`](frontend/README.md) |
| `db/` | Postgres schema migrations (Tiger Cloud) | [`db/README.md`](db/README.md) |
| `server/munch/ingest/` | Google Places restaurant crawler | [`server/munch/ingest/README.md`](server/munch/ingest/README.md) |
| `docs/DESIGN.md` | Architecture, API and DB contracts | Read this first |

## Quick start

```bash
# 1. secrets: copy and fill in (ask the team for values)
cp .env.example .env

# 2. server (needs uv: brew install uv)
cd server && uv sync && uv run uvicorn munch.main:app --reload --port 8000

# 3. app, in another terminal
cd frontend && npm install && npx expo start
```

The server runs without a database (fixture restaurants), so steps 2 and 3 work before anyone
has Tiger access. To use the real DB, set `DATABASE_URL` and apply migrations
([`db/README.md`](db/README.md)).
