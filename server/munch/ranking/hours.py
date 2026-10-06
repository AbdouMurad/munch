"""Open-now check against Google's `regularOpeningHours` (stored as restaurants.opening_hours)."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from munch.models import LatLng

MINUTES_PER_WEEK = 7 * 24 * 60


@dataclass(frozen=True)
class Zone:
    """A box on the map (south-west and north-east corners) and the clock people read there."""

    tz: ZoneInfo
    min_lat: float
    min_lng: float
    max_lat: float
    max_lng: float

    def holds(self, point: LatLng) -> bool:
        return (
            self.min_lat <= point.lat <= self.max_lat and self.min_lng <= point.lng <= self.max_lng
        )


# "Open now" is a wall-clock question, so it has to be asked in the restaurant's own time, not
# the server's. One box per province we've crawled (BBOXES in munch/ingest/grid.py); they're
# province-shaped rather than city-shaped so a host outside the crawled cities still gets the
# right clock. -120 lng is the BC/Alberta border, which is where the zone changes (with the
# exception of BC's Peace River region, which keeps Mountain time all year; a room up there
# reads an hour early).
ZONES = (
    Zone(ZoneInfo("America/Vancouver"), 48.0, -139.1, 60.0, -120.0),  # British Columbia
    Zone(ZoneInfo("America/Edmonton"), 48.9, -120.0, 60.0, -110.0),  # Alberta
)
# Rooms outside every box above: we have no restaurants near them anyway, so the deck will be
# thin or empty and the clock barely matters. Pick the one our first city reads.
DEFAULT_TZ = ZoneInfo("America/Vancouver")


def tz_for(center: LatLng) -> ZoneInfo:
    """The timezone to read a room's opening hours in, from where the room is searching."""
    for zone in ZONES:
        if zone.holds(center):
            return zone.tz
    return DEFAULT_TZ


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
