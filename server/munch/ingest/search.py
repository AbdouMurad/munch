"""Search nearby restaurants once (no DB):

    uv run python -m munch.ingest.search --lat 49.2827 --lng -123.1207
"""

import argparse
import asyncio
import os
import sys

import httpx

from munch.ingest.places import MAX_RESULTS, search_nearby


async def run(lat: float, lng: float, radius_m: float, api_key: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        places = await search_nearby(client, api_key, lat, lng, radius_m)
    for p in places:
        price = "$" * p.price_level if p.price_level else "-"
        rating = f"{p.rating:.1f}★ ({p.rating_count})" if p.rating else "unrated"
        print(f"{p.name:<40} {rating:<14} {price:<5} {p.primary_type or ''}")
    print(f"\n{len(places)} results", file=sys.stderr)
    if len(places) >= MAX_RESULTS:
        print("Saturated (20): more places exist here; use a smaller radius.", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Search nearby restaurants via Google Places.")
    parser.add_argument("--lat", type=float, default=49.2827)
    parser.add_argument("--lng", type=float, default=-123.1207)
    parser.add_argument("--radius", type=float, default=500, help="metres (max 50000)")
    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_PLACES_API_KEY")
    if not api_key:
        sys.exit("GOOGLE_PLACES_API_KEY is not set (see .env.example)")
    asyncio.run(run(args.lat, args.lng, args.radius, api_key))


if __name__ == "__main__":
    main()
