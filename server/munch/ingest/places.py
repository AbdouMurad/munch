"""Google Places API (New) `searchNearby` client. Only ingest may call Google (DESIGN.md §7)."""

import asyncio
from typing import Any

import httpx
from pydantic import BaseModel

SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
MAX_RESULTS = 20  # API hard cap, no pagination
MAX_ATTEMPTS = 3

FIELD_MASK = ",".join(
    f"places.{f}"
    for f in (
        "id",
        "displayName",
        "location",
        "formattedAddress",
        "rating",
        "userRatingCount",
        "priceLevel",
        "primaryType",
        "types",
        "photos",
        "googleMapsUri",
        "businessStatus",
        "regularOpeningHours",
    )
)

PRICE_LEVELS = {
    "PRICE_LEVEL_FREE": 0,
    "PRICE_LEVEL_INEXPENSIVE": 1,
    "PRICE_LEVEL_MODERATE": 2,
    "PRICE_LEVEL_EXPENSIVE": 3,
    "PRICE_LEVEL_VERY_EXPENSIVE": 4,
}


class Place(BaseModel):
    id: str
    name: str
    lat: float
    lng: float
    address: str | None
    rating: float | None
    rating_count: int
    price_level: int | None
    primary_type: str | None
    types: list[str]
    photo_name: str | None
    maps_uri: str | None
    business_status: str | None
    opening_hours: dict[str, Any] | None


def parse_place(raw: dict[str, Any]) -> Place:
    """Map one raw Places API result to our restaurant shape."""
    photos = raw.get("photos") or []
    return Place(
        id=raw["id"],
        name=raw.get("displayName", {}).get("text", ""),
        lat=raw["location"]["latitude"],
        lng=raw["location"]["longitude"],
        address=raw.get("formattedAddress"),
        rating=raw.get("rating"),
        rating_count=raw.get("userRatingCount", 0),
        price_level=PRICE_LEVELS.get(raw.get("priceLevel", "")),
        primary_type=raw.get("primaryType"),
        types=raw.get("types", []),
        photo_name=photos[0]["name"] if photos else None,
        maps_uri=raw.get("googleMapsUri"),
        business_status=raw.get("businessStatus"),
        opening_hours=raw.get("regularOpeningHours"),
    )


def build_request_body(lat: float, lng: float, radius_m: float) -> dict[str, Any]:
    return {
        "includedTypes": ["restaurant"],
        "maxResultCount": MAX_RESULTS,
        "rankPreference": "DISTANCE",
        "locationRestriction": {
            "circle": {"center": {"latitude": lat, "longitude": lng}, "radius": radius_m}
        },
    }


async def search_nearby(
    client: httpx.AsyncClient, api_key: str, lat: float, lng: float, radius_m: float
) -> list[Place]:
    """Return up to 20 restaurants nearest to (lat, lng) within radius_m (max 50,000)."""
    headers = {"X-Goog-Api-Key": api_key, "X-Goog-FieldMask": FIELD_MASK}
    body = build_request_body(lat, lng, radius_m)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        resp = await client.post(SEARCH_NEARBY_URL, headers=headers, json=body)
        retryable = resp.status_code == 429 or resp.status_code >= 500
        if retryable and attempt < MAX_ATTEMPTS:
            await asyncio.sleep(2**attempt)
            continue
        resp.raise_for_status()
        return [parse_place(p) for p in resp.json().get("places", [])]
    raise AssertionError("unreachable")
