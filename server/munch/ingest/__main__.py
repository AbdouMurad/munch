"""Adaptive grid crawl of restaurants into the DB (DESIGN.md §7). See README.md here.

    uv run python -m munch.ingest --bbox vanburnaby --dry-run
    uv run python -m munch.ingest --bbox vanburnaby --max-requests 200
"""

import argparse
import asyncio
import os
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path

import asyncpg
import httpx

from munch.ingest.grid import (
    BBOXES,
    Cell,
    cell_radius_m,
    distance_m,
    inside_disk,
    split_cell,
    split_dims,
    tile_bbox,
)
from munch.ingest.places import Place, search_nearby
from munch.ingest.state import load_pending, save_pending
from munch.ingest.store import upsert_places

# Google trims some results after applying its 20 cap, so a full circle can come back with
# 19 (seen at Metrotown: a 915 m search returned 19 while smaller circles inside it found
# dozens more). Treat anything this close to the cap as saturated.
SATURATED_AT = 18
INITIAL_CELL_M = 1500
MIN_RADIUS_M = 40  # mall food courts still saturate at ~100 m
# Only trust 90% of the 20th result's distance as fully covered (ties, rounding).
COVERED_MARGIN = 0.9
STATE_FILE = Path("crawl_state.json")


@dataclass
class Stats:
    requests: int = 0
    new: int = 0
    seen: set[str] = field(default_factory=set)
    split: int = 0
    skipped: int = 0
    dense: list[Cell] = field(default_factory=list)
    failed: list[Cell] = field(default_factory=list)


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def children_of(cell: Cell, places: list[Place], stats: Stats) -> list[Cell] | None:
    """Cells to search next for a saturated cell, or None if it's at minimum size."""
    center = cell.center
    covered = max(distance_m(center, (p.lat, p.lng)) for p in places)
    dims = split_dims(cell, covered, len(places), MIN_RADIUS_M)
    if dims is None:
        return None
    kids = split_cell(cell, *dims)
    # Every place nearer than the 20th result was returned, so children inside that
    # disk are already fully crawled.
    keep = [k for k in kids if not inside_disk(k, center, covered * COVERED_MARGIN)]
    stats.skipped += len(kids) - len(keep)
    return keep


async def crawl(
    cells: list[Cell],
    *,
    bbox: str,
    client: httpx.AsyncClient,
    api_key: str,
    pool: asyncpg.Pool | None,
    max_requests: int,
    concurrency: int,
) -> tuple[Stats, list[Cell]]:
    """Search cells, splitting saturated ones. Returns stats and cells left unsearched."""
    stats = Stats()
    queue = deque(cells)
    tasks: dict[asyncio.Task[list[Place]], Cell] = {}

    while queue or tasks:
        while queue and len(tasks) < concurrency and stats.requests < max_requests:
            cell = queue.popleft()
            lat, lng = cell.center
            search = search_nearby(client, api_key, lat, lng, cell_radius_m(cell))
            tasks[asyncio.create_task(search)] = cell
            stats.requests += 1
        if not tasks:
            break

        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            cell = tasks.pop(task)
            lat, lng = cell.center
            where = f"d{cell.depth} {lat:.4f},{lng:.4f} r={cell_radius_m(cell):.0f}m"
            try:
                places = task.result()
            except httpx.HTTPError as e:
                stats.failed.append(cell)
                log(f"[{stats.requests:>4}/{max_requests}] {where}  FAILED: {e}")
                continue

            if pool is not None:
                new = await upsert_places(pool, places)
            else:
                new = len({p.id for p in places} - stats.seen)
            stats.new += new
            stats.seen.update(p.id for p in places)

            if len(places) >= SATURATED_AT:
                kids = children_of(cell, places, stats)
                if kids is None:
                    stats.dense.append(cell)
                    outcome = "saturated at min radius (some may be missed)"
                else:
                    queue.extend(kids)
                    stats.split += 1
                    outcome = f"saturated -> {len(kids)} smaller cells"
            else:
                outcome = "done"
            log(
                f"[{stats.requests:>4}/{max_requests}] {where}  {len(places):>2} found "
                f"(+{new} new)  {outcome}  | queue {len(queue)} | "
                f"total {stats.new} new, {len(stats.seen)} seen"
            )
            save_pending(STATE_FILE, bbox, [*queue, *tasks.values(), *stats.failed])

    return stats, [*queue, *stats.failed]


async def run(args: argparse.Namespace) -> None:
    resumed = None if args.fresh else load_pending(STATE_FILE, args.bbox)
    if resumed is not None:
        cells = resumed
        log(f"Resuming {args.bbox}: {len(cells)} cells left from {STATE_FILE} (--fresh to restart)")
    else:
        cells = tile_bbox(BBOXES[args.bbox], INITIAL_CELL_M)
        log(f"bbox {args.bbox}: {len(cells)} initial cells of {INITIAL_CELL_M} m")
    if args.dry_run:
        log(
            f"Dry run: at least {len(cells)} requests; saturated cells add more. "
            f"Cap is --max-requests {args.max_requests}. No calls made."
        )
        return

    api_key = os.environ.get("GOOGLE_PLACES_API_KEY")
    dsn = os.environ.get("DATABASE_URL")
    if not api_key:
        sys.exit("GOOGLE_PLACES_API_KEY must be set (source ../.env)")
    if not args.no_db and not dsn:
        sys.exit("DATABASE_URL must be set (source ../.env), or pass --no-db")

    started = time.monotonic()
    async with httpx.AsyncClient(timeout=20) as client:
        pool = (
            None
            if args.no_db
            else await asyncpg.create_pool(dsn, min_size=1, max_size=args.concurrency)
        )
        try:
            stats, leftover = await crawl(
                cells,
                bbox=args.bbox,
                client=client,
                api_key=api_key,
                pool=pool,
                max_requests=args.max_requests,
                concurrency=args.concurrency,
            )
            total = await pool.fetchval("SELECT count(*) FROM restaurants") if pool else None
        finally:
            if pool is not None:
                await pool.close()

    log(
        f"\nDone in {time.monotonic() - started:.0f}s: {stats.requests} requests, "
        f"{len(stats.seen)} restaurants seen, {stats.new} new"
        + (f", {total} now in DB" if total is not None else " (--no-db, nothing written)")
    )
    log(
        f"split {stats.split}, children skipped as already covered {stats.skipped}, "
        f"dense {len(stats.dense)}, failed {len(stats.failed)}"
    )
    if leftover:
        log(f"{len(leftover)} cells left. Re-run the same command to resume from {STATE_FILE}.")
    else:
        STATE_FILE.unlink(missing_ok=True)
        log("Crawl complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Crawl restaurants into the DB.")
    parser.add_argument("--bbox", choices=sorted(BBOXES), default="vanburnaby")
    parser.add_argument("--max-requests", type=int, default=200, help="hard cap on API calls")
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--dry-run", action="store_true", help="count cells, call nothing")
    parser.add_argument("--no-db", action="store_true", help="call the API but don't write")
    parser.add_argument("--fresh", action="store_true", help="ignore the resume file")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
