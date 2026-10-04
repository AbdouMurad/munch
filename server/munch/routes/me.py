"""The signed-in user's own profile, preferences and invites."""

from fastapi import APIRouter, Request

from munch.accounts import repo
from munch.accounts.avatars import MAX_AVATAR_BYTES, check_avatar
from munch.accounts.deps import CurrentUser, require_pool
from munch.accounts.errors import AccountError
from munch.models import (
    InvitesResponse,
    MyProfile,
    Preferences,
    UpdateProfileRequest,
)
from munch.state import StateDep

router = APIRouter(prefix="/me", tags=["me"])

IMAGE_TYPES = ("image/jpeg", "image/png", "image/webp")


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


@router.put(
    "/avatar",
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {t: {"schema": {"type": "string", "format": "binary"}} for t in IMAGE_TYPES},
        }
    },
)
async def upload_avatar(request: Request, user: CurrentUser, state: StateDep) -> MyProfile:
    """Set my profile picture. The body is the image file itself (JPEG, PNG or WebP, max 1 MB),
    not JSON. Returns my profile with the new avatarUrl."""
    if int(request.headers.get("content-length") or 0) > MAX_AVATAR_BYTES:
        raise AccountError("VALIDATION_ERROR", "Image is too big (max 1 MB)")
    data = await request.body()
    content_type = check_avatar(data)
    return await repo.set_avatar(require_pool(state), user.id, content_type, data)


@router.delete("/avatar")
async def delete_avatar(user: CurrentUser, state: StateDep) -> MyProfile:
    """Remove my profile picture (back to initials)."""
    return await repo.remove_avatar(require_pool(state), user.id)


@router.get("/preferences")
async def get_preferences(user: CurrentUser, state: StateDep) -> Preferences:
    return await repo.get_preferences(require_pool(state), user.id)


@router.put("/preferences")
async def put_preferences(body: Preferences, user: CurrentUser, state: StateDep) -> Preferences:
    return await repo.put_preferences(require_pool(state), user.id, body)


@router.get("/invites")
async def my_invites(user: CurrentUser, state: StateDep) -> InvitesResponse:
    return InvitesResponse(invites=await repo.pending_invites(require_pool(state), user.id))
