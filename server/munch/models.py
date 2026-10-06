"""THE CONTRACT (DESIGN.md §5). Frontend types are generated from this file via `make contracts`.

Python stays snake_case; JSON on the wire is camelCase.
"""

import re
from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    TypeAdapter,
    model_validator,
)
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
    open_now: bool = False  # the room's local time; drops places with no hours on file


class Member(CamelModel):
    id: str
    display_name: str
    is_host: bool
    progress: int  # number of cards swiped
    user_id: str | None = None  # signed-in account, for "add friend"; None for guests
    avatar_url: str | None = None  # their profile picture, if signed in and they have one


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
    radius_m: int  # grows when the host searches farther mid-game
    filters: Filters
    deck_size: int  # 0 until started; grows when the host searches farther
    match_threshold: int = 0  # likes needed to match: ceil(2/3 of active members)


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
    "FORBIDDEN",
    "VALIDATION_ERROR",
    "HANDLE_TAKEN",
    "HANDLE_LOCKED",  # a handle is picked once and can't be changed
    "EMAIL_TAKEN",  # registering an email that already has an account
    "RATE_LIMITED",
    "UNAVAILABLE",  # needs the DB and it isn't configured
    "INTERNAL",
]


class ErrorBody(CamelModel):
    code: ErrorCode
    message: str


class ErrorResponse(CamelModel):
    error: ErrorBody


# --- Accounts (§5.5). Authenticated calls send `Authorization: Bearer <sessionToken>` ----

HANDLE_RULE = "Handles need 3-20 letters, numbers or _"


def _clean_handle(value: object) -> object:
    """Accept "@sam_eats" too: people often type the @ they see in the app."""
    return value.strip().removeprefix("@").strip() if isinstance(value, str) else value


def _check_handle(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]{3,20}", value):
        raise ValueError(HANDLE_RULE)
    return value


Handle = Annotated[
    str,
    BeforeValidator(_clean_handle),
    AfterValidator(_check_handle),
    Field(description=HANDLE_RULE, examples=["sam_eats"]),
]
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]
Dietary = Literal["vegetarian", "vegan", "halal", "gluten_free"]
FriendshipStatus = Literal["none", "outgoing", "incoming", "friends"]


class GoogleSignInRequest(CamelModel):
    id_token: str  # from Google Sign-In on the device; verified by the server


PASSWORD_RULE = "Passwords need at least 8 characters"


def _check_password(value: str) -> str:
    if len(value) < 8:
        raise ValueError(PASSWORD_RULE)
    return value


# Never trimmed or changed: spaces are allowed and count.
Password = Annotated[
    str, Field(max_length=128, description=PASSWORD_RULE), AfterValidator(_check_password)
]


class RegisterRequest(CamelModel):
    """Create an account with an email and password, plus how friends will see you."""

    email: Email
    password: Password
    display_name: DisplayName
    handle: Handle


class LoginRequest(CamelModel):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=128)]


class MyProfile(CamelModel):
    id: str
    handle: str | None  # None until picked; needed to be found by friends
    display_name: str
    email: str | None
    avatar_url: str | None
    share_likes: bool


class AuthResponse(CamelModel):
    session_token: str  # store securely on the device; shown only once
    user: MyProfile
    is_new: bool  # first sign-in: show onboarding (pick a handle)


class UpdateProfileRequest(CamelModel):
    """Only the fields that are set are changed."""

    handle: Handle | None = None
    display_name: DisplayName | None = None
    share_likes: bool | None = None


class PublicUser(CamelModel):
    """Another user as everyone else sees them. Never includes the email."""

    id: str
    handle: str | None
    display_name: str
    avatar_url: str | None


class Preferences(CamelModel):
    price_levels: list[PriceLevel] | None = None  # None = any
    exclude_types: list[str] = []  # Google place types never to show
    favorite_types: list[str] = []  # Google place types to boost
    dietary: list[Dietary] = []
    max_radius_m: RadiusM | None = None


class AddFriendRequest(CamelModel):
    """Exactly one of the two: a handle typed in, or a user id from a room member."""

    handle: Handle | None = None
    user_id: str | None = None

    @model_validator(mode="after")
    def exactly_one(self) -> "AddFriendRequest":
        if (self.handle is None) == (self.user_id is None):
            raise ValueError("send exactly one of handle or userId")
        return self


class Friendship(CamelModel):
    user: PublicUser
    status: FriendshipStatus
    since: datetime | None  # when it was requested, or accepted once friends


class FriendsResponse(CamelModel):
    friends: list[Friendship]
    incoming: list[Friendship]  # requests waiting for me
    outgoing: list[Friendship]  # requests I sent


class RoomInvite(CamelModel):
    id: str
    room_code: str
    from_user: PublicUser
    created_at: datetime
    expires_at: datetime


class InvitesResponse(CamelModel):
    invites: list[RoomInvite]


class SendInvitesRequest(CamelModel):
    user_ids: Annotated[list[str], Field(min_length=1, max_length=20)]


class SendInvitesResponse(CamelModel):
    invited: list[str]  # user ids that got an invite (friends only; repeats are skipped)


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


class RoomExpandPayload(CamelModel):
    radius_m: RadiusM | None = None  # None = the current radius + 2 km


class RoomExpandMessage(CamelModel):
    """Host widens the search mid-game; new, never-dealt cards go to the end of the deck."""

    type: Literal["room:expand"]
    payload: RoomExpandPayload = Field(default_factory=RoomExpandPayload)


class RoomReplayMessage(CamelModel):
    """After the game ends: put the same room (code, players) back in the lobby."""

    type: Literal["room:replay"]
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
    RoomStartMessage
    | SwipeMessage
    | RoomLeaveMessage
    | RoomExpandMessage
    | RoomReplayMessage
    | RoomRerunMessage
    | PingMessage,
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
    """The first restaurant enough of the room liked. It ends the game."""

    card: Card
    liked_by: list[str]


class RoomMatchedMessage(CamelModel):
    type: Literal["room:matched"] = "room:matched"
    payload: RoomMatchedPayload


class RoomExhaustedPayload(CamelModel):
    """Everyone swiped every card without a match."""

    top_picks: list[TopPick]


class RoomDeckExtendedPayload(CamelModel):
    cards: list[Card]  # append to the end of the deck
    radius_m: int  # the room's new search radius


class RoomDeckExtendedMessage(CamelModel):
    type: Literal["room:deck_extended"] = "room:deck_extended"
    payload: RoomDeckExtendedPayload


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
    | RoomDeckExtendedMessage
    | ErrorMessage
    | PongMessage,
    Field(discriminator="type"),
]
server_message_adapter: TypeAdapter[ServerMessage] = TypeAdapter(ServerMessage)


# /ws/me?token=<sessionToken>: per-user socket for live invites. Server → client only,
# plus ping/pong.


class InviteReceivedMessage(CamelModel):
    type: Literal["invite:received"] = "invite:received"
    payload: RoomInvite


UserServerMessage = Annotated[
    InviteReceivedMessage | ErrorMessage | PongMessage, Field(discriminator="type")
]
