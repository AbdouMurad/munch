"""Pure scoring, shuffling and variety for restaurant decks (DESIGN.md §8)."""

import math
import random
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ScoreParams:
    # Bayesian prior: a rating is pulled toward prior_rating as if it had prior_weight extra
    # reviews at that value, so a 5.0 with 3 reviews doesn't beat a 4.6 with 2,000.
    prior_rating: float = 4.2  # roughly the Vancouver average
    prior_weight: int = 50
    # Review count where popularity maxes out (log scale, so 200 reviews is already ~0.7).
    popular_reviews: int = 2000
    w_rating: float = 0.5
    w_popularity: float = 0.2
    w_distance: float = 0.3
    # Each score gets +/- jitter, so a place can only overtake places within 2 * jitter of it.
    # Bounded on purpose: unbounded (Gumbel) noise over ~1,000 Metrotown candidates let
    # 0.64-score places jump ahead of 0.88s.
    jitter: float = 0.05
    # The farther a game searches, the less distance should count: someone who picks 20 km
    # wants the best places in that area, not just the closest. Up to near_radius_m the
    # weights above apply as they are; by far_radius_m distance counts far_distance_share
    # as much, and what it gave up goes to rating and popularity (see weights_for).
    near_radius_m: float = 3000
    far_radius_m: float = 20000
    far_distance_share: float = 1 / 3


DEFAULT_PARAMS = ScoreParams()


@dataclass(frozen=True)
class Candidate:
    id: str
    name: str
    lat: float
    lng: float
    distance_m: float
    rating: float | None
    rating_count: int
    price_level: int | None
    primary_type: str | None
    types: list[str]
    address: str | None
    photo_name: str | None
    maps_uri: str | None
    opening_hours: dict[str, Any] | None


def clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def bayes_rating(rating: float | None, count: int, p: ScoreParams = DEFAULT_PARAMS) -> float:
    r = rating if rating is not None else p.prior_rating
    return (count * r + p.prior_weight * p.prior_rating) / (count + p.prior_weight)


def rating_score(rating: float | None, count: int, p: ScoreParams = DEFAULT_PARAMS) -> float:
    """3.5 stars or worse -> 0, 5 stars -> 1, after smoothing."""
    return clamp((bayes_rating(rating, count, p) - 3.5) / 1.5)


def popularity_score(count: int, p: ScoreParams = DEFAULT_PARAMS) -> float:
    return clamp(math.log1p(count) / math.log1p(p.popular_reviews))


def distance_score(distance_m: float, radius_m: float) -> float:
    """1 at the center, ~0.37 at half the radius, ~0.14 at the edge."""
    return math.exp(-distance_m / (radius_m / 2))


def weights_for(radius_m: float, p: ScoreParams = DEFAULT_PARAMS) -> tuple[float, float, float]:
    """(rating, popularity, distance) weights for a search this wide. They always add up to
    the same total; a wider search moves weight from distance to rating and popularity."""
    far = clamp((radius_m - p.near_radius_m) / (p.far_radius_m - p.near_radius_m))
    w_distance = p.w_distance * (1 - far * (1 - p.far_distance_share))
    freed = p.w_distance - w_distance
    quality = p.w_rating + p.w_popularity
    return (
        p.w_rating + freed * p.w_rating / quality,
        p.w_popularity + freed * p.w_popularity / quality,
        w_distance,
    )


def score(c: Candidate, radius_m: float, p: ScoreParams = DEFAULT_PARAMS) -> float:
    w_rating, w_popularity, w_distance = weights_for(radius_m, p)
    return (
        w_rating * rating_score(c.rating, c.rating_count, p)
        + w_popularity * popularity_score(c.rating_count, p)
        + w_distance * distance_score(c.distance_m, radius_m)
    )


def rank(
    candidates: list[Candidate],
    radius_m: float,
    rng: random.Random,
    p: ScoreParams = DEFAULT_PARAMS,
) -> list[Candidate]:
    """Best first, shuffled among places with similar scores."""
    keyed = [(score(c, radius_m, p) + rng.uniform(-p.jitter, p.jitter), c) for c in candidates]
    keyed.sort(key=lambda kc: kc[0], reverse=True)
    return [c for _, c in keyed]


def diversify[T](items: list[T], key: Callable[[T], str | None], window: int = 2) -> list[T]:
    """If an item repeats a key from the previous `window` items, pull forward the next item
    that doesn't (so five ramen shops don't land in a row). None keys never clash."""
    out = list(items)
    for i in range(1, len(out)):
        recent = {key(x) for x in out[max(0, i - window) : i]} - {None}
        if key(out[i]) not in recent:
            continue
        for j in range(i + 1, len(out)):
            if key(out[j]) not in recent:
                out.insert(i, out.pop(j))
                break
    return out
