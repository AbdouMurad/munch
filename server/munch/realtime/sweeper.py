"""Background task: time out disconnected members and drop stale rooms (DESIGN.md §6)."""

import asyncio
import logging

from munch.realtime.hub import Hub
from munch.rooms.manager import RoomManager

log = logging.getLogger(__name__)


async def run_sweeper(rooms: RoomManager, hub: Hub, interval_s: float = 10) -> None:
    while True:
        await asyncio.sleep(interval_s)
        try:
            result = rooms.sweep()
            for room, outcome in result.changed:
                await hub.broadcast_change(room, outcome)
            for room in result.removed:
                await hub.close_room(room)
        except Exception:
            log.exception("sweep failed")
