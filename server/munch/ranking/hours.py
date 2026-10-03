"""Open-now check against Google's `regularOpeningHours` (stored as restaurants.opening_hours)."""

from datetime import datetime
from typing import Any

MINUTES_PER_WEEK = 7 * 24 * 60


def _minute_of_week(point: dict[str, Any]) -> int:
    # Google days: 0 = Sunday
    return int(point["day"]) * 1440 + int(point.get("hour", 0)) * 60 + int(point.get("minute", 0))


def is_open(hours: dict[str, Any] | None, now: datetime) -> bool | None:
    """True/False for a local `now`, or None when there are no hours on file."""
    periods = (hours or {}).get("periods")
    if not periods:
        return None
    t = ((now.weekday() + 1) % 7) * 1440 + now.hour * 60 + now.minute  # weekday(): 0 = Monday
    for period in periods:
        if "close" not in period:  # Google's encoding for open 24/7
            return True
        start = _minute_of_week(period["open"])
        end = _minute_of_week(period["close"])
        if end <= start:  # wraps past Saturday night into Sunday
            end += MINUTES_PER_WEEK
        if start <= t < end or start <= t + MINUTES_PER_WEEK < end:
            return True
    return False
