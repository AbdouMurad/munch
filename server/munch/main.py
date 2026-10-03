"""FastAPI app: `uv run uvicorn munch.main:app --reload --port 8000` (single worker, see §6)."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from munch.config import Settings, get_settings
from munch.models import ErrorBody, ErrorCode, ErrorResponse, HealthResponse
from munch.rooms.manager import RoomError, RoomManager

log = logging.getLogger("munch")

ROOM_ERROR_STATUS: dict[ErrorCode, int] = {
    "NOT_FOUND": 404,
    "BAD_STATE": 409,
    "NOT_HOST": 403,
    "UNAUTHORIZED": 401,
}


def error_response(status: int, code: ErrorCode, message: str) -> JSONResponse:
    body = ErrorResponse(error=ErrorBody(code=code, message=message))
    return JSONResponse(status_code=status, content=body.model_dump(mode="json"))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    app.state.rooms = RoomManager(
        disconnect_grace=settings.disconnect_grace,
        terminal_ttl=settings.terminal_room_ttl,
        idle_ttl=settings.idle_room_ttl,
    )
    app.state.db_pool = None
    if settings.database_url:
        app.state.db_pool = await asyncpg.create_pool(settings.database_url, min_size=1)
    else:
        log.warning("DATABASE_URL not set: running without a DB (no persistence or /stats)")
    try:
        yield
    finally:
        if app.state.db_pool is not None:
            await app.state.db_pool.close()


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(RoomError)
    async def room_error(_: Request, exc: RoomError) -> JSONResponse:
        return error_response(ROOM_ERROR_STATUS.get(exc.code, 400), exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()))
        message = f"{where}: {first.get('msg', 'invalid request')}" if where else "invalid request"
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


def create_app(settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="Munch", lifespan=lifespan)
    app.state.settings = settings or get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[app.state.settings.web_origin],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    app.include_router(api)
    return app


app = create_app()
