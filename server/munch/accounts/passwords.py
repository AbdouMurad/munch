"""Password hashing with scrypt (Python standard library, memory-hard, salted).

Stored as "scrypt$<n>$<r>$<p>$<salt>$<key>" so the cost can be raised later without
breaking existing passwords. Hashing takes tens of milliseconds on purpose, so it runs in a
thread to keep the event loop free.
"""

import asyncio
import base64
import hashlib
import hmac
import secrets
from collections import deque
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from munch.accounts.errors import AccountError

N, R, P, KEY_BYTES, SALT_BYTES = 2**14, 8, 1, 32, 16
MIN_LENGTH, MAX_LENGTH = 8, 128


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password_sync(password: str) -> str:
    salt = secrets.token_bytes(SALT_BYTES)
    key = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=KEY_BYTES)
    return f"scrypt${N}${R}${P}${_b64(salt)}${_b64(key)}"


def verify_password_sync(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, key = stored.split("$")
        if scheme != "scrypt":
            return False
        expected = _unb64(key)
        actual = hashlib.scrypt(
            password.encode(), salt=_unb64(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except ValueError:
        return False
    return hmac.compare_digest(actual, expected)


# Checked against when the email has no password, so "no such account" takes as long as
# "wrong password" and response times don't reveal which emails are registered.
_DUMMY_HASH = hash_password_sync(secrets.token_urlsafe(16))


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(hash_password_sync, password)


async def verify_password(password: str, stored: str | None) -> bool:
    ok = await asyncio.to_thread(verify_password_sync, password, stored or _DUMMY_HASH)
    return ok and stored is not None


class LoginLimiter:
    """Slow down password guessing: too many wrong passwords for one email locks it for a
    while. In memory, which is enough for our single server process."""

    def __init__(
        self,
        max_failures: int,
        window: timedelta,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._max = max_failures
        self._window = window
        self._clock = clock
        self._failures: dict[str, deque[datetime]] = {}

    def _recent(self, email: str) -> deque[datetime]:
        times = self._failures.setdefault(email.lower(), deque())
        cutoff = self._clock() - self._window
        while times and times[0] < cutoff:
            times.popleft()
        return times

    def check(self, email: str) -> None:
        if len(self._recent(email)) >= self._max:
            minutes = int(self._window.total_seconds() // 60)
            raise AccountError(
                "RATE_LIMITED", f"Too many wrong passwords. Try again in {minutes} minutes."
            )

    def failed(self, email: str) -> None:
        self._recent(email).append(self._clock())

    def succeeded(self, email: str) -> None:
        self._failures.pop(email.lower(), None)
