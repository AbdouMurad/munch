"""The signed-in user's own profile, preferences and invites."""

from fastapi import APIRouter

from munch.accounts import repo
from munch.accounts.deps import CurrentUser, require_pool
from munch.models import (
    InvitesResponse,
    MyProfile,
    Preferences,
    UpdateProfileRequest,
)
from munch.state import StateDep

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
async def get_me(user: CurrentUser, state: StateDep) -> MyProfile:
    return await repo.get_profile(require_pool(state), user.id)


@router.patch("")
async def update_me(body: UpdateProfileRequest, user: CurrentUser, state: StateDep) -> MyProfile:
    return await repo.update_profile(
        require_pool(state),
        user.id,
        handle=body.handle,
        display_name=body.display_name,
        share_likes=body.share_likes,
    )


@router.get("/preferences")
async def get_preferences(user: CurrentUser, state: StateDep) -> Preferences:
    return await repo.get_preferences(require_pool(state), user.id)


@router.put("/preferences")
async def put_preferences(body: Preferences, user: CurrentUser, state: StateDep) -> Preferences:
    return await repo.put_preferences(require_pool(state), user.id, body)


@router.get("/invites")
async def my_invites(user: CurrentUser, state: StateDep) -> InvitesResponse:
    return InvitesResponse(invites=await repo.pending_invites(require_pool(state), user.id))
