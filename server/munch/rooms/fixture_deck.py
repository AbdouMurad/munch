"""Stub deck builder backed by fictional restaurants, so rooms work without a DB (DESIGN.md §11).

Swap in the real PostGIS + scoring `build_deck` from `munch.ranking` once Tiger is up; the
signature is the interface.
"""

import json
import math
import random
from functools import cache
from pathlib import Path
from typing import Any, Protocol

from munch.models import Card, Filters, LatLng

FIXTURE_PATH = Path(__file__).with_name("fixture_restaurants.json")
EARTH_RADIUS_M = 6_371_000

NO_EXCLUDE: frozenset[str] = frozenset()


class DeckBuilder(Protocol):
    """Builds a room's deck. `exclude` holds restaurant ids that must not be dealt (the
    cards already in the deck, when the host searches farther mid-game)."""

    async def __call__(
        self,
        center: LatLng,
        radius_m: int,
        filters: Filters,
        seed: int,
        exclude: frozenset[str] = NO_EXCLUDE,
    ) -> list[Card]: ...


@cache
def load_fixtures() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = json.loads(FIXTURE_PATH.read_text())
    return rows


def haversine_m(a: LatLng, b: LatLng) -> float:
    dlat = math.radians(b.lat - a.lat)
    dlng = math.radians(b.lng - a.lng)
    h = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(a.lat)) * math.cos(math.radians(b.lat)) * math.sin(dlng / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def matches_filters(row: dict[str, Any], filters: Filters) -> bool:
    if filters.price_levels and row["price_level"] not in filters.price_levels:
        return False
    return not set(row["types"]) & set(filters.exclude_types)


def fixture_deck(
    center: LatLng,
    radius_m: int,
    filters: Filters,
    seed: int,
    size: int = 80,
    exclude: frozenset[str] = NO_EXCLUDE,
) -> list[Card]:
    """Filtered fixtures in a seeded shuffle. Ignores the radius if nothing is inside it, so
    a room created far from Vancouver still gets a deck in dev."""
    cards = [
        Card(
            id=r["id"],
            name=r["name"],
            lat=r["lat"],
            lng=r["lng"],
            distance_m=round(haversine_m(center, LatLng(lat=r["lat"], lng=r["lng"]))),
            rating=r["rating"],
            rating_count=r["rating_count"],
            price_level=r["price_level"],
            primary_type=r["primary_type"],
            address=r["address"],
            photo_url=None,
            maps_uri=r["maps_uri"],
        )
        for r in load_fixtures()
        if matches_filters(r, filters) and r["id"] not in exclude
    ]
    cards.sort(key=lambda c: c.id)
    nearby = [c for c in cards if c.distance_m <= radius_m] or cards
    random.Random(seed).shuffle(nearby)
    return nearby[:size]


async def build_fixture_deck(
    center: LatLng,
    radius_m: int,
    filters: Filters,
    seed: int,
    exclude: frozenset[str] = NO_EXCLUDE,
) -> list[Card]:
    return fixture_deck(center, radius_m, filters, seed, exclude=exclude)
