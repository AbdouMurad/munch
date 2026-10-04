"""Friends: list, add (by handle or from a room member), accept, remove."""

from fastapi import APIRouter, Response

from munch.accounts import repo
from munch.accounts.deps import CurrentUser, require_pool
from munch.accounts.errors import AccountError
from munch.models import AddFriendRequest, Friendship, FriendsResponse
from munch.state import StateDep

router = APIRouter(prefix="/friends", tags=["friends"])


@router.get("")
async def list_friends(user: CurrentUser, state: StateDep) -> FriendsResponse:
    return await repo.list_friendships(require_pool(state), user.id)


@router.post("")
async def add_friend(body: AddFriendRequest, user: CurrentUser, state: StateDep) -> Friendship:
    """Send a friend request. If they already asked you, you become friends."""
    pool = require_pool(state)
    if body.handle is not None:
        other = await repo.find_by_handle(pool, body.handle)
    else:
        assert body.user_id is not None
        other = await repo.get_public_user(pool, body.user_id)
    if other is None:
        raise AccountError("NOT_FOUND", "No such user")
    status = await repo.request_friend(pool, user.id, other.id)
    return Friendship(user=other, status=status, since=None)


@router.post("/{user_id}/accept", status_code=204)
async def accept_friend(user_id: str, user: CurrentUser, state: StateDep) -> Response:
    await repo.accept_friend(require_pool(state), user.id, user_id)
    return Response(status_code=204)


@router.delete("/{user_id}", status_code=204)
async def remove_friend(user_id: str, user: CurrentUser, state: StateDep) -> Response:
    """Unfriend, decline a request, or cancel one you sent."""
    await repo.remove_friend(require_pool(state), user.id, user_id)
    return Response(status_code=204)
