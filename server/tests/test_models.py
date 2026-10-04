import pytest
from pydantic import ValidationError

from munch.models import (
    CreateRoomRequest,
    MemberProgressMessage,
    MemberProgressPayload,
    PingMessage,
    SwipeMessage,
    client_message_adapter,
)


def test_camel_case_in_and_out() -> None:
    req = CreateRoomRequest.model_validate(
        {"displayName": "  Sam ", "center": {"lat": 49.28, "lng": -123.12}, "radiusM": 2000}
    )
    assert req.display_name == "Sam"
    assert req.model_dump()["radiusM"] == 2000


def test_create_room_defaults_and_bounds() -> None:
    req = CreateRoomRequest.model_validate({"displayName": "Sam", "center": {"lat": 0, "lng": 0}})
    assert req.radius_m == 3000 and req.filters.price_levels is None
    with pytest.raises(ValidationError):
        CreateRoomRequest.model_validate(
            {"displayName": "Sam", "center": {"lat": 0, "lng": 0}, "filters": {"priceLevels": [5]}}
        )
    with pytest.raises(ValidationError):
        CreateRoomRequest.model_validate({"displayName": "   ", "center": {"lat": 0, "lng": 0}})


def test_client_message_dispatch() -> None:
    msg = client_message_adapter.validate_json(
        '{"type": "swipe", "payload": {"restaurantId": "abc", "liked": true}}'
    )
    assert isinstance(msg, SwipeMessage) and msg.payload.restaurant_id == "abc"
    assert isinstance(client_message_adapter.validate_json('{"type": "ping"}'), PingMessage)
    with pytest.raises(ValidationError):
        client_message_adapter.validate_json('{"type": "nope", "payload": {}}')


def test_server_message_envelope() -> None:
    msg = MemberProgressMessage(payload=MemberProgressPayload(member_id="m1", progress=3))
    assert msg.model_dump() == {
        "type": "member:progress",
        "payload": {"memberId": "m1", "progress": 3},
    }


def test_stamps_only_for_known_cities() -> None:
    from pydantic import ValidationError

    from munch.models import AddStampRequest

    assert AddStampRequest.model_validate({"city": "Edmonton"}).city == "Edmonton"
    for bad in ("Atlantis", "vancouver", ""):
        with pytest.raises(ValidationError):
            AddStampRequest.model_validate({"city": bad})
