"""Restaurant photo URLs: look up the photo reference in Tiger, trade it with Google for a
short-lived image URL, cache that. The photo proxy is the only place outside ingest/ allowed
to call Google (CLAUDE.md); the API key stays on the server."""

import asyncio

import asyncpg
import httpx

from munch.models import Card, Filters, LatLng
from munch.photos.cache import TTLCache
from munch.rooms.fixture_deck import NO_EXCLUDE, DeckBuilder

MEDIA_URL = "https://places.googleapis.com/v1/{photo_name}/media"
DEFAULT_WIDTH = 800  # what the app asks for (no ?w), so warmed entries match its requests
WIDTHS = (400, 800, 1200)  # snap requests to a few sizes so the cache stays effective
CACHE_TTL_S = 50 * 60  # Google's URLs last a few hours; refresh well before that
CACHE_MAX = 10_000
# When a deck is dealt, look up this many cards' photos before anyone asks. The app preloads
# a few cards ahead on its own, so this mainly makes the first cards instant.
WARM_AHEAD = 15
WARM_CONCURRENCY = 5


def snap_width(w: int) -> int:
    return min(WIDTHS, key=lambda size: abs(size - w))


class PhotoNotFound(Exception):
    pass


def bad_key(resp: httpx.Response) -> bool:
    """Google answers an invalid or expired API key with a 400 too; tell it apart from a
    stale photo reference so it surfaces as an error instead of a cached "no photo"."""
    return "API_KEY" in resp.text or "API key" in resp.text


class PhotoService:
    def __init__(self, pool: asyncpg.Pool, client: httpx.AsyncClient, api_key: str) -> None:
        self._pool = pool
        self._client = client
        self._api_key = api_key
        self.cache = TTLCache(CACHE_TTL_S, CACHE_MAX)
        self._background: set[asyncio.Task[None]] = set()  # keeps warm-up tasks alive

    async def warm(self, restaurant_ids: list[str]) -> None:
        """Fetch photo URLs into the cache, in order, a few at a time. Failures are ignored:
        the card's own request retries. A phone asking mid-warm joins the same Google call."""
        limit = asyncio.Semaphore(WARM_CONCURRENCY)

        async def one(restaurant_id: str) -> None:
            async with limit:
                try:
                    await self.photo_url(restaurant_id)
                except (PhotoNotFound, httpx.HTTPError):
                    pass

        await asyncio.gather(*(one(r) for r in restaurant_ids))

    def warm_in_background(self, restaurant_ids: list[str]) -> None:
        task = asyncio.create_task(self.warm(restaurant_ids))
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def photo_url(self, restaurant_id: str, width: int = DEFAULT_WIDTH) -> str:
        """A Google image URL for the restaurant's main photo. Raises PhotoNotFound."""
        width = snap_width(width)
        key = f"{restaurant_id}:{width}"
        url = await self.cache.get_or_fetch(key, lambda: self._fetch(restaurant_id, width))
        if url is None:
            raise PhotoNotFound(restaurant_id)
        return url

    async def _fetch(self, restaurant_id: str, width: int) -> str | None:
        photo_name: str | None = await self._pool.fetchval(
            "SELECT photo_name FROM restaurants WHERE id = $1", restaurant_id
        )
        if photo_name is None:
            return None  # unknown restaurant or no photo; cached so we don't re-query
        resp = await self._client.get(
            MEDIA_URL.format(photo_name=photo_name),
            params={"maxWidthPx": width, "skipHttpRedirect": "true"},
            headers={"X-Goog-Api-Key": self._api_key},  # header, so it never lands in URL logs
        )
        if resp.status_code == 404 or (resp.status_code == 400 and not bad_key(resp)):
            return None  # photo reference expired; a re-crawl refreshes it
        resp.raise_for_status()  # bad/restricted key, quota, outage: an error, never cached
        uri: str = resp.json()["photoUri"]
        return uri


def with_photo_warmup(build_deck: DeckBuilder, photos: PhotoService) -> DeckBuilder:
    """Wrap a deck builder so dealing a deck starts warming its first cards' photos.
    Doesn't delay the deck: the warm-up runs in the background."""

    async def builder(
        center: LatLng,
        radius_m: int,
        filters: Filters,
        seed: int,
        exclude: frozenset[str] = NO_EXCLUDE,
    ) -> list[Card]:
        deck = await build_deck(center, radius_m, filters, seed, exclude)
        photos.warm_in_background([c.id for c in deck[:WARM_AHEAD] if c.photo_url])
        return deck

    return builder
