from datetime import UTC, datetime, timedelta

import pytest

from munch.models import Card, Filters, LatLng, RoomExhaustedPayload, RoomMatchedPayload
from munch.rooms.manager import CODE_ALPHABET, LiveMember, LiveRoom, RoomError, RoomManager

CENTER = LatLng(lat=49.2827, lng=-123.1207)


class FakeClock:
    def __init__(self) -> None:
        self.now = datetime(2026, 1, 1, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs: float) -> None:
        self.now += timedelta(**kwargs)


def card(rid: str) -> Card:
    return Card(
        id=rid,
        name=rid.title(),
        lat=49.28,
        lng=-123.12,
        distance_m=100,
        rating=4.5,
        rating_count=100,
        price_level=2,
        primary_type="restaurant",
        address=None,
        photo_url=None,
        maps_uri=None,
    )


DECK = [card("a"), card("b"), card("c")]


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def mgr(clock: FakeClock) -> RoomManager:
    return RoomManager(clock=clock)


def room_with(mgr: RoomManager, n: int) -> tuple[LiveRoom, list[LiveMember]]:
    room, host = mgr.create_room("Host", CENTER, 3000, Filters())
    members = [host] + [mgr.join_room(room.code, f"M{i}")[1] for i in range(1, n)]
    return room, members


def started(mgr: RoomManager, n: int, deck: list[Card] = DECK) -> tuple[LiveRoom, list[str]]:
    room, members = room_with(mgr, n)
    mgr.begin_start(room, members[0].id)
    mgr.finish_start(room, list(deck))
    return room, [m.id for m in members]


# --- Lobby ----------------------------------------------------------------


def test_create_room_code_and_host(mgr: RoomManager) -> None:
    room, host = mgr.create_room("Sam", CENTER, 3000, Filters())
    assert len(room.code) == 6 and set(room.code) <= set(CODE_ALPHABET)
    assert host.is_host and room.status == "lobby"
    assert mgr.get(room.code.lower()) is room


def test_join_unknown_room(mgr: RoomManager) -> None:
    with pytest.raises(RoomError) as e:
        mgr.join_room("ZZZZZZ", "X")
    assert e.value.code == "NOT_FOUND"


def test_join_after_start_is_bad_state(mgr: RoomManager) -> None:
    room, _ = started(mgr, 2)
    with pytest.raises(RoomError) as e:
        mgr.join_room(room.code, "Late")
    assert e.value.code == "BAD_STATE"


def test_authenticate(mgr: RoomManager) -> None:
    room, (host,) = room_with(mgr, 1)
    assert mgr.authenticate(room.code, host.id, host.token) == (room, host)
    with pytest.raises(RoomError):
        mgr.authenticate(room.code, host.id, "wrong")


def test_only_host_can_start_and_only_once(mgr: RoomManager) -> None:
    room, (host, other) = room_with(mgr, 2)
    with pytest.raises(RoomError) as e:
        mgr.begin_start(room, other.id)
    assert e.value.code == "NOT_HOST"
    mgr.begin_start(room, host.id)
    with pytest.raises(RoomError) as e:
        mgr.begin_start(room, host.id)  # double tap while the deck builds
    assert e.value.code == "BAD_STATE"


def test_empty_deck_exhausts_immediately(mgr: RoomManager) -> None:
    room, (host,) = room_with(mgr, 1)
    mgr.begin_start(room, host.id)
    outcome = mgr.finish_start(room, [])
    assert isinstance(outcome, RoomExhaustedPayload) and outcome.top_picks == []


# --- Swiping --------------------------------------------------------------


def test_match_requires_everyone(mgr: RoomManager) -> None:
    room, (a, b, c) = started(mgr, 3)
    assert mgr.swipe(room, a, "b", True).outcome is None  # type: ignore[union-attr]
    assert mgr.swipe(room, b, "b", True).outcome is None  # type: ignore[union-attr]
    result = mgr.swipe(room, c, "b", True)
    assert result is not None
    assert isinstance(result.outcome, RoomMatchedPayload)
    assert result.outcome.card.id == "b"
    assert result.outcome.liked_by == [a, b, c]
    assert room.status == "matched"


