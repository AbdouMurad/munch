"""Fire-and-forget tasks (DB writes) that must not slow down or break a request."""

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

log = logging.getLogger(__name__)

_tasks: set[asyncio.Task[Any]] = set()  # strong refs, or the event loop may drop running tasks


def spawn(coro: Coroutine[Any, Any, Any], what: str) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)

    def done(t: asyncio.Task[Any]) -> None:
        _tasks.discard(t)
        if not t.cancelled() and t.exception() is not None:
            log.error("background task failed: %s", what, exc_info=t.exception())

    task.add_done_callback(done)
