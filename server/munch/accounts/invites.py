"""Invite friends to a room: saved in the DB (their inbox) and sent live over /ws/me."""

from datetime import UTC, datetime

from munch.accounts import repo
from munch.accounts.deps import AuthUser, require_pool
from munch.accounts.errors import AccountError
from munch.models import InviteReceivedMessage
from munch.rooms.manager import LiveRoom
from munch.state import AppState


async def send_invites(
    state: AppState, room: LiveRoom, sender: AuthUser, user_ids: list[str]
) -> list[str]:
    """Invite friends to a lobby. Returns the user ids that got a new invite."""
    pool = require_pool(state)
    if not any(m.user_id == sender.id for m in room.active_members()):
        raise AccountError("FORBIDDEN", "Join the room before inviting people to it")
    if room.status != "lobby":
        raise AccountError("BAD_STATE", "The room has already started")
    from_user = await repo.get_public_user(pool, sender.id)
    if from_user is None:
        raise AccountError("UNAUTHORIZED", "Account no longer exists")

    created = await repo.create_invites(
        pool,
        room_id=room.id,
        room_code=room.code,
        from_user=from_user,
        to_user_ids=user_ids,
        expires_at=datetime.now(UTC) + state.settings.invite_ttl,
    )
    for to_user_id, invite in created:
        await state.user_hub.send_member(to_user_id, InviteReceivedMessage(payload=invite))
    return [to_user_id for to_user_id, _ in created]
