"""Session tokens and email login codes. Only hashes are stored, never the raw values."""

import hashlib
import hmac
import secrets


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def new_session_token() -> tuple[str, bytes]:
    """A random bearer token for the client, and the hash to store."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def new_login_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_login_code(email: str, code: str) -> bytes:
    # Bound to the email so a code hash can't be replayed for another address.
    return hashlib.sha256(f"{email.lower()}:{code}".encode()).digest()


def login_code_matches(email: str, code: str, stored_hash: bytes) -> bool:
    return hmac.compare_digest(hash_login_code(email, code), stored_hash)
