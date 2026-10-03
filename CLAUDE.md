# Munch

Tinder-for-food hackathon app. **Read [docs/DESIGN.md](docs/DESIGN.md) before doing anything.** It defines the architecture, API and WebSocket contracts, DB schema, ingest algorithm, ranking, and who owns which directory.

- **Backend is Python only** (FastAPI, asyncpg, Pydantic v2, managed with `uv`) in `server/`. Frontend is React in `web/`.
- The contract is `server/munch/models.py`. Frontend types are generated from it (`make contracts`); never hand-edit `web/src/lib/generated/`.
- Stay inside your workstream's directories (DESIGN.md §11).
- Schema changes go in a new numbered file in `db/migrations/`.
- Never commit `.env` or call Google Places outside `server/munch/ingest` and the photo proxy.
- `mypy --strict` and `ruff` must pass; pure logic gets a pytest test.
