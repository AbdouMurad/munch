"""In-memory live rooms and match logic (DESIGN.md §6).

The realtime layer owns sockets, broadcasting and DB writes. This module only mutates state
and returns what happened. Every method is synchronous, so no caller can `await` between a
check and the update it guards.
"""

import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from munch.models import (
    Card,
    ErrorCode,
    Filters,
    LatLng,
    Member,
    RoomExhaustedPayload,
    RoomMatchedPayload,
    RoomState,
    RoomStatus,
    TopPick,
)

CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O, 1/I
CODE_LENGTH = 6
TOP_PICKS = 3
TERMINAL: frozenset[RoomStatus] = frozenset({"matched", "exhausted", "closed"})

Outcome = RoomMatchedPayload | RoomExhaustedPayload


class RoomError(Exception):
    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message


@dataclass
class LiveMember:
    id: str
    display_name: str
    token: str
    is_host: bool
    joined_at: datetime
    progress: int = 0
    left_at: datetime | None = None
    connections: int = 0
    # Set while no socket is open (including before the first connect).
    disconnected_at: datetime | None = None

    @property
    def active(self) -> bool:
        return self.left_at is None


@dataclass
class LiveRoom:
    id: str
    code: str
    status: RoomStatus
    center: LatLng
    radius_m: int
    filters: Filters
    seed: int
    created_at: datetime
    last_activity: datetime
    members: dict[str, LiveMember] = field(default_factory=dict)  # insertion order = join order
    deck: list[Card] = field(default_factory=list)
    likes: dict[str, set[str]] = field(default_factory=dict)  # restaurant_id → member ids
    swiped: dict[str, set[str]] = field(default_factory=dict)  # member_id → restaurant ids
    starting: bool = False  # deck is being built; blocks a second Start
    ended_at: datetime | None = None

    def active_members(self) -> list[LiveMember]:
        return [m for m in self.members.values() if m.active]

    def to_state(self) -> RoomState:
        return RoomState(
            room_id=self.id,
            code=self.code,
            status=self.status,
            members=[
                Member(id=m.id, display_name=m.display_name, is_host=m.is_host, progress=m.progress)
                for m in self.active_members()
            ],
            center=self.center,
            radius_m=self.radius_m,
            filters=self.filters,
            deck_size=len(self.deck),
        )


@dataclass
class SwipeResult:
    progress: int
    outcome: Outcome | None


@dataclass
class SweepResult:
    changed: list[tuple[LiveRoom, Outcome | None]]  # members timed out; broadcast room:state
    removed: list[LiveRoom]  # dropped from memory; close any remaining sockets


def _utcnow() -> datetime:
    return datetime.now(UTC)


