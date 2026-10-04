"""Invite friends to a room, and answer invites."""

from fastapi import APIRouter, Response

from munch.accounts import repo
from munch.accounts.deps import CurrentUser, require_pool
from munch.accounts.invites import send_invites
from munch.models import RoomSession, RoomStateMessage, SendInvitesRequest, SendInvitesResponse
from munch.rooms.manager import RoomError
from munch.routes.rooms import session
from munch.state import StateDep

router = APIRouter(tags=["invites"])


@router.post("/rooms/{code}/invites")
async def invite_to_room(
    code: str, body: SendInvitesRequest, user: CurrentUser, state: StateDep
) -> SendInvitesResponse:
    room = state.rooms.get(code)
    return SendInvitesResponse(invited=await send_invites(state, room, user, body.user_ids))


@router.post("/invites/{invite_id}/accept")
async def accept_invite(invite_id: str, user: CurrentUser, state: StateDep) -> RoomSession:
    """Join the room you were invited to, as your account."""
    pool = require_pool(state)
    code = await repo.get_pending_invite(pool, invite_id, user.id)
    profile = await repo.get_profile(pool, user.id)
    try:
        room, member = state.rooms.join_room(code, profile.display_name, user_id=user.id)
    except RoomError:  # room gone or already started
        await repo.set_invite_status(pool, invite_id, "expired")
        raise
    await repo.set_invite_status(pool, invite_id, "accepted")
    await state.hub.broadcast(room, RoomStateMessage(payload=room.to_state()))
    return session(room, member)


@router.post("/invites/{invite_id}/decline", status_code=204)
async def decline_invite(invite_id: str, user: CurrentUser, state: StateDep) -> Response:
    pool = require_pool(state)
    await repo.get_pending_invite(pool, invite_id, user.id)
    await repo.set_invite_status(pool, invite_id, "declined")
    return Response(status_code=204)
