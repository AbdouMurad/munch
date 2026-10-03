from munch.ingest.places import build_request_body, parse_place


def test_parse_place_full() -> None:
    p = parse_place(
        {
            "id": "abc",
            "displayName": {"text": "Ramen Spot"},
            "location": {"latitude": 49.28, "longitude": -123.12},
            "rating": 4.5,
            "userRatingCount": 120,
            "priceLevel": "PRICE_LEVEL_MODERATE",
            "photos": [{"name": "places/abc/photos/xyz"}, {"name": "places/abc/photos/2"}],
        }
    )
    assert p.name == "Ramen Spot"
    assert p.price_level == 2
    assert p.photo_name == "places/abc/photos/xyz"


def test_parse_place_sparse() -> None:
    p = parse_place({"id": "x", "location": {"latitude": 1.0, "longitude": 2.0}})
    assert p.rating is None
    assert p.rating_count == 0
    assert p.price_level is None
    assert p.photo_name is None
    assert p.types == []


def test_request_body_circle() -> None:
    body = build_request_body(49.0, -123.0, 750)
    assert body["rankPreference"] == "DISTANCE"
    assert body["locationRestriction"]["circle"]["radius"] == 750
