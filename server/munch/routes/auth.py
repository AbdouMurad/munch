"""Register and sign in with email + password, or with Google; sign out (DESIGN.md §5.5)."""

from typing import Any

from fastapi import APIRouter, Response

from munch.accounts import repo
from munch.accounts.deps import CurrentUser, require_pool
from munch.accounts.errors import AccountError
from munch.accounts.passwords import hash_password, verify_password
from munch.models import (
    AuthResponse,
    ErrorResponse,
    GoogleSignInRequest,
    LoginRequest,
    RegisterRequest,
)
from munch.state import StateDep

router = APIRouter(prefix="/auth", tags=["auth"])

ERRORS: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorResponse},
    401: {"model": ErrorResponse},
    429: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


@router.post("/google", responses=ERRORS)
async def google_sign_in(body: GoogleSignInRequest, state: StateDep) -> AuthResponse:
    pool = require_pool(state)
    who = await state.google.verify(body.id_token)
    user, created = await repo.sign_in_with_identity(
        pool,
        provider="google",
        subject=who.sub,
        email=who.email,
        display_name=who.name or (who.email or "").split("@")[0],
        avatar_url=who.picture,
    )
    token = await repo.create_session(pool, user.id, state.settings.session_ttl)
    return AuthResponse(session_token=token, user=user, is_new=created)


@router.post("/register", status_code=201, responses={**ERRORS, 409: {"model": ErrorResponse}})
async def register(body: RegisterRequest, state: StateDep) -> AuthResponse:
    """Create an account with email + password, name and handle, and sign in."""
    pool = require_pool(state)
    user = await repo.register_with_password(
        pool,
        email=body.email,
        password_hash=await hash_password(body.password),
        display_name=body.display_name,
        handle=body.handle,
    )
    token = await repo.create_session(pool, user.id, state.settings.session_ttl)
    return AuthResponse(session_token=token, user=user, is_new=True)


@router.post("/login", responses=ERRORS)
async def login(body: LoginRequest, state: StateDep) -> AuthResponse:
    """Sign in with email + password. A wrong email and a wrong password get the same answer,
    so nobody can use this to find out who has an account."""
    pool = require_pool(state)
    state.login_limiter.check(body.email)
    found = await repo.password_login(pool, body.email)
    if not await verify_password(body.password, found[1] if found else None):
        state.login_limiter.failed(body.email)
        raise AccountError("UNAUTHORIZED", "Wrong email or password")
    assert found is not None
    state.login_limiter.succeeded(body.email)
    await repo.touch_login(pool, "email", body.email)
    user = await repo.get_profile(pool, found[0])
    token = await repo.create_session(pool, user.id, state.settings.session_ttl)
    return AuthResponse(session_token=token, user=user, is_new=False)


@router.post("/logout", status_code=204)
async def logout(user: CurrentUser, state: StateDep) -> Response:
    await repo.delete_session(require_pool(state), user.token_hash)
    return Response(status_code=204)
