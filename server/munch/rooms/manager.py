"""In-memory live rooms and match logic (DESIGN.md §6).

The realtime layer owns sockets, broadcasting and DB writes. This module only mutates state
and returns what happened. Every method is synchronous, so no caller can `await` between a
check and the update it guards.
"""

import math
import random
import secrets
import uuid
from bisect import bisect_right
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
EXPAND_STEP_M = 2000  # "search farther" adds this much radius by default
MAX_RADIUS_M = 50_000  # Places/PostGIS sanity cap, same as models.RadiusM
# Each player swipes the deck in their own order: a card moves up to this many places
# from its ranked position, so the best places stay near the front for everyone but
# nobody sees the same sequence as their friends.
SHUFFLE_WINDOW = 12
TERMINAL: frozenset[RoomStatus] = frozenset({"matched", "exhausted", "closed"})

Outcome = RoomMatchedPayload | RoomExhaustedPayload


def personal_order(
    deck: list[Card], batch_starts: list[int], seed: int, member_id: str
) -> list[Card]:
    """One player's order of the room's deck: the same cards, nudged around by up to
    SHUFFLE_WINDOW places. Deterministic per (room seed, member), so a reconnect gets the
    same order. Cards from a later "search farther" batch always come after earlier ones,
    so appending a batch never reorders cards a player has already swiped."""

    def key(item: tuple[int, Card]) -> tuple[int, float]:
        i, card = item
        batch = bisect_right(batch_starts, i) - 1
        nudge = random.Random(f"{seed}:{member_id}:{card.id}").uniform(0, SHUFFLE_WINDOW)
        return batch, i + nudge

    return [card for _, card in sorted(enumerate(deck), key=key)]


def match_threshold(active: int) -> int:
    """Likes a restaurant needs to match: two thirds of the active players, rounded up.
    2 players -> 2, 3 -> 2, 4 -> 3, 5 -> 4, 6 -> 4. A pair still has to agree."""
    return max(1, math.ceil(2 * active / 3))


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
    user_id: str | None = None  # signed-in account; None for guests
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
    expanding: bool = False  # extra cards are being built; blocks a second "search farther"
    expansions: int = 0  # how many times the search was widened (varies the seed)
    batch_starts: list[int] = field(default_factory=lambda: [0])  # deck index of each batch
    ended_at: datetime | None = None
    outcome: Outcome | None = None  # replayed to clients that reconnect after the end

    def active_members(self) -> list[LiveMember]:
        return [m for m in self.members.values() if m.active]

    def deck_for(self, member_id: str) -> list[Card]:
        """The deck in this member's own order (see personal_order)."""
        return personal_order(self.deck, self.batch_starts, self.seed, member_id)

    def to_state(self) -> RoomState:
        return RoomState(
            room_id=self.id,
            code=self.code,
            status=self.status,
            members=[
                Member(
                    id=m.id,
                    display_name=m.display_name,
                    is_host=m.is_host,
                    progress=m.progress,
                    user_id=m.user_id,
                )
                for m in self.active_members()
            ],
            center=self.center,
            radius_m=self.radius_m,
            filters=self.filters,
            deck_size=len(self.deck),
            match_threshold=match_threshold(len(self.active_members())),
        )


@dataclass
class SwipeResult:
    progress: int
    outcome: Outcome | None  # the game just ended: a match, or everyone ran out of cards


