import asyncio
from typing import Any

import httpx
import pytest

from munch.models import Card, Filters, LatLng
from munch.photos.cache import TTLCache
from munch.photos.service import (
    WARM_AHEAD,
    PhotoNotFound,
    PhotoService,
    snap_width,
    with_photo_warmup,
)


class Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


def test_cache_expires_and_evicts() -> None:
    clock = Clock()
    cache = TTLCache(ttl_s=60, max_size=2, clock=clock)
    cache.put("a", "url-a")
    assert cache.get("a") == (True, "url-a")
    clock.t = 61
    assert cache.get("a") == (False, None)

    cache.put("a", "1")
    cache.put("b", "2")
    cache.get("a")  # a is now most recent
    cache.put("c", "3")
    assert cache.get("b") == (False, None)
    assert cache.get("a")[0] and cache.get("c")[0]


def test_cache_remembers_no_photo() -> None:
    cache = TTLCache(ttl_s=60, max_size=10)
    cache.put("x", None)
    assert cache.get("x") == (True, None)


async def test_concurrent_misses_share_one_fetch() -> None:
    cache = TTLCache(ttl_s=60, max_size=10)
    calls = 0

    async def fetch() -> str:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return "url"

    results = await asyncio.gather(*(cache.get_or_fetch("k", fetch) for _ in range(5)))
    assert results == ["url"] * 5
    assert calls == 1
    assert await cache.get_or_fetch("k", fetch) == "url"
    assert calls == 1


async def test_failed_fetch_is_not_cached() -> None:
    cache = TTLCache(ttl_s=60, max_size=10)

    async def boom() -> str:
        raise RuntimeError("google down")

    with pytest.raises(RuntimeError):
        await cache.get_or_fetch("k", boom)
    assert cache.get("k") == (False, None)


def test_snap_width() -> None:
    assert snap_width(100) == 400
    assert snap_width(750) == 800
    assert snap_width(1600) == 1200


class FakePool:
    def __init__(self, photos: dict[str, str | None]) -> None:
        self.photos = photos
        self.queries = 0

    async def fetchval(self, _sql: str, restaurant_id: str) -> str | None:
        self.queries += 1
        return self.photos.get(restaurant_id)


def google(status: int = 200, body: str = "") -> tuple[httpx.AsyncClient, list[httpx.Request]]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if status != 200:
            return httpx.Response(status, text=body)
        return httpx.Response(200, json={"photoUri": "https://lh3.googleusercontent.com/x"})

    return httpx.AsyncClient(transport=httpx.MockTransport(handler)), seen


def service(pool: FakePool, client: httpx.AsyncClient) -> PhotoService:
    return PhotoService(pool, client, "test-key")  # type: ignore[arg-type]


async def test_photo_url_calls_google_once_per_photo() -> None:
    pool = FakePool({"r1": "places/r1/photos/p1"})
    client, seen = google()
    svc = service(pool, client)
    assert await svc.photo_url("r1") == "https://lh3.googleusercontent.com/x"
    assert await svc.photo_url("r1", 780) == "https://lh3.googleusercontent.com/x"
    assert len(seen) == 1
    req = seen[0]
    assert req.url.path == "/v1/places/r1/photos/p1/media"
    assert req.url.params["maxWidthPx"] == "800"
    assert req.headers["X-Goog-Api-Key"] == "test-key"
    assert "key" not in req.url.params  # never in the URL


@pytest.mark.parametrize("photos,status", [({}, 200), ({"r1": None}, 200), ({"r1": "p"}, 404)])
async def test_missing_or_expired_photo_is_not_found(photos: dict[str, Any], status: int) -> None:
    pool = FakePool(photos)
    client, _ = google(status)
    svc = service(pool, client)
    for _ in range(2):
        with pytest.raises(PhotoNotFound):
            await svc.photo_url("r1")
    assert pool.queries == 1  # "no photo" is cached too


async def test_bad_api_key_is_an_error_not_no_photo() -> None:
    pool = FakePool({"r1": "places/r1/photos/p1"})
    body = '{"error": {"code": 400, "message": "API key not valid.", "status": "INVALID_ARGUMENT",'
    body += ' "details": [{"reason": "API_KEY_INVALID"}]}}'
    client, seen = google(400, body)
    svc = service(pool, client)
    for _ in range(2):
        with pytest.raises(httpx.HTTPStatusError):
            await svc.photo_url("r1")
    assert len(seen) == 2  # not cached: fixing the key fixes photos without a restart


async def test_google_outage_raises_and_retries_next_time() -> None:
    pool = FakePool({"r1": "places/r1/photos/p1"})
    client, seen = google(500)
    svc = service(pool, client)
    for _ in range(2):
        with pytest.raises(httpx.HTTPStatusError):
            await svc.photo_url("r1")
    assert len(seen) == 2


async def test_warm_fetches_each_photo_once_and_ignores_failures() -> None:
    pool = FakePool({"a": "places/a/photos/1", "b": "places/b/photos/1", "none": None})
    client, seen = google()
    svc = service(pool, client)
    await svc.warm(["a", "b", "none", "unknown"])
    assert len(seen) == 2
    await svc.photo_url("a")  # served from the warm cache
    assert len(seen) == 2


async def test_dealing_a_deck_warms_its_first_photos() -> None:
    pool = FakePool({f"r{i}": f"places/r{i}/photos/1" for i in range(30)})
    client, seen = google()
    svc = service(pool, client)
    deck = [
        Card(
            id=f"r{i}",
            name=f"r{i}",
            lat=0,
            lng=0,
            distance_m=0,
            rating=None,
            rating_count=0,
            price_level=None,
            primary_type=None,
            address=None,
            photo_url=f"/api/photos/r{i}" if i != 1 else None,
            maps_uri=None,
        )
        for i in range(30)
    ]

    async def build(
        center: LatLng,
        radius_m: int,
        filters: Filters,
        seed: int,
        exclude: frozenset[str] = frozenset(),
    ) -> list[Card]:
        return deck

    dealt = await with_photo_warmup(build, svc)(LatLng(lat=0, lng=0), 1000, Filters(), 1)
    assert dealt == deck  # the deck itself is untouched and not delayed
    await asyncio.gather(*svc._background)
    # the first WARM_AHEAD cards, minus the one without a photo
    assert sorted(r.url.path.split("/")[3] for r in seen) == sorted(
        f"r{i}" for i in range(WARM_AHEAD) if i != 1
    )
