from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from munch.config import Settings
from munch.main import create_app

CENTER = {"lat": 49.2827, "lng": -123.1207}


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings(database_url=None))) as c:
        yield c


def create(client: TestClient, name: str = "Host") -> dict[str, Any]:
    resp = client.post("/api/rooms", json={"displayName": name, "center": CENTER})
    assert resp.status_code == 201
    body: dict[str, Any] = resp.json()
    return body


def join(client: TestClient, code: str, name: str) -> dict[str, Any]:
    resp = client.post(f"/api/rooms/{code}/join", json={"displayName": name})
    assert resp.status_code == 200, resp.json()
    body: dict[str, Any] = resp.json()
    return body


def connect(client: TestClient, s: dict[str, Any]) -> WebSocketTestSession:
    return client.websocket_connect(
        f"/ws/{s['code']}?memberId={s['memberId']}&token={s['memberToken']}"
    )


def recv_until(ws: WebSocketTestSession, type_: str) -> dict[str, Any]:
    for _ in range(20):
        msg: dict[str, Any] = ws.receive_json()
        if msg["type"] == type_:
            return msg
    raise AssertionError(f"never got {type_}")


def test_rest_errors(client: TestClient) -> None:
    resp = client.get("/api/rooms/ZZZZZZ")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"
    resp = client.post("/api/rooms", json={"displayName": "", "center": CENTER})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_bad_token_closes_4401(client: TestClient) -> None:
    host = create(client)
    with pytest.raises(WebSocketDisconnect) as e:
        with connect(client, {**host, "memberToken": "nope"}) as ws:
            ws.receive_json()
    assert e.value.code == 4401


def test_full_game_to_match(client: TestClient) -> None:
    host = create(client, "Sam")
    with connect(client, host) as ws_a:
        assert recv_until(ws_a, "room:state")["payload"]["status"] == "lobby"

        guest = join(client, host["code"], "Alex")
        members = recv_until(ws_a, "room:state")["payload"]["members"]
        assert [m["displayName"] for m in members] == ["Sam", "Alex"]

        with connect(client, guest) as ws_b:
            recv_until(ws_b, "room:state")

            ws_b.send_json({"type": "room:start", "payload": {}})
            assert recv_until(ws_b, "error")["payload"]["code"] == "NOT_HOST"

            ws_a.send_json({"type": "room:start", "payload": {}})
            deck = recv_until(ws_a, "room:started")["payload"]["deck"]
            assert recv_until(ws_b, "room:started")["payload"]["deck"] == deck
            assert len(deck) > 0 and "distanceM" in deck[0]

            resp = client.post(f"/api/rooms/{host['code']}/join", json={"displayName": "Late"})
            assert resp.status_code == 409

            first = deck[0]["id"]
            ws_a.send_json({"type": "swipe", "payload": {"restaurantId": first, "liked": True}})
            progress = recv_until(ws_b, "member:progress")["payload"]
            assert progress == {"memberId": host["memberId"], "progress": 1}

            ws_b.send_json({"type": "swipe", "payload": {"restaurantId": first, "liked": True}})
            matched = recv_until(ws_a, "room:matched")["payload"]
            assert matched["card"]["id"] == first
            assert matched["likedBy"] == [host["memberId"], guest["memberId"]]
            assert recv_until(ws_b, "room:matched") == {"type": "room:matched", "payload": matched}

        # A phone that reconnects after the match lands on the match screen.
        with connect(client, guest) as ws_b2:
            assert recv_until(ws_b2, "room:state")["payload"]["status"] == "matched"
            assert recv_until(ws_b2, "room:started")["payload"]["resumeAt"] == 1
            assert recv_until(ws_b2, "room:matched")["payload"]["card"]["id"] == first


def test_leave_shrinks_quorum(client: TestClient) -> None:
    host = create(client)
    guest = join(client, host["code"], "Alex")
    with connect(client, host) as ws_a, connect(client, guest) as ws_b:
        ws_a.send_json({"type": "room:start"})
        deck = recv_until(ws_a, "room:started")["payload"]["deck"]
        ws_a.send_json({"type": "swipe", "payload": {"restaurantId": deck[2]["id"], "liked": True}})
        recv_until(ws_a, "member:progress")

        ws_b.send_json({"type": "room:leave"})
        assert recv_until(ws_a, "room:matched")["payload"]["card"]["id"] == deck[2]["id"]


def test_ping_and_bad_message(client: TestClient) -> None:
    host = create(client)
    with connect(client, host) as ws:
        ws.send_json({"type": "ping"})
        assert recv_until(ws, "pong") == {"type": "pong", "payload": {}}
        ws.send_json({"type": "dance"})
        assert recv_until(ws, "error")["payload"]["code"] == "VALIDATION_ERROR"
