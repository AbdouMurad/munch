"""FastAPI app: `uv run uvicorn munch.main:app --reload --port 8000` (single worker, see §6)."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
import httpx
from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from munch.accounts.errors import AccountError
from munch.accounts.google import GoogleVerifier
from munch.accounts.passwords import LoginLimiter
from munch.config import Settings, get_settings
from munch.models import ErrorBody, ErrorCode, ErrorResponse, HealthResponse
from munch.photos.service import PhotoService, with_photo_warmup
from munch.ranking.deck import make_deck_builder
from munch.realtime import user_ws, ws
from munch.realtime.hub import Hub
from munch.realtime.sweeper import run_sweeper
from munch.rooms.fixture_deck import DeckBuilder, build_fixture_deck
from munch.rooms.manager import RoomError, RoomManager
from munch.routes import auth as auth_routes
from munch.routes import friends as friends_routes
from munch.routes import invites as invites_routes
from munch.routes import me as me_routes
from munch.routes import photos as photos_routes
from munch.routes import rooms as rooms_routes
from munch.routes import users as users_routes
from munch.state import AppState

log = logging.getLogger("munch")

ROOM_ERROR_STATUS: dict[ErrorCode, int] = {
    "NOT_FOUND": 404,
    "BAD_STATE": 409,
    "NOT_HOST": 403,
    "UNAUTHORIZED": 401,
    "FORBIDDEN": 403,
    "HANDLE_TAKEN": 409,
    "HANDLE_LOCKED": 409,
    "EMAIL_TAKEN": 409,
    "RATE_LIMITED": 429,
    "UNAVAILABLE": 503,
}


def error_response(status: int, code: ErrorCode, message: str) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message))
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    rooms = RoomManager(
        disconnect_grace=settings.disconnect_grace,
        terminal_ttl=settings.terminal_room_ttl,
        idle_ttl=settings.idle_room_ttl,
    )
    db_pool = None
    build_deck: DeckBuilder = build_fixture_deck
    if settings.database_url:
        db_pool = await asyncpg.create_pool(settings.database_url, min_size=1)
        build_deck = make_deck_builder(db_pool, settings)
    else:
        log.warning("DATABASE_URL not set: running without a DB (fixture deck, no /stats)")
    http = httpx.AsyncClient(timeout=10)
    photos = None
    if db_pool is not None and settings.google_places_api_key:
        photos = PhotoService(db_pool, http, settings.google_places_api_key)
        build_deck = with_photo_warmup(build_deck, photos)
    else:
        log.warning("Photos off: need DATABASE_URL and GOOGLE_PLACES_API_KEY")
    state = AppState(
        settings=settings,
        rooms=rooms,
        hub=Hub(),
        build_deck=build_deck,
        db_pool=db_pool,
        user_hub=Hub(),
        google=GoogleVerifier(settings.google_client_id_list),
        login_limiter=LoginLimiter(settings.login_max_failures, settings.login_lockout),
        photos=photos,
    )
    app.state.munch = state
    sweeper = asyncio.create_task(run_sweeper(rooms, state.hub))
    try:
        yield
    finally:
        sweeper.cancel()
        await http.aclose()
        if db_pool is not None:
            await db_pool.close()


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RoomError)
    async def room_error(_: Request, exc: RoomError) -> JSONResponse:
        return error_response(ROOM_ERROR_STATUS.get(exc.code, 400), exc.code, exc.message)

    @app.exception_handler(AccountError)
    async def account_error(_: Request, exc: AccountError) -> JSONResponse:
        return error_response(ROOM_ERROR_STATUS.get(exc.code, 400), exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()))
        msg = str(first.get("msg", "invalid request"))
        if msg.startswith("Value error, "):  # our own rules are already written for people
            message = msg.removeprefix("Value error, ")
        else:
            message = f"{where}: {msg}" if where else "invalid request"
        return error_response(422, "VALIDATION_ERROR", message)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code: ErrorCode = "NOT_FOUND" if exc.status_code == 404 else "INTERNAL"
        return error_response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error", exc_info=exc)
        return error_response(500, "INTERNAL", "Something went wrong")


api = APIRouter(prefix="/api")


@api.get("/health")
async def health() -> HealthResponse:
    return HealthResponse(ok=True)


api.include_router(rooms_routes.router)
api.include_router(photos_routes.router)
api.include_router(auth_routes.router)
api.include_router(me_routes.router)
api.include_router(friends_routes.router)
api.include_router(invites_routes.router)
api.include_router(users_routes.router)


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="Munch", lifespan=lifespan)
    app.state.settings = settings or get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app.state.settings.web_origin_list,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(api)
    app.include_router(user_ws.router)  # before ws: "/ws/me" would match "/ws/{code}"
    app.include_router(ws.router)
    return app


app = create_app()
