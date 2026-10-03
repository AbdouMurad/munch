"""Settings from the environment and the repo-root `.env` (see `.env.example`)."""

from datetime import timedelta
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    # None = run without a DB: rooms still work in memory, persistence and /stats are off.
    database_url: str | None = None
    google_places_api_key: str | None = None
    web_origin: str = "http://localhost:5173"
    ingest_max_requests: int = 200

    # Rooms (§6). Env values are seconds, e.g. DISCONNECT_GRACE=120
    disconnect_grace: timedelta = timedelta(minutes=2)
    terminal_room_ttl: timedelta = timedelta(minutes=30)
    idle_room_ttl: timedelta = timedelta(hours=2)

    # Ranking (§8), tune these during the hackathon
    rating_prior_mean: float = 4.2
    rating_prior_weight: int = 50
    weight_rating: float = 0.55
    weight_distance: float = 0.35
    weight_munch: float = 0.10
    jitter: float = 0.12
    deck_size: int = 80
    min_candidates: int = 15


@lru_cache
def get_settings() -> Settings:
    return Settings()
