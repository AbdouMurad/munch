"""Try deck building against the DB:

uv run python -m munch.ranking --lat 49.2276 --lng -123.0003 --count 15
uv run python -m munch.ranking --price 1 2 --type sushi_restaurant --open-now --min-rating 4.3
"""

import argparse
import asyncio
import random
import sys

import asyncpg

from munch.config import get_settings
from munch.models import Filters, LatLng
from munch.ranking.deck import build_deck


async def run(args: argparse.Namespace) -> None:
    settings = get_settings()
    if not settings.database_url:
        sys.exit("DATABASE_URL must be set in the repo-root .env")
    settings = settings.model_copy(update={"deck_size": args.count})
    filters = Filters(
        price_levels=args.price,
        include_unknown_price=not args.known_price,
        include_types=args.type,
        exclude_types=args.exclude,
        min_rating=args.min_rating,
        min_reviews=args.min_reviews,
        open_now=args.open_now,
    )
    seed = args.seed if args.seed is not None else random.randrange(2**31)
    center = LatLng(lat=args.lat, lng=args.lng)
    async with asyncpg.create_pool(settings.database_url, min_size=1, max_size=2) as pool:
        deck = await build_deck(pool, center, args.radius, filters, seed, settings)
    for i, c in enumerate(deck, 1):
        rating = f"{c.rating:.1f}★ ({c.rating_count})" if c.rating else "unrated"
        price = "$" * c.price_level if c.price_level else "?"
        print(
            f"{i:>3}. {c.name[:34]:<34} {rating:<15} {price:<4} {c.distance_m:>5.0f} m  "
            f"{c.primary_type or ''}"
        )
    print(f"\n{len(deck)} cards, seed {seed}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a deck near a point.")
    parser.add_argument("--lat", type=float, default=49.2276)
    parser.add_argument("--lng", type=float, default=-123.0003)
    parser.add_argument("--radius", type=int, default=3000, help="metres")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--seed", type=int, default=None, help="repeat an exact order")
    parser.add_argument("--price", type=int, nargs="+", default=None, help="levels 0-4")
    parser.add_argument("--known-price", action="store_true", help="drop places with no price")
    parser.add_argument("--type", nargs="+", default=[], help="e.g. sushi_restaurant")
    parser.add_argument("--exclude", nargs="+", default=[], help="e.g. fast_food_restaurant")
    parser.add_argument("--min-rating", type=float, default=None)
    parser.add_argument("--min-reviews", type=int, default=0)
    parser.add_argument("--open-now", action="store_true")
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
