"""Session tokens. Only their hashes are stored, never the raw values."""

import hashlib
import secrets


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def new_session_token() -> tuple[str, bytes]:
    """A random bearer token for the client, and the hash to store."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)
