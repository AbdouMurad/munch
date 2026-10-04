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
    # Where the app is served from, for CORS. Comma-separated for more than one, e.g.
    # "http://localhost:8081,https://abc.trycloudflare.com" (local + a tunnel for friends).
    web_origin: str = "http://localhost:5173"
    ingest_max_requests: int = 200

    # Rooms (§6). Env values are seconds, e.g. DISCONNECT_GRACE=120
    disconnect_grace: timedelta = timedelta(minutes=2)
    terminal_room_ttl: timedelta = timedelta(minutes=30)
    idle_room_ttl: timedelta = timedelta(hours=2)

    # Accounts (§5.5)
    # OAuth client ids whose Google ID tokens we accept, comma-separated (iOS, Android, web).
    google_client_ids: str = ""
    session_ttl: timedelta = timedelta(days=30)
    # Password sign-in: this many wrong passwords for one email locks it for login_lockout.
    login_max_failures: int = 10
    login_lockout: timedelta = timedelta(minutes=15)
    invite_ttl: timedelta = timedelta(minutes=30)

    @property
    def web_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.web_origin.split(",") if o.strip()]

    @property
    def google_client_id_list(self) -> list[str]:
        return [c.strip() for c in self.google_client_ids.split(",") if c.strip()]

    # Ranking (§8), tune these during the hackathon
    rating_prior_mean: float = 4.2
    rating_prior_weight: int = 50
    popular_reviews: int = 2000  # review count where the popularity score maxes out
    weight_rating: float = 0.5
    weight_popularity: float = 0.2
    weight_distance: float = 0.3
    jitter: float = 0.05
    deck_size: int = 80
    min_candidates: int = 15


@lru_cache
def get_settings() -> Settings:
    return Settings()
