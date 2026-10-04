from munch.models import ErrorCode


class AccountError(Exception):
    """Raised by account code; rendered as {error: {code, message}} by the app."""

    def __init__(self, code: ErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message
