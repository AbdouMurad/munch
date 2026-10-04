"""Room REST endpoints (DESIGN.md §5.2). Live updates go over the WebSocket."""

from typing import Any

from fastapi import APIRouter

from munch.accounts import repo
from munch.accounts.deps import AuthUser, OptionalUser
from munch.models import (
    CreateRoomRequest,
    ErrorResponse,
    JoinRoomRequest,
    RoomSession,
    RoomState,
    RoomStateMessage,
)
from munch.rooms.manager import LiveMember, LiveRoom
from munch.state import AppState, StateDep

router = APIRouter(prefix="/rooms", tags=["rooms"])

NOT_FOUND: dict[int | str, dict[str, Any]] = {404: {"model": ErrorResponse}}


async def avatar_of(state: AppState, user: AuthUser | None) -> str | None:
    """A signed-in player's picture, shown next to them in the lobby."""
    if user is None or state.db_pool is None:
        return None
    return (await repo.get_profile(state.db_pool, user.id)).avatar_url


def session(room: LiveRoom, member: LiveMember) -> RoomSession:
    return RoomSession(
        room_id=room.id, code=room.code, member_id=member.id, member_token=member.token
    )


@router.post("", status_code=201, responses={422: {"model": ErrorResponse}})
async def create_room(body: CreateRoomRequest, state: StateDep, user: OptionalUser) -> RoomSession:
    """Signed-in callers (Bearer token) are linked to their account; guests work too."""
    room, member = state.rooms.create_room(
        body.display_name,
        body.center,
        body.radius_m,
        body.filters,
        user_id=user.id if user else None,
        avatar_url=await avatar_of(state, user),
    )
    return session(room, member)


@router.post("/{code}/join", responses={**NOT_FOUND, 409: {"model": ErrorResponse}})
async def join_room(
    code: str, body: JoinRoomRequest, state: StateDep, user: OptionalUser
) -> RoomSession:
    room, member = state.rooms.join_room(
        code,
        body.display_name,
        user_id=user.id if user else None,
        avatar_url=await avatar_of(state, user),
    )
    await state.hub.broadcast(room, RoomStateMessage(payload=room.to_state()))
    return session(room, member)


@router.get("/{code}", responses=NOT_FOUND)
async def get_room(code: str, state: StateDep) -> RoomState:
    return state.rooms.get(code).to_state()
