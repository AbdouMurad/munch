"""Photo proxy (DESIGN.md §5.2): `GET /api/photos/{restaurant_id}?w=800` redirects to the
restaurant's main photo on Google's CDN. Cards' `photoUrl` points here."""

import logging
from typing import Annotated, Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from munch.models import ErrorResponse
from munch.photos.service import DEFAULT_WIDTH, PhotoNotFound
from munch.state import StateDep

log = logging.getLogger("munch.photos")
router = APIRouter(prefix="/photos", tags=["photos"])

# Phones may reuse the redirect for a while too, but less than our cache keeps the URL.
BROWSER_CACHE = "public, max-age=1800"

RESPONSES: dict[int | str, dict[str, Any]] = {
    302: {"description": "Redirect to the image"},
    404: {"model": ErrorResponse},
    502: {"model": ErrorResponse},
}


@router.get("/{restaurant_id}", status_code=302, responses=RESPONSES)
async def photo(
    restaurant_id: str,
    state: StateDep,
    w: Annotated[int, Query(ge=100, le=1600)] = DEFAULT_WIDTH,
) -> RedirectResponse:
    if state.photos is None:
        raise HTTPException(404, "Photos need DATABASE_URL and GOOGLE_PLACES_API_KEY")
    try:
        url = await state.photos.photo_url(restaurant_id, w)
    except PhotoNotFound:
        raise HTTPException(404, "No photo for this restaurant") from None
    except httpx.HTTPStatusError as e:
        log.warning(
            "Google photo lookup failed for %s: HTTP %s %s",
            restaurant_id,
            e.response.status_code,
            e.response.text[:300],  # Google's reason, e.g. "API key not valid"
        )
        raise HTTPException(502, "Couldn't get the photo from Google") from None
    except httpx.HTTPError as e:
        log.warning("Google photo lookup failed for %s: %s", restaurant_id, e)
        raise HTTPException(502, "Couldn't get the photo from Google") from None
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": BROWSER_CACHE})
