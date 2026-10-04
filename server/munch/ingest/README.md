# Restaurant crawl

Fills the `restaurants` table from Google Places (Nearby Search, New) by searching a grid of
circles over a bounding box. Run it **once** into the shared Tiger DB; teammates use that DB.

## Before the full crawl

1. **`.env` at the repo root** has both values (never commit it):
   ```
   GOOGLE_PLACES_API_KEY=...
   DATABASE_URL=postgres://tsdbadmin:PASSWORD@HOST:PORT/tsdb?sslmode=require
   ```
2. **Schema is applied** (from `server/`; see [`db/README.md`](../../../db/README.md)):
   ```bash
   uv run python -m munch.db.migrate --status
   uv run python -m munch.db.migrate
   ```
3. **Check the price.** Every call is billed at the Nearby Search *Enterprise* tier (rating,
   review count, price level and hours are in the field mask). Look up the current price per
   1,000 calls and the free monthly allowance on Google's pricing page, and set a budget alert
   in the Google Cloud console.

## Run it

All commands from `server/`, after loading `.env`:

```bash
cd /home/abd/munch/server && set -a && source ../.env && set +a
```

1. Dry run (no calls, shows the starting grid):
   ```bash
   uv run python -m munch.ingest --dry-run
   ```
2. Small test into the DB, a ~1.5 km box at Metrotown. It needs roughly 45 calls to finish,
   so this stops partway, which also tests resume:
   ```bash
   uv run python -m munch.ingest --bbox test --max-requests 20
   psql "$DATABASE_URL" -c "select count(*) from restaurants"
   ```
   Then delete the test resume file so it can't mix with the real run (or pass `--fresh`):
   ```bash
   rm -f crawl_state.json
   ```
3. Full crawl of Vancouver + Burnaby:
   ```bash
   uv run python -m munch.ingest --bbox vanburnaby --max-requests 1000
   ```
   Expect somewhere around 600 to 1,200 calls; the dense areas (downtown, Metrotown, Brentwood,
   Broadway) drive the total. It takes a few minutes.
4. If it stops at the cap, **run the exact same command again**. It resumes from
   `crawl_state.json` and doesn't re-pay for finished cells. When it prints
   `Crawl complete.` the state file is deleted.
5. Check the result:
   ```bash
   psql "$DATABASE_URL" -c "select count(*), count(rating), count(photo_name) from restaurants"
   ```

## Options

| Flag | Default | Meaning |
|---|---|---|
| `--bbox` | `vanburnaby` | `test` (Metrotown), `city`, `vanburnaby`, or `metro` (adds Richmond, North Van) |
| `--max-requests` | 200 | Hard cap on API calls for this run |
| `--concurrency` | 5 | Calls in flight at once (speed only, not cost) |
| `--dry-run` | | Print the grid size, make no calls |
| `--no-db` | | Call the API but write nothing (testing without the DB) |
| `--fresh` | | Ignore `crawl_state.json` and start the bbox over |

Re-running a completed crawl is safe (rows are upserted by place id) but pays for every call
again, so only do it to refresh data.

## How it works

- The bbox is tiled into 1,500 m squares. Each square is searched with the smallest circle
  that covers it.
- Google returns at most 20 places and **trims some after the cap**, so a full circle can come
  back with 19. Any result of 18 or more counts as saturated. (Found by testing: a 915 m
  search at Metrotown returned 19 while smaller circles inside it found dozens more.)
- A saturated square is split into a grid sized from how close the farthest result was:
  dense spots go straight to small cells instead of halving repeatedly. Splits are capped at
  3x3, because density isn't uniform and bigger jumps wasted calls on empty edges.
- Children entirely inside the radius already covered by the results are skipped.
- Below a 40 m search radius a still-saturated cell is logged as "saturated at min radius";
  a few places there may be missed (mall food courts).
- Every result is upserted by Google place id, so overlapping circles never create duplicates.
  The log shows how many were new.

Test run (`--bbox test --no-db --max-requests 40`): 164 restaurants from 40 calls.
