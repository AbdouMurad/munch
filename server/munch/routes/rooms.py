"""Room REST endpoints (DESIGN.md §5.2). Live updates go over the WebSocket."""

from typing import Any

from fastapi import APIRouter

from munch.models import (
    CreateRoomRequest,
    ErrorResponse,
    JoinRoomRequest,
    RoomSession,
    RoomState,
    RoomStateMessage,
)
from munch.rooms.manager import LiveMember, LiveRoom
from munch.state import StateDep

router = APIRouter(prefix="/rooms", tags=["rooms"])

NOT_FOUND: dict[int | str, dict[str, Any]] = {404: {"model": ErrorResponse}}


def session(room: LiveRoom, member: LiveMember) -> RoomSession:
    return RoomSession(
        room_id=room.id, code=room.code, member_id=member.id, member_token=member.token
    )


@router.post("", status_code=201, responses={422: {"model": ErrorResponse}})
async def create_room(body: CreateRoomRequest, state: StateDep) -> RoomSession:
    room, member = state.rooms.create_room(
        body.display_name, body.center, body.radius_m, body.filters
    )
    return session(room, member)


@router.post("/{code}/join", responses={**NOT_FOUND, 409: {"model": ErrorResponse}})
async def join_room(code: str, body: JoinRoomRequest, state: StateDep) -> RoomSession:
    room, member = state.rooms.join_room(code, body.display_name)
    await state.hub.broadcast(room, RoomStateMessage(payload=room.to_state()))
    return session(room, member)


@router.get("/{code}", responses=NOT_FOUND)
async def get_room(code: str, state: StateDep) -> RoomState:
    return state.rooms.get(code).to_state()