def test_swipe_is_idempotent_and_validated(mgr: RoomManager) -> None:
    room, (a, _) = started(mgr, 2)
    first = mgr.swipe(room, a, "a", True)
    assert first is not None and first.progress == 1
    assert mgr.swipe(room, a, "a", False) is None  # repeat
    assert mgr.swipe(room, a, "nope", True) is None  # not in deck
    assert room.likes["a"] == {a}


def test_no_swipes_in_lobby(mgr: RoomManager) -> None:
    room, (host,) = room_with(mgr, 1)
    assert mgr.swipe(room, host.id, "a", True) is None


def test_exhaustion_top_picks(mgr: RoomManager) -> None:
    room, (a, b) = started(mgr, 2)
    for rid, a_likes, b_likes in [("a", False, True), ("b", True, False), ("c", True, False)]:
        mgr.swipe(room, a, rid, a_likes)
        result = mgr.swipe(room, b, rid, b_likes)
    assert result is not None
    assert isinstance(result.outcome, RoomExhaustedPayload)
    # all have 1 like, so deck order breaks the tie
    assert [(p.card.id, p.likes) for p in result.outcome.top_picks] == [
        ("a", 1),
        ("b", 1),
        ("c", 1),
    ]
    assert room.status == "exhausted"


# --- Leaving --------------------------------------------------------------


def test_leave_shrinks_quorum_and_matches(mgr: RoomManager) -> None:
    room, (a, b, c) = started(mgr, 3)
    mgr.swipe(room, a, "c", True)
    mgr.swipe(room, b, "c", True)
    mgr.swipe(room, a, "a", True)
    mgr.swipe(room, b, "a", True)
    outcome = mgr.leave(room, c)
    # both "a" and "c" are now unanimous; the earlier card in the deck wins
    assert isinstance(outcome, RoomMatchedPayload) and outcome.card.id == "a"


def test_leave_can_exhaust(mgr: RoomManager) -> None:
    room, (a, b) = started(mgr, 2)
    for rid in ("a", "b", "c"):
        mgr.swipe(room, a, rid, False)
    assert isinstance(mgr.leave(room, b), RoomExhaustedPayload)


def test_host_handoff_to_oldest(mgr: RoomManager) -> None:
    room, (host, second, third) = room_with(mgr, 3)
    mgr.leave(room, host.id)
    assert second.is_host and not third.is_host and not host.is_host
    assert [m.id for m in room.to_state().members] == [second.id, third.id]


def test_last_leave_closes(mgr: RoomManager) -> None:
    room, (host,) = room_with(mgr, 1)
    mgr.leave(room, host.id)
    assert room.status == "closed"


# --- Sweep ----------------------------------------------------------------


def test_disconnect_grace_only_while_swiping(mgr: RoomManager, clock: FakeClock) -> None:
    room, members = room_with(mgr, 2)
    host, other = members
    mgr.connect(host)
    clock.advance(minutes=5)  # `other` never connected, but we're still in the lobby
    assert mgr.sweep().changed == []
    assert other.active

    mgr.begin_start(room, host.id)
    mgr.finish_start(room, list(DECK))
    mgr.swipe(room, host.id, "a", True)
    clock.advance(seconds=1)
    result = mgr.sweep()
    assert not other.active
    # host liked "a" and is now the whole quorum
    assert len(result.changed) == 1
    outcome = result.changed[0][1]
    assert isinstance(outcome, RoomMatchedPayload) and outcome.card.id == "a"


def test_reconnect_within_grace_keeps_member(mgr: RoomManager, clock: FakeClock) -> None:
    room, (a, _) = started(mgr, 2)
    for m in room.members.values():
        mgr.connect(m)
    member = room.members[a]
    mgr.disconnect(member)
    clock.advance(seconds=90)
    mgr.connect(member)
    clock.advance(minutes=5)
    mgr.sweep()
    assert member.active


def test_rooms_are_cleaned_up(mgr: RoomManager, clock: FakeClock) -> None:
    room, (host,) = room_with(mgr, 1)
    mgr.leave(room, host.id)  # closed
    clock.advance(minutes=29)
    assert mgr.sweep().removed == []
    clock.advance(minutes=1)
    assert mgr.sweep().removed == [room]

    idle, _ = room_with(mgr, 1)
    clock.advance(hours=2)
    assert mgr.sweep().removed == [idle]
    with pytest.raises(RoomError):
        mgr.get(idle.code)
