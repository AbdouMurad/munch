"""The real deck builder (DESIGN.md §8): PostGIS candidates + filters, then score, shuffle,
spread out cuisines, and convert to Cards. Plugs into AppState.build_deck."""

import json
import random
from datetime import datetime
from zoneinfo import ZoneInfo

import asyncpg

from munch.config import Settings
from munch.models import Card, Filters, LatLng
from munch.ranking.hours import is_open
from munch.ranking.scoring import Candidate, ScoreParams, diversify, rank
from munch.rooms.fixture_deck import NO_EXCLUDE, DeckBuilder

TZ = ZoneInfo("America/Vancouver")
MAX_CANDIDATES = 1000
MAX_EXPANSIONS = 3  # double the radius up to this many times if too few places
# Too broad to count as "the same cuisine twice in a row".
GENERIC_TYPES = {"restaurant", "food", "meal_takeaway", "meal_delivery"}

# $1 lat, $2 lng (PostGIS points are lng, lat), $3 radius m, $4 limit, then filters,
# $11 ids to exclude.
CANDIDATES_SQL = """
SELECT id, name, lat, lng, rating, rating_count, price_level, primary_type, types, address,
       photo_name, maps_uri, opening_hours,
       ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
FROM restaurants
WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
  AND business_status = 'OPERATIONAL'
  AND ($5::smallint[] IS NULL OR price_level = ANY($5) OR ($6 AND price_level IS NULL))
  AND (cardinality($7::text[]) = 0 OR types && $7)
  AND NOT (types && $8::text[])
  AND ($9::real IS NULL OR rating >= $9)
  AND rating_count >= $10
  AND NOT (id = ANY($11::text[]))  -- already dealt (search farther mid-game)
ORDER BY location <-> ST_MakePoint($2, $1)::geography
LIMIT $4
"""


def params_from(settings: Settings) -> ScoreParams:
    return ScoreParams(
        prior_rating=settings.rating_prior_mean,
        prior_weight=settings.rating_prior_weight,
        popular_reviews=settings.popular_reviews,
        w_rating=settings.weight_rating,
        w_popularity=settings.weight_popularity,
        w_distance=settings.weight_distance,
        jitter=settings.jitter,
    )


async def fetch_candidates(
    pool: asyncpg.Pool,
    center: LatLng,
    radius_m: float,
    filters: Filters,
    now: datetime,
    exclude: frozenset[str] = NO_EXCLUDE,
) -> list[Candidate]:
    rows = await pool.fetch(
        CANDIDATES_SQL,
        center.lat,
        center.lng,
        radius_m,
        MAX_CANDIDATES,
        filters.price_levels or None,
        filters.include_unknown_price,
        filters.include_types,
        filters.exclude_types,
        filters.min_rating,
        filters.min_reviews,
        list(exclude),
    )
    candidates = []
    for r in rows:
        row = dict(r)
        hours = row.pop("opening_hours")
        candidates.append(Candidate(**row, opening_hours=json.loads(hours) if hours else None))
    if filters.open_now:
        candidates = [c for c in candidates if is_open(c.opening_hours, now)]
    return candidates


def type_key(c: Candidate) -> str | None:
    return None if c.primary_type in GENERIC_TYPES else c.primary_type


def to_card(c: Candidate) -> Card:
    return Card(
        id=c.id,
        name=c.name,
        lat=c.lat,
        lng=c.lng,
        distance_m=round(c.distance_m),
        rating=round(c.rating, 1) if c.rating is not None else None,  # real -> 4.800000190734863
        rating_count=c.rating_count,
        price_level=c.price_level,
        primary_type=c.primary_type,
        address=c.address,
        photo_url=f"/api/photos/{c.id}" if c.photo_name else None,
        maps_uri=c.maps_uri,
    )


def order_deck(
    candidates: list[Candidate], radius_m: float, seed: int, params: ScoreParams, size: int
) -> list[Card]:
    """Pure part of deck building: the same inputs and seed always give the same deck."""
    ranked = rank(candidates, radius_m, random.Random(seed), params)
    return [to_card(c) for c in diversify(ranked, type_key)[:size]]


async def build_deck(
    pool: asyncpg.Pool,
    center: LatLng,
    radius_m: int,
    filters: Filters,
    seed: int,
    settings: Settings,
    now: datetime | None = None,
    exclude: frozenset[str] = NO_EXCLUDE,
) -> list[Card]:
    """Up to settings.deck_size cards, widening the radius if fewer than min_candidates match.
    `now` (for open_now) defaults to the current Vancouver time. Restaurants in `exclude`
    are never dealt."""
    now = now or datetime.now(TZ)
    radius: float = radius_m
    candidates = await fetch_candidates(pool, center, radius, filters, now, exclude)
    for _ in range(MAX_EXPANSIONS):
        if len(candidates) >= settings.min_candidates:
            break
        radius *= 2
        candidates = await fetch_candidates(pool, center, radius, filters, now, exclude)
    return order_deck(candidates, radius, seed, params_from(settings), settings.deck_size)


def make_deck_builder(pool: asyncpg.Pool, settings: Settings) -> DeckBuilder:
    """Adapter to the server's DeckBuilder signature."""

    async def builder(
        center: LatLng,
        radius_m: int,
        filters: Filters,
        seed: int,
        exclude: frozenset[str] = NO_EXCLUDE,
    ) -> list[Card]:
        return await build_deck(pool, center, radius_m, filters, seed, settings, exclude=exclude)

    return builder
