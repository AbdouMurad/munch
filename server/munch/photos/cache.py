"""In-memory cache of short-lived photo URLs (DESIGN.md §7.4).

Lives in memory, not Tiger: Google's photo URLs expire after a few hours anyway, a restart only
costs one call per photo as cards are viewed again, and the server is a single process (§6).
"""

import asyncio
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable


class TTLCache:
    """Keyed values that expire after `ttl_s`, least-recently-used evicted past `max_size`.
    Concurrent misses for the same key share one fetch, so three phones opening the same card
    at once cost one Google call."""

    def __init__(
        self, ttl_s: float, max_size: int, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.ttl_s = ttl_s
        self.max_size = max_size
        self._clock = clock
        self._items: OrderedDict[str, tuple[float, str | None]] = OrderedDict()
        self._inflight: dict[str, asyncio.Future[str | None]] = {}

    def get(self, key: str) -> tuple[bool, str | None]:
        """(hit, value). A cached None is a hit: "this place has no photo"."""
        item = self._items.get(key)
        if item is None:
            return False, None
        expires, value = item
        if expires <= self._clock():
            del self._items[key]
            return False, None
        self._items.move_to_end(key)
        return True, value

    def put(self, key: str, value: str | None) -> None:
        self._items[key] = (self._clock() + self.ttl_s, value)
        self._items.move_to_end(key)
        while len(self._items) > self.max_size:
            self._items.popitem(last=False)

    def drop(self, key: str) -> None:
        self._items.pop(key, None)

    async def get_or_fetch(
        self, key: str, fetch: Callable[[], Awaitable[str | None]]
    ) -> str | None:
        hit, value = self.get(key)
        if hit:
            return value
        pending = self._inflight.get(key)
        if pending is not None:
            return await pending
        future: asyncio.Future[str | None] = asyncio.get_running_loop().create_future()
        self._inflight[key] = future
        try:
            value = await fetch()
        except BaseException as e:
            future.set_exception(e)
            future.exception()  # mark retrieved: waiters may not exist
            raise
        else:
            self.put(key, value)
            future.set_result(value)
            return value
        finally:
            del self._inflight[key]
