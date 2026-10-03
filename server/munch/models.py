"""THE CONTRACT (DESIGN.md §5). Frontend types are generated from this file via `make contracts`.

Python stays snake_case; JSON on the wire is camelCase.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, TypeAdapter
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
    )


RoomStatus = Literal["lobby", "swiping", "matched", "exhausted", "closed"]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=24)]
PriceLevel = Annotated[int, Field(ge=0, le=4)]
RadiusM = Annotated[int, Field(ge=100, le=50_000)]

DEFAULT_RADIUS_M = 3000


# --- Shared ---------------------------------------------------------------


class LatLng(CamelModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class Filters(CamelModel):
    price_levels: list[PriceLevel] | None = None  # None/empty = any
    # With price_levels set, also keep places Google has no price for (~16% of them).
    include_unknown_price: bool = True
    include_types: list[str] = []  # any of, e.g. ["sushi_restaurant", "ramen_restaurant"]
    exclude_types: list[str] = []  # e.g. ["fast_food_restaurant"]
    min_rating: Annotated[float, Field(ge=1, le=5)] | None = None
    min_reviews: Annotated[int, Field(ge=0)] = 0
    open_now: bool = False  # Vancouver time; drops places with no hours on file


class Member(CamelModel):
    id: str
    display_name: str
    is_host: bool
    progress: int  # number of cards swiped


class Card(CamelModel):
    id: str  # google place id
    name: str
    lat: float
    lng: float
    distance_m: float  # from room center
    rating: float | None
    rating_count: int
    price_level: int | None
    primary_type: str | None  # display: 'ramen_restaurant' → 'Ramen'
    address: str | None
    photo_url: str | None  # '/api/photos/{id}' (server proxy) or None
    maps_uri: str | None


class RoomState(CamelModel):
    room_id: str
    code: str
    status: RoomStatus
    members: list[Member]
    center: LatLng
    radius_m: int
    filters: Filters
    deck_size: int  # 0 until started


class TopPick(CamelModel):
    card: Card
    likes: int


# --- REST (§5.2) ----------------------------------------------------------


class CreateRoomRequest(CamelModel):
    display_name: DisplayName
    center: LatLng
    radius_m: RadiusM = DEFAULT_RADIUS_M
    filters: Filters = Field(default_factory=Filters)


class JoinRoomRequest(CamelModel):
    display_name: DisplayName


class RoomSession(CamelModel):
    """Response to create and join. The client keeps this in localStorage."""

    room_id: str
    code: str
    member_id: str
    member_token: str


class SwipesPerMinutePoint(CamelModel):
    t: datetime
    count: int


class TopRestaurant(CamelModel):
    id: str
    name: str
    likes: int
    swipes: int


class StatsResponse(CamelModel):
    swipes_per_minute: list[SwipesPerMinutePoint]
    top_restaurants: list[TopRestaurant]


class HealthResponse(CamelModel):
    ok: bool


ErrorCode = Literal[
    "NOT_FOUND",
    "BAD_STATE",
    "NOT_HOST",
    "UNAUTHORIZED",
    "VALIDATION_ERROR",
    "INTERNAL",
]


class ErrorBody(CamelModel):
    code: ErrorCode
    message: str


class ErrorResponse(CamelModel):
    error: ErrorBody


# --- WebSocket (§5.3): every message is {"type": ..., "payload": {...}} -----


class EmptyPayload(CamelModel):
    pass


# Client → Server


class RoomStartMessage(CamelModel):
    type: Literal["room:start"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class SwipePayload(CamelModel):
    restaurant_id: str
    liked: bool


class SwipeMessage(CamelModel):
    type: Literal["swipe"]
    payload: SwipePayload


class RoomLeaveMessage(CamelModel):
    type: Literal["room:leave"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


class RoomRerunPayload(CamelModel):
    radius_m: RadiusM | None = None


class RoomRerunMessage(CamelModel):
    type: Literal["room:rerun"]
    payload: RoomRerunPayload = Field(default_factory=RoomRerunPayload)


class PingMessage(CamelModel):
    type: Literal["ping"]
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


ClientMessage = Annotated[
    RoomStartMessage | SwipeMessage | RoomLeaveMessage | RoomRerunMessage | PingMessage,
    Field(discriminator="type"),
]
client_message_adapter: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


# Server → Client


class RoomStateMessage(CamelModel):
    type: Literal["room:state"] = "room:state"
    payload: RoomState


class RoomStartedPayload(CamelModel):
    deck: list[Card]
    resume_at: int  # this member's own progress


class RoomStartedMessage(CamelModel):
    type: Literal["room:started"] = "room:started"
    payload: RoomStartedPayload


class MemberProgressPayload(CamelModel):
    member_id: str
    progress: int


class MemberProgressMessage(CamelModel):
    type: Literal["member:progress"] = "member:progress"
    payload: MemberProgressPayload


class RoomMatchedPayload(CamelModel):
    card: Card
    liked_by: list[str]


class RoomMatchedMessage(CamelModel):
    type: Literal["room:matched"] = "room:matched"
    payload: RoomMatchedPayload


class RoomExhaustedPayload(CamelModel):
    top_picks: list[TopPick]


class RoomExhaustedMessage(CamelModel):
    type: Literal["room:exhausted"] = "room:exhausted"
    payload: RoomExhaustedPayload


class ErrorMessage(CamelModel):
    type: Literal["error"] = "error"
    payload: ErrorBody


class PongMessage(CamelModel):
    type: Literal["pong"] = "pong"
    payload: EmptyPayload = Field(default_factory=EmptyPayload)


ServerMessage = Annotated[
    RoomStateMessage
    | RoomStartedMessage
    | MemberProgressMessage
    | RoomMatchedMessage
    | RoomExhaustedMessage
    | ErrorMessage
    | PongMessage,
    Field(discriminator="type"),
]
server_message_adapter: TypeAdapter[ServerMessage] = TypeAdapter(ServerMessage)
