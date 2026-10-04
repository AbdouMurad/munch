"""Sign in with Google or an emailed code; sign out (DESIGN.md §5.5)."""

import logging
from typing import Any

from fastapi import APIRouter, Response

from munch.accounts import repo
from munch.accounts.deps import CurrentUser, require_pool
from munch.accounts.errors import AccountError
from munch.models import (
    AuthResponse,
    EmailCodeRequest,
    EmailCodeVerifyRequest,
    ErrorResponse,
    GoogleSignInRequest,
)
from munch.state import StateDep

log = logging.getLogger("munch.accounts")

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


@router.post("/email/start", status_code=204, responses=ERRORS)
async def email_start(body: EmailCodeRequest, state: StateDep) -> Response:
    """Send a 6-digit code. For now it is only written to the server log."""
    pool = require_pool(state)
    code = await repo.create_login_code(
        pool, body.email, state.settings.login_code_ttl, state.settings.login_codes_per_hour
    )
    log.warning("Login code for %s: %s", body.email, code)
    return Response(status_code=204)


@router.post("/email/verify", responses=ERRORS)
async def email_verify(body: EmailCodeVerifyRequest, state: StateDep) -> AuthResponse:
    pool = require_pool(state)
    ok = await repo.verify_login_code(
        pool, body.email, body.code, state.settings.login_code_max_attempts
    )
    if not ok:
        raise AccountError("INVALID_CODE", "Wrong or expired code")
    user, created = await repo.sign_in_with_identity(
        pool,
        provider="email",
        subject=body.email,
        email=body.email,
        display_name=body.email.split("@")[0],
        avatar_url=None,
    )
    token = await repo.create_session(pool, user.id, state.settings.session_ttl)
    return AuthResponse(session_token=token, user=user, is_new=created)


@router.post("/logout", status_code=204)
async def logout(user: CurrentUser, state: StateDep) -> Response:
    await repo.delete_session(require_pool(state), user.token_hash)
    return Response(status_code=204)
