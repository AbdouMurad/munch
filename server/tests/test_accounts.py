import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from jwt.algorithms import RSAAlgorithm
from pydantic import ValidationError

from munch.accounts.avatars import check_avatar, image_type
from munch.accounts.errors import AccountError
from munch.accounts.google import GoogleVerifier
from munch.accounts.passwords import LoginLimiter, hash_password, verify_password
from munch.accounts.tokens import hash_token, new_session_token
from munch.config import Settings
from munch.main import create_app
from munch.models import AddFriendRequest, RegisterRequest, UpdateProfileRequest

CLIENT_ID = "test-client.apps.googleusercontent.com"


# --- tokens ----------------------------------------------------------------


def test_session_token_hash() -> None:
    token, stored = new_session_token()
    assert len(token) >= 40 and stored == hash_token(token)
    assert new_session_token()[0] != token


async def test_password_hashing() -> None:
    stored = await hash_password("correct horse")
    assert stored.startswith("scrypt$") and "correct horse" not in stored
    assert stored != await hash_password("correct horse")  # salted: same password, new hash
    assert await verify_password("correct horse", stored)
    assert not await verify_password("Correct horse", stored)
    assert not await verify_password("correct horse", None)  # no password on the account
    assert not await verify_password("x", "not-a-hash")


def test_login_limiter() -> None:
    now = [datetime(2026, 1, 1, tzinfo=UTC)]
    limiter = LoginLimiter(3, timedelta(minutes=15), clock=lambda: now[0])
    for _ in range(3):
        limiter.check("Sam@x.co")
        limiter.failed("sam@x.co")
    with pytest.raises(AccountError) as e:
        limiter.check("SAM@x.co")
    assert e.value.code == "RATE_LIMITED"
    now[0] += timedelta(minutes=16)  # the lock wears off
    limiter.check("sam@x.co")
    limiter.failed("sam@x.co")
    limiter.succeeded("sam@x.co")  # a right password clears the count
    limiter.check("sam@x.co")


# --- Google ----------------------------------------------------------------


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def google_verifier(key: rsa.RSAPrivateKey) -> GoogleVerifier:
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update(kid="k1", alg="RS256", use="sig")

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"keys": [jwk]})

    return GoogleVerifier([CLIENT_ID], httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def id_token(key: rsa.RSAPrivateKey, **overrides: Any) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com",
        "aud": CLIENT_ID,
        "sub": "1234567890",
        "email": "Sam@Example.com",
        "email_verified": True,
        "name": "Sam",
        "iat": now,
        "exp": now + 600,
    } | overrides
    return jwt.encode(claims, key, algorithm="RS256", headers={"kid": "k1"})


async def test_google_valid_token(signing_key: rsa.RSAPrivateKey) -> None:
    who = await google_verifier(signing_key).verify(id_token(signing_key))
    assert who.sub == "1234567890" and who.email == "sam@example.com" and who.name == "Sam"


async def test_google_unverified_email_is_dropped(signing_key: rsa.RSAPrivateKey) -> None:
    who = await google_verifier(signing_key).verify(id_token(signing_key, email_verified=False))
    assert who.email is None


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-elses-app"},
        {"iss": "https://evil.example"},
        {"exp": int(time.time()) - 3600},
    ],
)
async def test_google_rejects_bad_claims(
    signing_key: rsa.RSAPrivateKey, overrides: dict[str, Any]
) -> None:
    with pytest.raises(AccountError) as e:
        await google_verifier(signing_key).verify(id_token(signing_key, **overrides))
    assert e.value.code == "UNAUTHORIZED"


async def test_google_rejects_other_signer(signing_key: rsa.RSAPrivateKey) -> None:
    forger = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(AccountError):
        await google_verifier(signing_key).verify(id_token(forger))


async def test_google_unconfigured() -> None:
    with pytest.raises(AccountError) as e:
        await GoogleVerifier([]).verify("x")
    assert e.value.code == "UNAVAILABLE"


# --- profile pictures -------------------------------------------------------


def test_image_type_sniffing() -> None:
    assert image_type(b"\xff\xd8\xff\xe0rest") == "image/jpeg"
    assert image_type(b"\x89PNG\r\n\x1a\nrest") == "image/png"
    assert image_type(b"RIFF\x00\x00\x00\x00WEBPrest") == "image/webp"
    assert image_type(b"GIF89a") is None
    with pytest.raises(AccountError):
        check_avatar(b"")
    with pytest.raises(AccountError):
        check_avatar(b"<svg onload=alert(1)>")


# --- contract --------------------------------------------------------------


def test_account_models_validate() -> None:
    ok = {"email": "  Sam@Example.COM ", "password": "long enough", "displayName": "Sam"}
    assert RegisterRequest.model_validate(ok | {"handle": "sam"}).email == "sam@example.com"
    with pytest.raises(ValidationError):
        RegisterRequest.model_validate(ok | {"handle": "sam", "email": "not-an-email"})
    with pytest.raises(ValidationError):
        RegisterRequest.model_validate(ok | {"handle": "sam", "password": "short"})
    with pytest.raises(ValidationError):
        UpdateProfileRequest(handle="no spaces!")
    with pytest.raises(ValidationError):
        UpdateProfileRequest(handle="ab")  # too short
    assert UpdateProfileRequest(handle=" @sam_eats ").handle == "sam_eats"
    with pytest.raises(ValidationError):
        AddFriendRequest()  # needs a handle or a userId
    with pytest.raises(ValidationError):
        AddFriendRequest(handle="sam", user_id="x")


# --- without a DB ----------------------------------------------------------


def test_accounts_need_the_db() -> None:
    with TestClient(create_app(Settings(database_url=None))) as c:
        resp = c.post("/api/auth/login", json={"email": "a@b.co", "password": "whatever"})
        assert resp.status_code == 503 and resp.json()["error"]["code"] == "UNAVAILABLE"
        assert c.get("/api/me").status_code == 401  # no token at all
        # guests still create rooms, even with a token the server can't check
        resp = c.post(
            "/api/rooms",
            json={"displayName": "Sam", "center": {"lat": 49.28, "lng": -123.12}},
            headers={"Authorization": "Bearer whatever"},
        )
        assert resp.status_code == 201