@dataclass
class Expansion:
    """What the caller needs to build the extra cards for a "search farther"."""

    radius_m: int
    seed: int
    exclude: frozenset[str]  # every restaurant already dealt, never dealt twice


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
        self,
        display_name: str,
        center: LatLng,
        radius_m: int,
        filters: Filters,
        *,
        user_id: str | None = None,
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
        return room, self._add_member(room, display_name, is_host=True, user_id=user_id)

    def join_room(
        self, code: str, display_name: str, *, user_id: str | None = None
    ) -> tuple[LiveRoom, LiveMember]:
        room = self.get(code)
        if room.status != "lobby":
            raise RoomError("BAD_STATE", "This room has already started")
        if user_id is not None:  # an account joining twice (e.g. a second invite) reuses its seat
            for m in room.active_members():
                if m.user_id == user_id:
                    return room, m
        return room, self._add_member(room, display_name, is_host=False, user_id=user_id)

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
        room.batch_starts = [0]
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

        outcome = self._check_match(room, [restaurant_id]) if liked else None
        return SwipeResult(progress=member.progress, outcome=outcome or self._check_exhausted(room))

    # --- Searching farther and playing again ----------------------------------

    def begin_expand(self, room: LiveRoom, member_id: str, radius_m: int | None) -> Expansion:
        """Validate a "search farther" and lock it while the caller builds the cards."""
        if not room.members[member_id].is_host:
            raise RoomError("NOT_HOST", "Only the host can search farther")
        if room.status != "swiping" or room.expanding:
            raise RoomError("BAD_STATE", "Can't search farther right now")
        new_radius = min(radius_m or room.radius_m + EXPAND_STEP_M, MAX_RADIUS_M)
        if new_radius <= room.radius_m:
            raise RoomError("BAD_STATE", "Already searching as far as possible")
        room.expanding = True
        room.last_activity = self._clock()
        return Expansion(
            radius_m=new_radius,
            seed=room.seed + room.expansions + 1,
            exclude=frozenset(c.id for c in room.deck),
        )

    def replay(self, room: LiveRoom) -> None:
        """Play again: once the game is over, any player puts the room back in the lobby.
        Same code and players (anyone who left stays gone, new friends can join), a fresh
        seed, and nothing carried over from the last game except the search radius."""
        if room.status == "lobby":
            return  # someone else already pressed Play again
        if room.status not in ("matched", "exhausted"):
            raise RoomError("BAD_STATE", "The game isn't over yet")
        room.status = "lobby"
        room.seed = secrets.randbits(63)
        room.deck = []
        room.batch_starts = [0]
        room.likes = {}
        room.swiped = {}
        room.outcome = None
        room.ended_at = None
        room.expansions = 0
        room.starting = room.expanding = False
        for m in room.members.values():
            m.progress = 0
        room.last_activity = self._clock()

    def abort_expand(self, room: LiveRoom) -> None:
        room.expanding = False

    def finish_expand(self, room: LiveRoom, radius_m: int, cards: list[Card]) -> list[Card]:
        """Append the new cards (skipping any already dealt). Returns what was added."""
        room.expanding = False
        if room.status != "swiping":  # the game ended while the cards were building
            return []
        dealt = {c.id for c in room.deck}
        added = [c for c in cards if c.id not in dealt]
        if added:
            room.batch_starts.append(len(room.deck))
        room.deck.extend(added)
        room.radius_m = radius_m
        room.expansions += 1
        room.last_activity = self._clock()
        return added

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
        # The quorum shrank, so the bar dropped: a restaurant just short of it may match now.
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

    def _add_member(
        self, room: LiveRoom, display_name: str, *, is_host: bool, user_id: str | None = None
    ) -> LiveMember:
        now = self._clock()
        member = LiveMember(
            id=str(uuid.uuid4()),
            display_name=display_name,
            token=secrets.token_urlsafe(32),
            is_host=is_host,
            joined_at=now,
            user_id=user_id,
            disconnected_at=now,
        )
        room.members[member.id] = member
        room.last_activity = now
        return member

    def _end(self, room: LiveRoom, status: RoomStatus, outcome: Outcome | None = None) -> None:
        room.status = status
        room.ended_at = self._clock()
        room.outcome = outcome

    def _check_match(self, room: LiveRoom, restaurant_ids: list[str]) -> Outcome | None:
        """The first restaurant (in the given order) liked by at least match_threshold active
        members wins, and the game ends."""
        active = {m.id for m in room.active_members()}
        if not active:
            return None
        needed = match_threshold(len(active))
        for rid in restaurant_ids:
            likers = room.likes.get(rid, set()) & active
            if len(likers) >= needed:
                card = next(c for c in room.deck if c.id == rid)
                liked_by = [mid for mid in room.members if mid in likers]
                matched = RoomMatchedPayload(card=card, liked_by=liked_by)
                self._end(room, "matched", matched)
                return matched
        return None

    def _check_exhausted(self, room: LiveRoom) -> Outcome | None:
        active = room.active_members()
        if not active or any(m.progress < len(room.deck) for m in active):
            return None
        exhausted = RoomExhaustedPayload(top_picks=top_picks(room))
        self._end(room, "exhausted", exhausted)
        return exhausted


def top_picks(room: LiveRoom, n: int = TOP_PICKS) -> list[TopPick]:
    """Most-liked cards, ties broken by deck position. Cards nobody liked are left out."""
    liked = [(len(room.likes.get(c.id, ())), i, c) for i, c in enumerate(room.deck)]
    liked = [t for t in liked if t[0] > 0]
    liked.sort(key=lambda t: (-t[0], t[1]))
    return [TopPick(card=c, likes=n_likes) for n_likes, _, c in liked[:n]]
