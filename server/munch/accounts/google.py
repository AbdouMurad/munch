"""Verify Google ID tokens from the app, without trusting anything the client says.

Checks the RS256 signature against Google's published keys, the issuer, that the audience is
one of our OAuth client ids, the expiry, and that Google has verified the email.
"""

import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

from munch.accounts.errors import AccountError

GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
KEYS_TTL_S = 3600


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str  # stable Google account id
    email: str | None  # lowercased; None unless Google verified it
    name: str | None
    picture: str | None


class GoogleVerifier:
    def __init__(self, client_ids: list[str], http: httpx.AsyncClient | None = None) -> None:
        self._client_ids = client_ids
        self._http = http
        self._keys: dict[str, Any] = {}  # kid → JWK
        self._keys_fetched_at = 0.0

    @property
    def configured(self) -> bool:
        return bool(self._client_ids)

    async def verify(self, id_token: str) -> GoogleIdentity:
        if not self._client_ids:
            raise AccountError("UNAVAILABLE", "Google sign-in isn't configured on this server")
        try:
            kid = jwt.get_unverified_header(id_token).get("kid")
        except jwt.PyJWTError as e:
            raise AccountError("UNAUTHORIZED", "Malformed Google token") from e
        jwk = await self._key(kid)
        try:
            claims: dict[str, Any] = jwt.decode(
                id_token,
                key=jwt.PyJWK(jwk).key,
                algorithms=["RS256"],
                audience=self._client_ids,
                issuer=GOOGLE_ISSUERS,
                options={"require": ["exp", "iat", "sub", "aud", "iss"]},
                leeway=30,
            )
        except jwt.PyJWTError as e:
            raise AccountError("UNAUTHORIZED", f"Invalid Google token: {e}") from e
        return identity_from_claims(claims)

    async def _key(self, kid: str | None) -> Any:
        stale = time.monotonic() - self._keys_fetched_at > KEYS_TTL_S
        if stale or kid not in self._keys:  # Google rotates keys; refetch on an unknown kid
            await self._fetch_keys()
        if kid not in self._keys:
            raise AccountError("UNAUTHORIZED", "Google token signed with an unknown key")
        return self._keys[kid]

    async def _fetch_keys(self) -> None:
        http = self._http or httpx.AsyncClient(timeout=10)
        try:
            resp = await http.get(GOOGLE_CERTS_URL)
            resp.raise_for_status()
        finally:
            if self._http is None:
                await http.aclose()
        self._keys = {k["kid"]: k for k in resp.json()["keys"]}
        self._keys_fetched_at = time.monotonic()


def identity_from_claims(claims: dict[str, Any]) -> GoogleIdentity:
    verified = claims.get("email_verified") in (True, "true")
    email = claims.get("email")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=email.lower() if verified and isinstance(email, str) else None,
        name=claims.get("name"),
        picture=claims.get("picture"),
    )