class RoomManager:
    def __init__(
        self,
        *,
        disconnect_grace: timedelta = timedelta(minutes=2),
        terminal_ttl: timedelta = timedelta(minutes=30),
        idle_ttl: timedelta = timedelta(hours=2),
        clock: Callable[[], datetime] = _utcnow,
    ) -> None:
        self._rooms: dict[str, LiveRoom] = {}
        self._disconnect_grace = disconnect_grace
        self._terminal_ttl = terminal_ttl
        self._idle_ttl = idle_ttl
        self._clock = clock

    # --- Lookup ---------------------------------------------------------------

    def get(self, code: str) -> LiveRoom:
        room = self._rooms.get(code.upper())
        if room is None:
            raise RoomError("NOT_FOUND", "No room with that code")
        return room

    def authenticate(self, code: str, member_id: str, token: str) -> tuple[LiveRoom, LiveMember]:
        room = self._rooms.get(code.upper())
        member = room.members.get(member_id) if room else None
        if (
            room is None
            or member is None
            or not member.active
            or not secrets.compare_digest(member.token, token)
        ):
            raise RoomError("UNAUTHORIZED", "Bad room code, member id or token")
        return room, member

    # --- Lobby ----------------------------------------------------------------

    def create_room(
        self, display_name: str, center: LatLng, radius_m: int, filters: Filters
    ) -> tuple[LiveRoom, LiveMember]:
        now = self._clock()
        room = LiveRoom(
            id=str(uuid.uuid4()),
            code=self._new_code(),
            status="lobby",
            center=center,
            radius_m=radius_m,
            filters=filters,
            seed=secrets.randbits(63),  # fits Postgres bigint
            created_at=now,
            last_activity=now,
        )
        self._rooms[room.code] = room
        return room, self._add_member(room, display_name, is_host=True)

    def join_room(self, code: str, display_name: str) -> tuple[LiveRoom, LiveMember]:
        room = self.get(code)
        if room.status != "lobby":
            raise RoomError("BAD_STATE", "This room has already started")
        return room, self._add_member(room, display_name, is_host=False)

    def begin_start(self, room: LiveRoom, member_id: str) -> None:
        """Validate a Start and lock the room while the caller builds the deck."""
        if not room.members[member_id].is_host:
            raise RoomError("NOT_HOST", "Only the host can start")
        if room.status != "lobby" or room.starting:
            raise RoomError("BAD_STATE", "Room is not waiting to start")
        room.starting = True
        room.last_activity = self._clock()

    def abort_start(self, room: LiveRoom) -> None:
        room.starting = False

    def finish_start(self, room: LiveRoom, deck: list[Card]) -> Outcome | None:
        """Deal the deck. Returns an outcome only if the deck is empty (instant exhaustion)."""
        room.starting = False
        if room.status != "lobby":  # everyone left while the deck was building
            return None
        room.status = "swiping"
        room.deck = deck
        room.likes = {}
        room.swiped = {m.id: set() for m in room.members.values()}
        room.last_activity = self._clock()
        return self._check_exhausted(room)

    # --- Swiping --------------------------------------------------------------

    def swipe(
        self, room: LiveRoom, member_id: str, restaurant_id: str, liked: bool
    ) -> SwipeResult | None:
        """Record a swipe. Returns None if ignored (bad state, repeat or unknown card)."""
        member = room.members[member_id]
        seen = room.swiped.setdefault(member_id, set())
        if (
            room.status != "swiping"
            or not member.active
            or restaurant_id in seen
            or not any(c.id == restaurant_id for c in room.deck)
        ):
            return None

        seen.add(restaurant_id)
        member.progress = len(seen)
        if liked:
            room.likes.setdefault(restaurant_id, set()).add(member_id)
        room.last_activity = self._clock()

        outcome: Outcome | None = None
        if liked:
            outcome = self._check_match(room, [restaurant_id])
        if outcome is None:
            outcome = self._check_exhausted(room)
        return SwipeResult(progress=member.progress, outcome=outcome)

    # --- Leaving and connections ----------------------------------------------

    def leave(self, room: LiveRoom, member_id: str) -> Outcome | None:
        """Remove a member from the quorum. May trigger a match, exhaustion or close the room."""
        member = room.members[member_id]
        if not member.active:
            return None
        now = self._clock()
        member.left_at = now
        room.last_activity = now

        remaining = room.active_members()
        if member.is_host:
            member.is_host = False
            if remaining:
                remaining[0].is_host = True  # oldest remaining member

        if not remaining:
            if room.status not in TERMINAL:
                self._end(room, "closed")
            return None
        if room.status != "swiping":
            return None
        # The quorum shrank, so a restaurant that wasn't unanimous before might be now.
        return self._check_match(room, [c.id for c in room.deck]) or self._check_exhausted(room)

    def connect(self, member: LiveMember) -> None:
        member.connections += 1
        member.disconnected_at = None

    def disconnect(self, member: LiveMember) -> None:
        member.connections = max(0, member.connections - 1)
        if member.connections == 0:
            member.disconnected_at = self._clock()

    def sweep(self) -> SweepResult:
        """Time out disconnected members and drop stale rooms. Call periodically."""
        now = self._clock()
        result = SweepResult(changed=[], removed=[])
        for code, room in list(self._rooms.items()):
            if room.status == "swiping":
                expired = [
                    m
                    for m in room.active_members()
                    if m.disconnected_at is not None
                    and now - m.disconnected_at >= self._disconnect_grace
                ]
                if expired:
                    outcome: Outcome | None = None
                    for m in expired:
                        outcome = self.leave(room, m.id) or outcome
                    result.changed.append((room, outcome))

            terminal_expired = (
                room.ended_at is not None and now - room.ended_at >= self._terminal_ttl
            )
            if terminal_expired or now - room.last_activity >= self._idle_ttl:
                del self._rooms[code]
                result.removed.append(room)
        return result

    # --- Internals ------------------------------------------------------------

    def _new_code(self) -> str:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))
            if code not in self._rooms:
                return code

    def _add_member(self, room: LiveRoom, display_name: str, *, is_host: bool) -> LiveMember:
        now = self._clock()
        member = LiveMember(
            id=str(uuid.uuid4()),
            display_name=display_name,
            token=secrets.token_urlsafe(32),
            is_host=is_host,
            joined_at=now,
            disconnected_at=now,
        )
        room.members[member.id] = member
        room.last_activity = now
        return member

    def _end(self, room: LiveRoom, status: RoomStatus) -> None:
        room.status = status
        room.ended_at = self._clock()

    def _check_match(self, room: LiveRoom, restaurant_ids: list[str]) -> Outcome | None:
        """First restaurant (in the given order) liked by every active member wins."""
        active = [m.id for m in room.active_members()]
        if not active:
            return None
        for rid in restaurant_ids:
            likers = room.likes.get(rid, set())
            if all(mid in likers for mid in active):
                self._end(room, "matched")
                card = next(c for c in room.deck if c.id == rid)
                liked_by = [mid for mid in room.members if mid in likers]
                return RoomMatchedPayload(card=card, liked_by=liked_by)
        return None

    def _check_exhausted(self, room: LiveRoom) -> Outcome | None:
        active = room.active_members()
        if not active or any(m.progress < len(room.deck) for m in active):
            return None
        self._end(room, "exhausted")
        return RoomExhaustedPayload(top_picks=top_picks(room))


def top_picks(room: LiveRoom, n: int = TOP_PICKS) -> list[TopPick]:
    """Most-liked cards, ties broken by deck position. Cards nobody liked are left out."""
    liked = [(len(room.likes.get(c.id, ())), i, c) for i, c in enumerate(room.deck)]
    liked = [t for t in liked if t[0] > 0]
    liked.sort(key=lambda t: (-t[0], t[1]))
    return [TopPick(card=c, likes=n_likes) for n_likes, _, c in liked[:n]]
