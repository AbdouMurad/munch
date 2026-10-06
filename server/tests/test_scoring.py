import math
import random
from datetime import datetime

from munch.ranking.deck import order_deck, type_key
from munch.ranking.hours import is_open
from munch.ranking.scoring import (
    DEFAULT_PARAMS,
    Candidate,
    bayes_rating,
    distance_score,
    diversify,
    rank,
    rating_score,
    score,
    weights_for,
)


def cand(
    id: str, rating: float | None, count: int, distance_m: float, ptype: str | None = None
) -> Candidate:
    return Candidate(
        id=id,
        name=id,
        lat=0,
        lng=0,
        distance_m=distance_m,
        rating=rating,
        rating_count=count,
        price_level=None,
        primary_type=ptype,
        types=[],
        address=None,
        photo_name=None,
        maps_uri=None,
        opening_hours=None,
    )


def test_few_reviews_pulled_to_prior() -> None:
    assert rating_score(5.0, 3) < rating_score(4.6, 2000)
    assert bayes_rating(None, 0) == bayes_rating(4.2, 1000)


def test_high_rating_and_many_reviews_wins() -> None:
    proven = cand("proven", 4.7, 3000, 500)
    new = cand("new", 4.7, 20, 500)
    meh = cand("meh", 3.9, 3000, 500)
    assert score(proven, 3000) > score(new, 3000)
    assert score(proven, 3000) > score(meh, 3000)


def test_distance_decreases_score() -> None:
    assert distance_score(0, 3000) == 1
    assert score(cand("near", 4.5, 500, 200), 3000) > score(cand("far", 4.5, 500, 2500), 3000)


def test_rank_is_reproducible_with_seed() -> None:
    cands = [cand(str(i), 4.0 + i / 100, 100 * i, 100 * i) for i in range(50)]
    a = rank(cands, 3000, random.Random(7))
    b = rank(cands, 3000, random.Random(7))
    c = rank(cands, 3000, random.Random(8))
    assert a == b
    assert a != c


def test_best_stays_near_front() -> None:
    best = cand("best", 4.8, 5000, 100)
    rest = [cand(str(i), 4.0, 50, 1500 + 10 * i) for i in range(99)]
    positions = [rank([best, *rest], 3000, random.Random(s)).index(best) for s in range(200)]
    assert max(positions) == 0


def test_jitter_never_lets_much_worse_jump_ahead() -> None:
    cands = [cand(str(i), 3.5 + i / 50, 10 * i * i, 3000 - 25 * i) for i in range(60)]
    limit = 2 * DEFAULT_PARAMS.jitter
    for s in range(50):
        scores = [score(c, 3000) for c in rank(cands, 3000, random.Random(s))]
        assert all(
            later <= earlier + limit
            for i, earlier in enumerate(scores)
            for later in scores[i + 1 :]
        )


def test_diversify_spreads_repeats() -> None:
    types = ["ramen", "ramen", "ramen", "pizza", "sushi", "ramen", "thai"]
    out = diversify(types, lambda t: t)
    assert sorted(out) == sorted(types)
    for i in range(1, len(out)):
        assert out[i] not in out[max(0, i - 2) : i] or out[i:].count(out[i]) == len(out[i:])


def test_diversify_ignores_generic_types() -> None:
    cards = [cand(str(i), 4.5, 100, 100, "restaurant") for i in range(4)]
    assert diversify(cards, type_key) == cards


def test_order_deck_same_seed_same_deck() -> None:
    cands = [cand(str(i), 4.0 + i / 100, 100 * i, 50 * i, f"t{i % 3}") for i in range(40)]
    a = order_deck(cands, 3000, 42, DEFAULT_PARAMS, 20)
    assert a == order_deck(cands, 3000, 42, DEFAULT_PARAMS, 20)
    assert len(a) == 20


# 2026-10-03 is a Saturday (Google day 6), 2026-10-04 a Sunday (day 0).
SAT_NOON = datetime(2026, 10, 3, 12, 0)
SAT_LATE = datetime(2026, 10, 3, 23, 30)
SUN_1AM = datetime(2026, 10, 4, 1, 0)


def period(od: int, oh: int, cd: int, ch: int) -> dict[str, dict[str, int]]:
    return {
        "open": {"day": od, "hour": oh, "minute": 0},
        "close": {"day": cd, "hour": ch, "minute": 0},
    }


def test_is_open_normal_hours() -> None:
    hours = {"periods": [period(6, 11, 6, 22)]}
    assert is_open(hours, SAT_NOON) is True
    assert is_open(hours, SAT_LATE) is False


def test_is_open_wraps_saturday_night_into_sunday() -> None:
    hours = {"periods": [period(6, 18, 0, 2)]}
    assert is_open(hours, SAT_LATE) is True
    assert is_open(hours, SUN_1AM) is True
    assert is_open(hours, SAT_NOON) is False


def test_is_open_24_7_and_unknown() -> None:
    assert is_open({"periods": [{"open": {"day": 0, "hour": 0, "minute": 0}}]}, SAT_NOON) is True
    assert is_open(None, SAT_NOON) is None
    assert is_open({}, SAT_NOON) is None


def test_short_searches_keep_the_normal_weights() -> None:
    for radius in (1000, 3000):
        assert weights_for(radius) == (0.5, 0.2, 0.3)


def test_wider_searches_move_weight_from_distance_to_quality() -> None:
    w_rating, w_popularity, w_distance = weights_for(20000)
    assert math.isclose(w_distance, 0.1)
    assert w_rating > 0.5 and w_popularity > 0.2
    assert math.isclose(w_rating / w_popularity, 0.5 / 0.2)  # quality keeps its own balance
    previous = 0.3
    for radius in (5000, 10000, 15000, 20000, 40000):
        weights = weights_for(radius)
        assert math.isclose(sum(weights), 1.0)  # scores stay on the same 0-1 scale
        assert weights[2] <= previous  # distance only ever counts less as the search grows
        previous = weights[2]


def test_wide_search_prefers_great_places_further_away() -> None:
    # On campus: an okay spot next door vs. a loved spot 6 km away (only in a wide search).
    next_door = cand("next_door", 4.1, 120, 300)
    worth_the_trip = cand("worth_the_trip", 4.7, 3000, 6000)
    assert score(worth_the_trip, 20000) > score(next_door, 20000) + 0.2
    # ...and the wider the search, the bigger its lead.
    leads = [score(worth_the_trip, r) - score(next_door, r) for r in (8000, 12000, 20000)]
    assert leads == sorted(leads)
