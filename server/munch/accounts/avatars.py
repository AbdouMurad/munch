"""Check uploaded profile pictures before storing them."""

from munch.accounts.errors import AccountError

MAX_AVATAR_BYTES = 1_000_000  # the app uploads ~256 px JPEGs, far below this


def image_type(data: bytes) -> str | None:
    """The real image type from the file's first bytes, whatever the client claimed."""
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def check_avatar(data: bytes) -> str:
    """Return the content type to store, or raise if this isn't a small JPEG/PNG/WebP."""
    if not data:
        raise AccountError("VALIDATION_ERROR", "No image was uploaded")
    if len(data) > MAX_AVATAR_BYTES:
        raise AccountError("VALIDATION_ERROR", "Image is too big (max 1 MB)")
    kind = image_type(data)
    if kind is None:
        raise AccountError("VALIDATION_ERROR", "Only JPEG, PNG or WebP images are allowed")
    return kind
