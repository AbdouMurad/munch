"""Accounts end to end against a real Postgres.

Skipped unless MUNCH_TEST_DATABASE_URL points at a Postgres you can create databases on
(never the shared Tiger DB). Builds a throwaway `munch_test` database with the real 003 and
004 migrations on top of minimal stand-ins for the tables they reference.
"""

import asyncio
import os
import time
from collections.abc import Iterator
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import asyncpg
import pytest
from fastapi.testclient import TestClient

from munch.accounts import repo
from munch.accounts.google import GoogleIdentity
from munch.config import Settings
from munch.db.migrate import MIGRATIONS_DIR
from munch.main import create_app
from munch.rooms.fixture_deck import build_fixture_deck, load_fixtures
from munch.state import AppState

ADMIN_URL = os.environ.get("MUNCH_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="MUNCH_TEST_DATABASE_URL not set")

CENTER = {"lat": 49.2827, "lng": -123.1207}

# What 003/004 need from 001/002, without PostGIS/TimescaleDB.
STUBS = """
CREATE TABLE restaurants (id text PRIMARY KEY);
CREATE TABLE room_members (id uuid PRIMARY KEY);
"""


def db_url(admin_url: str, name: str) -> str:
    parts = urlsplit(admin_url)
    return urlunsplit(parts._replace(path=f"/{name}"))


async def build_test_db(admin_url: str) -> str:
    admin = await asyncpg.connect(admin_url)
    try:
        await admin.execute("DROP DATABASE IF EXISTS munch_test WITH (FORCE)")
        await admin.execute("CREATE DATABASE munch_test")
    finally:
        await admin.close()
    url = db_url(admin_url, "munch_test")
    conn = await asyncpg.connect(url)
    try:
        await conn.execute(STUBS)
        try:
            await conn.execute("CREATE EXTENSION citext")
        except asyncpg.PostgresError:  # not installed here; a plain text stand-in will do
            await conn.execute("CREATE DOMAIN citext AS text")
        for name in ("003_accounts.sql", "004_room_invites.sql", "005_user_avatars.sql"):
            sql = (MIGRATIONS_DIR / name).read_text()
            await conn.execute(sql.replace("CREATE EXTENSION IF NOT EXISTS citext;", ""))
        ids = [r["id"] for r in load_fixtures()]
        await conn.executemany("INSERT INTO restaurants (id) VALUES ($1)", [(i,) for i in ids])
    finally:
        await conn.close()
    return url


@pytest.fixture(scope="module")
def test_db_url() -> str:
    assert ADMIN_URL
    return asyncio.run(build_test_db(ADMIN_URL))


class FakeGoogle:
    configured = True

    async def verify(self, token: str) -> GoogleIdentity:
        sub, _, email = token.partition(":")  # tests send "sub:email"
        return GoogleIdentity(sub=sub, email=email or None, name="Googler", picture="https://p")


@pytest.fixture
def client(test_db_url: str, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    async def wipe() -> None:
        conn = await asyncpg.connect(test_db_url)
        await conn.execute("TRUNCATE users, email_login_codes, room_invites CASCADE")
        await conn.close()

    asyncio.run(wipe())
    monkeypatch.setattr(repo, "new_login_code", lambda: "123456")
    with TestClient(create_app(Settings(database_url=test_db_url))) as c:
        state: AppState = c.app.state.munch  # type: ignore[attr-defined]
        state.google = FakeGoogle()  # type: ignore[assignment]
        state.build_deck = build_fixture_deck
        yield c


def sign_in(c: TestClient, email: str, handle: str | None = None) -> dict[str, Any]:
    assert c.post("/api/auth/email/start", json={"email": email}).status_code == 204
    resp = c.post("/api/auth/email/verify", json={"email": email, "code": "123456"})
    assert resp.status_code == 200, resp.json()
    body: dict[str, Any] = resp.json()
    body["headers"] = {"Authorization": f"Bearer {body['sessionToken']}"}
    if handle:
        assert c.patch("/api/me", json={"handle": handle}, headers=body["headers"]).is_success
    return body


def befriend(c: TestClient, a: dict[str, Any], b: dict[str, Any]) -> None:
    c.post("/api/friends", json={"userId": b["user"]["id"]}, headers=a["headers"])
    c.post(f"/api/friends/{a['user']['id']}/accept", headers=b["headers"])


def wait_for(cond: Any, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while not cond():
        assert time.monotonic() < deadline, "timed out"
        time.sleep(0.02)


# --- sign-in ---------------------------------------------------------------


def test_email_sign_in_flow(client: TestClient) -> None:
    sam = sign_in(client, "Sam@Example.com")
    assert sam["isNew"] and sam["user"]["email"] == "sam@example.com"
    assert sam["user"]["displayName"] == "sam" and sam["user"]["handle"] is None
    again = sign_in(client, "sam@example.com")
    assert not again["isNew"] and again["user"]["id"] == sam["user"]["id"]

    me = client.get("/api/me", headers=sam["headers"])
    assert me.status_code == 200 and me.json()["id"] == sam["user"]["id"]


def test_wrong_code_and_attempt_limit(client: TestClient) -> None:
    client.post("/api/auth/email/start", json={"email": "x@y.co"})
    for _ in range(5):
        resp = client.post("/api/auth/email/verify", json={"email": "x@y.co", "code": "000000"})
        assert resp.status_code == 400 and resp.json()["error"]["code"] == "INVALID_CODE"
    # attempts used up: even the right code no longer works
    resp = client.post("/api/auth/email/verify", json={"email": "x@y.co", "code": "123456"})
    assert resp.status_code == 400


def test_code_rate_limit(client: TestClient) -> None:
    for _ in range(5):
        assert client.post("/api/auth/email/start", json={"email": "r@y.co"}).status_code == 204
    resp = client.post("/api/auth/email/start", json={"email": "r@y.co"})
    assert resp.status_code == 429 and resp.json()["error"]["code"] == "RATE_LIMITED"


def test_google_links_to_email_account(client: TestClient) -> None:
    by_email = sign_in(client, "sam@example.com")
    resp = client.post("/api/auth/google", json={"idToken": "g-1:sam@example.com"})
    assert resp.status_code == 200
    assert resp.json()["user"]["id"] == by_email["user"]["id"] and not resp.json()["isNew"]
    # a Google account without a verified email gets its own account
    resp = client.post("/api/auth/google", json={"idToken": "g-2:"})
    assert resp.json()["isNew"] and resp.json()["user"]["email"] is None


def test_google_picture_is_the_default(client: TestClient) -> None:
    # made with an email code: no picture yet
    by_email = sign_in(client, "sam@example.com")
    assert by_email["user"]["avatarUrl"] is None
    # first Google sign-in with the same address fills in the Google picture
    resp = client.post("/api/auth/google", json={"idToken": "g-1:sam@example.com"})
    assert resp.json()["user"]["avatarUrl"] == "https://p"
    # an uploaded picture is never replaced by Google's
    headers = {**by_email["headers"], "Content-Type": "image/jpeg"}
    mine = client.put("/api/me/avatar", content=JPEG, headers=headers).json()["avatarUrl"]
    resp = client.post("/api/auth/google", json={"idToken": "g-1:sam@example.com"})
    assert resp.json()["user"]["avatarUrl"] == mine


def test_logout(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    assert client.post("/api/auth/logout", headers=sam["headers"]).status_code == 204
    assert client.get("/api/me", headers=sam["headers"]).status_code == 401


# --- profile and preferences -----------------------------------------------


def test_profile_and_handle(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    resp = client.patch(
        "/api/me", json={"handle": "sam_eats", "displayName": "Sam"}, headers=sam["headers"]
    )
    assert resp.json()["handle"] == "sam_eats" and resp.json()["displayName"] == "Sam"
    alex = sign_in(client, "alex@example.com")
    resp = client.patch("/api/me", json={"handle": "@sam_eats"}, headers=alex["headers"])
    assert resp.status_code == 409 and resp.json()["error"]["code"] == "HANDLE_TAKEN"
    assert resp.json()["error"]["message"] == "@sam_eats is taken"
    bad = client.patch("/api/me", json={"handle": "sam eats!"}, headers=alex["headers"])
    assert bad.status_code == 422
    assert bad.json()["error"]["message"] == "Handles need 3-20 letters, numbers or _"


def test_preferences(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    assert client.get("/api/me/preferences", headers=sam["headers"]).json() == {
        "priceLevels": None,
        "excludeTypes": [],
        "favoriteTypes": [],
        "dietary": [],
        "maxRadiusM": None,
    }
    prefs = {
        "priceLevels": [2, 1],
        "excludeTypes": ["fast_food_restaurant"],
        "favoriteTypes": ["ramen_restaurant"],
        "dietary": ["vegetarian"],
        "maxRadiusM": 2000,
    }
    saved = client.put("/api/me/preferences", json=prefs, headers=sam["headers"]).json()
    assert saved["priceLevels"] == [1, 2] and saved["dietary"] == ["vegetarian"]
    assert client.get("/api/me/preferences", headers=sam["headers"]).json() == saved
    bad = client.put("/api/me/preferences", json={"dietary": ["paleo"]}, headers=sam["headers"])
    assert bad.status_code == 422


# --- friends ---------------------------------------------------------------


def test_friend_request_accept_remove(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com", handle="sam")
    alex = sign_in(client, "alex@example.com", handle="alex")

    resp = client.post("/api/friends", json={"handle": "ALEX"}, headers=sam["headers"])
    assert resp.json()["status"] == "outgoing" and "email" not in resp.json()["user"]
    incoming = client.get("/api/friends", headers=alex["headers"]).json()["incoming"]
    assert [f["user"]["handle"] for f in incoming] == ["sam"]

    accept = client.post(f"/api/friends/{sam['user']['id']}/accept", headers=alex["headers"])
    assert accept.status_code == 204
    friends = client.get("/api/friends", headers=sam["headers"]).json()
    assert [f["user"]["handle"] for f in friends["friends"]] == ["alex"]
    assert friends["incoming"] == [] and friends["outgoing"] == []

    client.delete(f"/api/friends/{alex['user']['id']}", headers=sam["headers"])
    assert client.get("/api/friends", headers=alex["headers"]).json()["friends"] == []


def test_mutual_requests_become_friends(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    alex = sign_in(client, "alex@example.com")
    client.post("/api/friends", json={"userId": alex["user"]["id"]}, headers=sam["headers"])
    resp = client.post("/api/friends", json={"userId": sam["user"]["id"]}, headers=alex["headers"])
    assert resp.json()["status"] == "friends"


def test_friend_errors(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    for body in ({"handle": "nobody"}, {"userId": "not-a-uuid"}):
        resp = client.post("/api/friends", json=body, headers=sam["headers"])
        assert resp.status_code == 404
    resp = client.post("/api/friends", json={"userId": sam["user"]["id"]}, headers=sam["headers"])
    assert resp.status_code == 409


# --- rooms, invites, swipes ------------------------------------------------


def test_room_members_carry_user_id(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    room = client.post(
        "/api/rooms", json={"displayName": "Sam", "center": CENTER}, headers=sam["headers"]
    ).json()
    client.post(f"/api/rooms/{room['code']}/join", json={"displayName": "Guest"})
    members = client.get(f"/api/rooms/{room['code']}").json()["members"]
    assert [(m["displayName"], m["userId"]) for m in members] == [
        ("Sam", sam["user"]["id"]),
        ("Guest", None),
    ]


def test_invite_live_and_accept(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    alex = sign_in(client, "alex@example.com")
    stranger = sign_in(client, "stranger@example.com")
    befriend(client, sam, alex)
    room = client.post(
        "/api/rooms", json={"displayName": "Sam", "center": CENTER}, headers=sam["headers"]
    ).json()

    with client.websocket_connect(f"/ws/me?token={alex['sessionToken']}") as alex_ws:
        resp = client.post(
            f"/api/rooms/{room['code']}/invites",
            json={"userIds": [alex["user"]["id"], stranger["user"]["id"]]},
            headers=sam["headers"],
        )
        assert resp.json() == {"invited": [alex["user"]["id"]]}  # strangers are skipped
        live = alex_ws.receive_json()
        assert live["type"] == "invite:received"
        assert live["payload"]["roomCode"] == room["code"]
        assert live["payload"]["fromUser"]["id"] == sam["user"]["id"]

    again = client.post(
        f"/api/rooms/{room['code']}/invites",
        json={"userIds": [alex["user"]["id"]]},
        headers=sam["headers"],
    )
    assert again.json() == {"invited": []}  # already has a pending invite

    invites = client.get("/api/me/invites", headers=alex["headers"]).json()["invites"]
    assert len(invites) == 1
    joined = client.post(f"/api/invites/{invites[0]['id']}/accept", headers=alex["headers"])
    assert joined.status_code == 200 and joined.json()["code"] == room["code"]
    members = client.get(f"/api/rooms/{room['code']}").json()["members"]
    assert alex["user"]["id"] in [m["userId"] for m in members]
    assert client.get("/api/me/invites", headers=alex["headers"]).json()["invites"] == []


def test_only_room_members_can_invite(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    alex = sign_in(client, "alex@example.com")
    befriend(client, sam, alex)
    room = client.post("/api/rooms", json={"displayName": "Host", "center": CENTER}).json()
    resp = client.post(
        f"/api/rooms/{room['code']}/invites",
        json={"userIds": [alex["user"]["id"]]},
        headers=sam["headers"],
    )
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "FORBIDDEN"


def test_start_expires_invites_and_records_swipes(client: TestClient, test_db_url: str) -> None:
    sam = sign_in(client, "sam@example.com")
    alex = sign_in(client, "alex@example.com")
    befriend(client, sam, alex)
    room = client.post(
        "/api/rooms", json={"displayName": "Sam", "center": CENTER}, headers=sam["headers"]
    ).json()
    client.post(
        f"/api/rooms/{room['code']}/invites",
        json={"userIds": [alex["user"]["id"]]},
        headers=sam["headers"],
    )

    url = f"/ws/{room['code']}?memberId={room['memberId']}&token={room['memberToken']}"
    with client.websocket_connect(url) as ws:
        ws.send_json({"type": "room:start"})
        while (msg := ws.receive_json())["type"] != "room:started":
            pass
        first = msg["payload"]["deck"][0]["id"]
        ws.send_json({"type": "swipe", "payload": {"restaurantId": first, "liked": True}})
        ws.receive_json()  # member:progress (or room:matched, since Sam is alone)

    def swipes() -> list[asyncpg.Record]:
        async def q() -> list[asyncpg.Record]:
            conn = await asyncpg.connect(test_db_url)
            rows = await conn.fetch("SELECT user_id::text, restaurant_id, liked FROM swipes")
            await conn.close()
            return rows

        return asyncio.run(q())

    wait_for(lambda: len(swipes()) == 1)
    assert tuple(swipes()[0]) == (sam["user"]["id"], first, True)
    wait_for(lambda: client.get("/api/me/invites", headers=alex["headers"]).json()["invites"] == [])


# --- profile pictures --------------------------------------------------------

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 200  # starts like a real JPEG


def test_avatar_upload_show_and_remove(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    headers = {**sam["headers"], "Content-Type": "image/jpeg"}

    me = client.put("/api/me/avatar", content=JPEG, headers=headers).json()
    url = me["avatarUrl"]
    assert url.startswith(f"/api/users/{sam['user']['id']}/avatar?v=")
    assert client.get("/api/me", headers=sam["headers"]).json()["avatarUrl"] == url

    pic = client.get(url)
    assert pic.status_code == 200 and pic.content == JPEG
    assert pic.headers["content-type"] == "image/jpeg"

    # a new upload gets a new URL, so phones don't keep showing the old picture
    again = client.put("/api/me/avatar", content=JPEG + b"x", headers=headers).json()
    assert again["avatarUrl"] != url

    # the lobby shows it next to the player
    room = client.post(
        "/api/rooms", json={"displayName": "Sam", "center": CENTER}, headers=sam["headers"]
    ).json()
    members = client.get(f"/api/rooms/{room['code']}").json()["members"]
    assert members[0]["avatarUrl"] == again["avatarUrl"]

    gone = client.delete("/api/me/avatar", headers=sam["headers"]).json()
    assert gone["avatarUrl"] is None
    assert client.get(url).status_code == 404


def test_avatar_rejects_non_images(client: TestClient) -> None:
    sam = sign_in(client, "sam@example.com")
    headers = {**sam["headers"], "Content-Type": "image/jpeg"}
    resp = client.put("/api/me/avatar", content=b"<html>not a picture", headers=headers)
    assert resp.status_code == 400 and resp.json()["error"]["code"] == "VALIDATION_ERROR"
    big = b"\xff\xd8\xff" + b"\x00" * 1_000_001
    assert client.put("/api/me/avatar", content=big, headers=headers).status_code == 400
    assert client.put("/api/me/avatar", content=JPEG).status_code == 401  # not signed in
