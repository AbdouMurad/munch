from datetime import UTC, datetime, timedelta

import pytest

from munch.models import (
    Card,
    Filters,
    LatLng,
    RoomExhaustedPayload,
    RoomMatchedPayload,
)
from munch.rooms.manager import (
    CODE_ALPHABET,
    SHUFFLE_WINDOW,
    LiveMember,
    LiveRoom,
    RoomError,
    RoomManager,
    match_threshold,
    personal_order,
)

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


@pytest.mark.parametrize("players,needed", [(1, 1), (2, 2), (3, 2), (4, 3), (5, 4), (6, 4), (8, 6)])
def test_match_threshold_is_two_thirds_rounded_up(players: int, needed: int) -> None:
    assert match_threshold(players) == needed


def test_first_match_on_two_thirds_wins(mgr: RoomManager) -> None:
    room, (a, b, _) = started(mgr, 3)
    first = mgr.swipe(room, a, "b", True)
    assert first is not None and first.outcome is None
    result = mgr.swipe(room, b, "b", True)  # 2 of 3 is enough
    assert result is not None and isinstance(result.outcome, RoomMatchedPayload)
    assert result.outcome.card.id == "b" and result.outcome.liked_by == [a, b]
    assert room.status == "matched"
    assert mgr.swipe(room, a, "c", True) is None  # the game is over


def test_pairs_must_agree(mgr: RoomManager) -> None:
    room, (a, _) = started(mgr, 2)
    result = mgr.swipe(room, a, "a", True)
    assert result is not None and result.outcome is None and room.status == "swiping"


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


def test_leave_lowers_the_bar_and_matches(mgr: RoomManager) -> None:
    room, (a, b, _, d) = started(mgr, 4)  # needs 3 of 4
    for rid in ("c", "a"):
        mgr.swipe(room, a, rid, True)
        mgr.swipe(room, b, rid, True)
    assert room.status == "swiping"
    outcome = mgr.leave(room, d)  # 3 left: 2 likes are enough now
    # both "a" and "c" qualify; the earlier card in the deck wins
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
    # host liked "a" and is now the whole room, so it's a match
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


# --- Play again -------------------------------------------------------------


def test_play_again_resets_to_lobby(mgr: RoomManager) -> None:
    room, (a, b) = started(mgr, 2)
    with pytest.raises(RoomError) as e:
        mgr.replay(room)  # still swiping
    assert e.value.code == "BAD_STATE"
    mgr.swipe(room, a, "c", True)
    mgr.swipe(room, b, "c", True)  # match: game over
    old_seed = room.seed

    mgr.replay(room)
    assert room.status == "lobby" and room.outcome is None and room.ended_at is None
    assert room.deck == [] and room.likes == {}
    assert all(m.progress == 0 for m in room.members.values())
    assert room.seed != old_seed
    mgr.replay(room)  # a second player pressing Play again is fine

    joined_room, late = mgr.join_room(room.code, "Late")  # new friends can join
    assert joined_room is room and late.active
    mgr.begin_start(room, a)  # and the host can start a new round
    assert mgr.finish_start(room, list(DECK)) is None
    status: str = room.status  # (mypy still thinks it's "lobby" from the assert above)
    assert status == "swiping"


# --- Searching farther ----------------------------------------------------


def test_search_farther_plan(mgr: RoomManager) -> None:
    room, (a, b) = started(mgr, 2)
    with pytest.raises(RoomError) as e:
        mgr.begin_expand(room, b, None)
    assert e.value.code == "NOT_HOST"

    plan = mgr.begin_expand(room, a, None)
    assert plan.radius_m == 5000  # 3000 + 2 km
    assert plan.exclude == {"a", "b", "c"}
    assert plan.seed != room.seed
    with pytest.raises(RoomError):
        mgr.begin_expand(room, a, None)  # one at a time

    added = mgr.finish_expand(room, plan.radius_m, [card("c"), card("d"), card("e")])
    assert [c.id for c in added] == ["d", "e"]  # never deals a card twice
    assert [c.id for c in room.deck] == ["a", "b", "c", "d", "e"]
    assert room.radius_m == 5000 and not room.expanding


def test_search_farther_gives_finished_players_more_cards(mgr: RoomManager) -> None:
    room, (a, b) = started(mgr, 2)
    for rid in ("a", "b", "c"):
        mgr.swipe(room, a, rid, False)
    plan = mgr.begin_expand(room, a, None)
    mgr.finish_expand(room, plan.radius_m, [card("d")])
    for rid in ("a", "b", "c"):
        result = mgr.swipe(room, b, rid, False)
    assert result is not None and result.outcome is None  # a still has "d" to swipe
    result = mgr.swipe(room, a, "d", False)
    assert result is not None and result.outcome is None  # b hasn't seen "d" yet
    result = mgr.swipe(room, b, "d", False)
    assert result is not None and isinstance(result.outcome, RoomExhaustedPayload)


def test_search_farther_caps_radius(mgr: RoomManager) -> None:
    room, (a, _) = started(mgr, 2)
    plan = mgr.begin_expand(room, a, 50_000)
    mgr.finish_expand(room, plan.radius_m, [])
    with pytest.raises(RoomError) as e:
        mgr.begin_expand(room, a, None)
    assert e.value.code == "BAD_STATE"


# --- Each player's own order ------------------------------------------------

BIG_DECK = [card(f"r{i:02d}") for i in range(60)]


def ids(cards: list[Card]) -> list[str]:
    return [c.id for c in cards]


def test_personal_order_same_cards_different_order() -> None:
    mine = personal_order(BIG_DECK, [0], 7, "me")
    yours = personal_order(BIG_DECK, [0], 7, "you")
    assert sorted(ids(mine)) == sorted(ids(yours)) == ids(BIG_DECK)
    assert ids(mine) != ids(yours)
    assert ids(personal_order(BIG_DECK, [0], 7, "me")) == ids(mine)  # stable on reconnect


def test_personal_order_keeps_good_cards_near_the_front() -> None:
    for member in ("a", "b", "c", "d"):
        order = ids(personal_order(BIG_DECK, [0], 7, member))
        for i, c in enumerate(BIG_DECK):
            assert abs(order.index(c.id) - i) <= SHUFFLE_WINDOW


def test_personal_order_keeps_batches_in_order() -> None:
    # 40 cards dealt at the start, 20 more from a "search farther"
    order = ids(personal_order(BIG_DECK, [0, 40], 7, "me"))
    assert sorted(order[:40]) == ids(BIG_DECK[:40])
    assert sorted(order[40:]) == ids(BIG_DECK[40:])
    # appending the batch didn't change the order of the cards before it
    assert order[:40] == ids(personal_order(BIG_DECK[:40], [0], 7, "me"))


def test_room_deals_each_member_their_own_order(mgr: RoomManager) -> None:
    room, (a, b) = started(mgr, 2, deck=list(BIG_DECK))
    assert ids(room.deck_for(a)) != ids(room.deck_for(b))
    plan = mgr.begin_expand(room, a, None)
    mgr.finish_expand(room, plan.radius_m, [card("x1"), card("x2"), card("x3")])
    for member in (a, b):
        assert sorted(ids(room.deck_for(member))[60:]) == ["x1", "x2", "x3"]
