"""Open WebSockets per member, and fan-out of server messages to a room."""

import asyncio
import logging

from starlette.websockets import WebSocket, WebSocketState

from munch.models import (
    CamelModel,
    RoomExhaustedMessage,
    RoomExhaustedPayload,
    RoomMatchedMessage,
    RoomMatchedPayload,
    RoomStateMessage,
)
from munch.rooms.manager import LiveRoom, Outcome

log = logging.getLogger(__name__)


def outcome_message(outcome: Outcome) -> RoomMatchedMessage | RoomExhaustedMessage:
    match outcome:
        case RoomMatchedPayload():
            return RoomMatchedMessage(payload=outcome)
        case RoomExhaustedPayload():
            return RoomExhaustedMessage(payload=outcome)


class Hub:
    def __init__(self) -> None:
        self._sockets: dict[str, set[WebSocket]] = {}  # member_id → open sockets

    def add(self, member_id: str, ws: WebSocket) -> None:
        self._sockets.setdefault(member_id, set()).add(ws)

    def remove(self, member_id: str, ws: WebSocket) -> None:
        sockets = self._sockets.get(member_id)
        if sockets is not None:
            sockets.discard(ws)
            if not sockets:
                del self._sockets[member_id]

    async def send(self, ws: WebSocket, msg: CamelModel) -> None:
        try:
            await ws.send_text(msg.model_dump_json())
        except Exception:  # socket already gone; its receive loop will clean up
            log.debug("send failed", exc_info=True)

    async def send_member(self, member_id: str, msg: CamelModel) -> None:
        await asyncio.gather(*(self.send(ws, msg) for ws in self._sockets.get(member_id, ())))

    async def broadcast(self, room: LiveRoom, msg: CamelModel) -> None:
        await asyncio.gather(*(self.send_member(mid, msg) for mid in room.members))

    async def broadcast_change(self, room: LiveRoom, outcome: Outcome | None) -> None:
        """Send the new room:state, then the match/exhaustion result if there is one."""
        await self.broadcast(room, RoomStateMessage(payload=room.to_state()))
        if outcome is not None:
            await self.broadcast(room, outcome_message(outcome))

    async def close_member(self, member_id: str, code: int = 1000) -> None:
        for ws in list(self._sockets.pop(member_id, ())):
            if ws.application_state == WebSocketState.CONNECTED:
                try:
                    await ws.close(code=code)
                except Exception:
                    log.debug("close failed", exc_info=True)

    async def close_room(self, room: LiveRoom) -> None:
        await asyncio.gather(*(self.close_member(mid) for mid in room.members))
