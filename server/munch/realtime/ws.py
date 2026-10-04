"""`/ws/{code}?memberId=...&token=...`: the room protocol from DESIGN.md §5.3."""

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from munch.accounts import repo
from munch.background import spawn
from munch.models import (
    ClientMessage,
    ErrorBody,
    ErrorMessage,
    MemberProgressMessage,
    MemberProgressPayload,
    PingMessage,
    PongMessage,
    RoomDeckExtendedMessage,
    RoomDeckExtendedPayload,
    RoomExpandMessage,
    RoomLeaveMessage,
    RoomReplayMessage,
    RoomRerunMessage,
    RoomStartedMessage,
    RoomStartedPayload,
    RoomStartMessage,
    RoomStateMessage,
    SwipeMessage,
    client_message_adapter,
)
from munch.realtime.hub import outcome_message
from munch.rooms.manager import LiveMember, LiveRoom, RoomError
from munch.state import AppState, StateDep

log = logging.getLogger(__name__)

UNAUTHORIZED_CLOSE = 4401

router = APIRouter()


@router.websocket("/ws/{code}")
async def room_socket(
    ws: WebSocket,
    code: str,
    state: StateDep,
    member_id: Annotated[str, Query(alias="memberId")] = "",
    token: str = "",
) -> None:
    await ws.accept()
    try:
        room, member = state.rooms.authenticate(code, member_id, token)
    except RoomError:
        await ws.close(code=UNAUTHORIZED_CLOSE)
        return

    state.hub.add(member.id, ws)
    state.rooms.connect(member)
    try:
        await send_snapshot(state, ws, room, member)
        while True:
            raw = await ws.receive_text()
            try:
                msg = client_message_adapter.validate_json(raw)
            except ValidationError as e:
                await send_error(state, ws, RoomError("VALIDATION_ERROR", str(e.errors()[0])))
                continue
            try:
                if not await handle(state, ws, room, member, msg):
                    return
            except RoomError as e:
                await send_error(state, ws, e)
    except WebSocketDisconnect:
        pass
    finally:
        state.hub.remove(member.id, ws)
        state.rooms.disconnect(member)


async def send_snapshot(state: AppState, ws: WebSocket, room: LiveRoom, member: LiveMember) -> None:
    """Everything a (re)connecting client needs to render the current screen."""
    await state.hub.send(ws, RoomStateMessage(payload=room.to_state()))
    if room.status in ("swiping", "matched", "exhausted"):
        started = RoomStartedPayload(deck=room.deck_for(member.id), resume_at=member.progress)
        await state.hub.send(ws, RoomStartedMessage(payload=started))
    if room.outcome is not None:
        await state.hub.send(ws, outcome_message(room.outcome))


async def send_error(state: AppState, ws: WebSocket, e: RoomError) -> None:
    await state.hub.send(ws, ErrorMessage(payload=ErrorBody(code=e.code, message=e.message)))


async def handle(
    state: AppState, ws: WebSocket, room: LiveRoom, member: LiveMember, msg: ClientMessage
) -> bool:
    """Apply one client message. Returns False when this socket should stop."""
    rooms, hub = state.rooms, state.hub
    match msg:
        case PingMessage():
            await hub.send(ws, PongMessage())

        case RoomStartMessage():
            await start_room(state, room, member)

        case SwipeMessage(payload=p):
            result = rooms.swipe(room, member.id, p.restaurant_id, p.liked)
            if result is not None:
                if member.user_id is not None and state.db_pool is not None:
                    spawn(
                        repo.record_swipe(state.db_pool, member.user_id, p.restaurant_id, p.liked),
                        "record swipe",
                    )
                progress = MemberProgressPayload(member_id=member.id, progress=result.progress)
                await hub.broadcast(room, MemberProgressMessage(payload=progress))
                if result.outcome is not None:
                    await hub.broadcast_change(room, result.outcome)

        case RoomLeaveMessage():
            outcome = rooms.leave(room, member.id)
            await hub.close_member(member.id)
            await hub.broadcast_change(room, outcome)
            return False

        case RoomExpandMessage(payload=p):
            await expand_room(state, room, member, p.radius_m)

        case RoomReplayMessage():
            rooms.replay(room)
            await hub.broadcast(room, RoomStateMessage(payload=room.to_state()))

        case RoomRerunMessage():
            raise RoomError("BAD_STATE", "Run it back isn't supported yet")

    return True


async def expand_room(
    state: AppState, room: LiveRoom, member: LiveMember, radius_m: int | None
) -> None:
    """Host's "search farther": deal never-seen restaurants from a wider radius onto the end
    of everyone's deck. Players who had finished get more cards to swipe."""
    rooms, hub = state.rooms, state.hub
    plan = rooms.begin_expand(room, member.id, radius_m)  # locks before we await
    try:
        cards = await state.build_deck(
            room.center, plan.radius_m, room.filters, plan.seed, plan.exclude
        )
    except Exception as e:
        rooms.abort_expand(room)
        log.exception("build_deck (expand) failed for room %s", room.code)
        raise RoomError("INTERNAL", "Couldn't search farther, try again") from e

    added = rooms.finish_expand(room, plan.radius_m, cards)
    if not added:
        km = plan.radius_m / 1000
        raise RoomError("NOT_FOUND", f"No new restaurants within {km:g} km")
    # Each player gets the new cards in their own order (the batch goes after their deck).
    old_size = len(room.deck) - len(added)
    await asyncio.gather(
        *(
            hub.send_member(
                m.id,
                RoomDeckExtendedMessage(
                    payload=RoomDeckExtendedPayload(
                        cards=room.deck_for(m.id)[old_size:], radius_m=room.radius_m
                    )
                ),
            )
            for m in room.active_members()
        )
    )
    await hub.broadcast(room, RoomStateMessage(payload=room.to_state()))


async def start_room(state: AppState, room: LiveRoom, member: LiveMember) -> None:
    rooms, hub = state.rooms, state.hub
    rooms.begin_start(room, member.id)  # locks the room before we await
    try:
        deck = await state.build_deck(room.center, room.radius_m, room.filters, room.seed)
    except Exception as e:
        rooms.abort_start(room)
        log.exception("build_deck failed for room %s", room.code)
        raise RoomError("INTERNAL", "Couldn't build a deck, try again") from e

    outcome = rooms.finish_start(room, deck)
    if state.db_pool is not None:  # invites to this room can't be used any more
        spawn(repo.expire_room_invites(state.db_pool, room.id), "expire invites")
    if room.status == "closed":  # everyone left while the deck was building
        return
    await hub.broadcast(room, RoomStateMessage(payload=room.to_state()))
    await asyncio.gather(
        *(
            hub.send_member(
                m.id,
                RoomStartedMessage(
                    payload=RoomStartedPayload(deck=room.deck_for(m.id), resume_at=0)
                ),
            )
            for m in room.active_members()
        )
    )
    if outcome is not None:
        await hub.broadcast(room, outcome_message(outcome))
