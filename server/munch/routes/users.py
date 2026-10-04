"""Public things about other users. For now: their profile picture."""

from typing import Any

from fastapi import APIRouter, Response

from munch.accounts import repo
from munch.accounts.deps import require_pool
from munch.accounts.errors import AccountError
from munch.models import ErrorResponse
from munch.state import StateDep

router = APIRouter(prefix="/users", tags=["users"])

IMAGE: dict[int | str, dict[str, Any]] = {
    200: {"content": {"image/jpeg": {}, "image/png": {}, "image/webp": {}}},
    404: {"model": ErrorResponse},
}


@router.get("/{user_id}/avatar", response_class=Response, responses=IMAGE)
async def get_avatar(user_id: str, state: StateDep) -> Response:
    """The picture bytes. avatarUrl carries ?v=<version>, so it can be cached for good."""
    found = await repo.get_avatar(require_pool(state), user_id)
    if found is None:
        raise AccountError("NOT_FOUND", "No profile picture")
    content_type, data = found
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
