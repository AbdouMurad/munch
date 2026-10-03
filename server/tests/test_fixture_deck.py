from munch.models import Filters, LatLng
from munch.rooms.fixture_deck import fixture_deck, haversine_m

DOWNTOWN = LatLng(lat=49.2827, lng=-123.1207)


def test_same_seed_same_deck() -> None:
    a = fixture_deck(DOWNTOWN, 3000, Filters(), seed=7)
    assert a == fixture_deck(DOWNTOWN, 3000, Filters(), seed=7)
    assert [c.id for c in a] != [c.id for c in fixture_deck(DOWNTOWN, 3000, Filters(), seed=8)]


def test_radius_and_filters() -> None:
    deck = fixture_deck(DOWNTOWN, 1500, Filters(price_levels=[1, 2]), seed=1)
    assert deck and all(c.distance_m <= 1500 and c.price_level in (1, 2) for c in deck)
    no_fast_food = fixture_deck(
        DOWNTOWN, 50_000, Filters(exclude_types=["fast_food_restaurant"]), seed=1
    )
    assert all(c.primary_type != "fast_food_restaurant" for c in no_fast_food)


def test_far_away_room_still_gets_a_deck() -> None:
    assert fixture_deck(LatLng(lat=0, lng=0), 3000, Filters(), seed=1)


def test_haversine() -> None:
    # ~1 degree of latitude
    assert abs(haversine_m(LatLng(lat=49, lng=-123), LatLng(lat=50, lng=-123)) - 111_195) < 50
