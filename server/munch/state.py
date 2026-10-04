"""Process-wide services, built in the app lifespan and injected with `Depends(get_state)`."""

from dataclasses import dataclass
from typing import Annotated, cast

import asyncpg
from fastapi import Depends
from starlette.requests import HTTPConnection

from munch.config import Settings
from munch.photos.service import PhotoService
from munch.realtime.hub import Hub
from munch.rooms.fixture_deck import DeckBuilder
from munch.rooms.manager import RoomManager


@dataclass
class AppState:
    settings: Settings
    rooms: RoomManager
    hub: Hub
    build_deck: DeckBuilder
    db_pool: "asyncpg.Pool[asyncpg.Record] | None"
    photos: PhotoService | None = None  # needs both the DB and the Google key


def get_state(conn: HTTPConnection) -> AppState:
    return cast(AppState, conn.app.state.munch)


StateDep = Annotated[AppState, Depends(get_state)]
