"""FastAPI dependencies: the DB pool, and who is calling (`Authorization: Bearer <token>`)."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Header

from munch.accounts import repo
from munch.accounts.errors import AccountError
from munch.accounts.tokens import hash_token
from munch.state import AppState, StateDep


@dataclass(frozen=True)
class AuthUser:
    id: str
    token_hash: bytes  # this session, e.g. for logout


def require_pool(state: AppState) -> repo.Pool:
    if state.db_pool is None:
        raise AccountError("UNAVAILABLE", "Accounts need the database (DATABASE_URL)")
    return state.db_pool


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


async def user_for_token(state: AppState, token: str) -> AuthUser | None:
    token_hash = hash_token(token)
    user_id = await repo.session_user_id(require_pool(state), token_hash)
    return AuthUser(id=user_id, token_hash=token_hash) if user_id else None


async def current_user(
    state: StateDep, authorization: Annotated[str | None, Header()] = None
) -> AuthUser:
    token = bearer_token(authorization)
    if token is None:
        raise AccountError("UNAUTHORIZED", "Sign in first")
    user = await user_for_token(state, token)
    if user is None:
        raise AccountError("UNAUTHORIZED", "Session expired; sign in again")
    return user


async def optional_user(
    state: StateDep, authorization: Annotated[str | None, Header()] = None
) -> AuthUser | None:
    """For endpoints guests can use too. A missing, stale or unusable token means guest."""
    token = bearer_token(authorization)
    if token is None or state.db_pool is None:
        return None
    return await user_for_token(state, token)


CurrentUser = Annotated[AuthUser, Depends(current_user)]
OptionalUser = Annotated[AuthUser | None, Depends(optional_user)]
