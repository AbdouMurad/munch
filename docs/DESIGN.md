 # Munch: Design Doc

> Tinder for food. Make a room, share the code, everyone swipes on nearby restaurants, and the first one everybody likes wins.

**Status:** v2 (hackathon). This file is the source of truth for the architecture and the contracts between the pieces. If you (or your agent) need to change a contract, meaning the API shapes, WebSocket messages, or DB schema, update this doc and the Pydantic models in the same PR, then tell the team.

---

## 0. Tracks we're targeting

| Track | What we do for it | Where |
|---|---|---|
| **Main (general)** | A complete, demo-able product: create room → join → swipe → match | everything |
| **Best use of Python** | The *entire* backend is Python: async FastAPI, WebSockets, Pydantic v2 contracts, asyncpg, an adaptive geospatial crawler, and a ranking engine (seeded RNG, Bayesian smoothing). Typed end to end (`mypy --strict`), `uv` managed, `pytest` tested | `server/` |
| **Best use of Tiger Data** | Tiger Cloud Postgres with PostGIS for the per-room candidate query, a TimescaleDB **hypertable** for every swipe, a **continuous aggregate** that feeds crowd popularity back into ranking, and a live stats page | §4, §8, §9 |
| **Best design** | Mobile-first swipe UI, motion design, and a **AirDrop-first room join** (§3.1) | `web/` |

Keep these in mind when making tradeoffs. For example, don't reach for a Node library or skip the Tiger features to save time.

---

## 1. Goals and non-goals

**Goals (MVP)**
- Host creates a room and gets a 6-character code and a join link. Friends join by AirDropping/scanning/tapping the link or typing the code.
- Host presses Start, and everyone gets the same ranked deck of nearby restaurants.
- Everyone swipes. When **every member** has liked the same restaurant, everyone sees a match screen.
- Restaurant data comes from our own Postgres (Tiger Data), pre-populated by a grid crawler over Vancouver using the Google Places API.
- Ranking mixes rating and distance with some seeded randomness.

**Non-goals (for now)**
- User accounts and login. Members are anonymous, identified by a random token.
- Cities other than Vancouver.
- Running more than one server process. Live room state lives in memory in one process (`--workers 1`).
- Live Google calls during a session. Only the ingest script talks to Google (photos are the one exception, see §7.4).

---

## 2. Architecture

```
┌──────────────┐   REST (create/join)    ┌──────────────────────────┐        ┌───────────────────────┐
│  web/        │ ──────────────────────▶ │  server/ (Python)        │  SQL   │  Tiger Data (Postgres) │
│  React SPA   │                         │  FastAPI + WebSockets    │ ─────▶ │  + PostGIS            │
│  (phones)    │ ◀═══ WebSocket ═══════▶ │  in-memory room state    │        │  + TimescaleDB        │
└──────────────┘   (lobby, swipes,       │  ranking                 │        └───────────▲───────────┘
                    match)               └──────────────────────────┘                    │ upsert
                                                                                         │
                                         ┌──────────────────────────┐   Places API (New) │
                                         │  server/munch/ingest     │ ───────────────────┘
                                         │  grid crawler (CLI)      │ ◀── Google
                                         └──────────────────────────┘
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React + TypeScript, Tailwind, framer-motion (swipe gestures), react-router | Quick to build, mobile-first |
| Backend | **Python 3.12**, FastAPI, native WebSockets, Pydantic v2, `asyncpg`, `httpx`, `uvicorn`, managed with `uv` | Fully async, typed, and auto-generates an OpenAPI schema |
| DB | Tiger Data (managed Postgres with TimescaleDB), PostGIS extension | Geo queries plus time-series swipe analytics |
| Data source | Google Places API (New): `places:searchNearby` | |
| Tests / lint | `pytest` + `pytest-asyncio`, `ruff`, `mypy --strict` | |

### Repo layout

```
munch/
├── server/                         # the whole backend, Python
│   ├── pyproject.toml              # uv project
│   ├── munch/
│   │   ├── main.py                 # FastAPI app factory, lifespan (db pool), CORS
│   │   ├── config.py               # pydantic-settings, reads .env
│   │   ├── models.py               # THE CONTRACT: Pydantic models for REST + WS (§5)
│   │   ├── routes/                 # REST handlers (rooms, photos, stats, health)
│   │   ├── realtime/               # WebSocket endpoint + message dispatch
│   │   ├── rooms/                  # RoomManager (in-memory state, match logic)
│   │   ├── ranking/                # candidate query + scoring + deck building
│   │   ├── db/                     # asyncpg pool + queries
│   │   └── ingest/                 # grid crawler, run with `python -m munch.ingest`
│   └── tests/
├── web/                            # React SPA (separate teammate)
│   └── src/
│       ├── pages/                  # Home, Join, Lobby, Swipe, Match, NoMatch, Stats
│       ├── components/             # SwipeCard, CardStack, MemberList, ShareSheet, ...
│       ├── lib/ws.ts               # typed WebSocket client with auto-reconnect
│       ├── lib/api.ts              # REST client
│       └── lib/generated/          # types generated from the server schema (§5.4), do not hand-edit
├── db/
│   ├── migrations/                 # 001_init.sql, 002_..., applied in order
│   └── seed/fixtures.sql           # about 50 fake restaurants so nobody waits on ingest
├── contracts/                      # generated: openapi.json, ws-messages.schema.json
├── docs/DESIGN.md
└── .env.example
```

---

## 3. User flow

1. **Home.** The user can either:
   - **Create room**: enter a display name. The browser asks for geolocation, falling back to downtown Vancouver `49.2827, -123.1207`. Optional settings are radius (default 3 km) and price levels.
   - **Join room**: enter the code and a display name (or arrive via a join link, which pre-fills the code).
2. **Lobby.** The room code is shown big, with a **Share** button (§3.1) and a QR code. The member list updates live. Only the host sees a **Start** button.
3. **Swipe.** A card stack. Drag right or press ❤️ to like, drag left or press ✕ to pass. Arrow keys work on desktop. A small header shows each member's progress ("Sam: 12/80").
4. **Match.** As soon as everyone has liked the same restaurant, every client switches to the Match screen: photo, name, rating, distance, and an "Open in Google Maps" button.
5. **No match.** If everyone finishes the deck without a unanimous like, show the **top 3 by like count**. The host can **Run it back**, which deals a new deck from a larger radius (stretch goal).

**Rules**
- You can only join while the room is in `lobby`. Joining after Start returns 409.
- A match requires a like from every member who hasn't left. If someone leaves mid-swipe, the quorum shrinks, so re-check for a match at that point.
- Everyone gets the **same deck in the same order**. That gets the group to a match faster, and it's a deliberate choice.
- If the host leaves, the oldest remaining member becomes host.

### 3.1 Joining with AirDrop

**Reality check.** A web page cannot send or receive over AirDrop directly. There is no web API for it, and a pure web app can't make phones discover each other. What we *can* do is use the OS share sheet, which includes AirDrop.

**How it works**
- The lobby's **Share** button calls `navigator.share({ title: 'Join my Munch', text: 'Code ABC234', url: 'https://<host>/join/ABC234' })`.
- On iPhone Safari this opens the native share sheet with **AirDrop** at the top, showing nearby friends. The host taps a friend, and the friend gets the link.
- The friend taps the AirDropped link, which opens `/join/ABC234` in Safari with the code pre-filled. They enter a name and are in the lobby.
- This also works with Messages, WhatsApp, Android Nearby Share, and so on, for free.

**Design requirements (this is the "best design" angle)**
- Make the share moment feel like the product: a big animated room code, a primary **"AirDrop to friends"** button on iOS (label it "Share" elsewhere), and a QR code under it for people who aren't nearby on Apple devices.
- `navigator.share` needs **HTTPS** and a **user gesture**. In dev, expose the app over HTTPS (`vite --host` with `@vitejs/plugin-basic-ssl`, or a tunnel such as `cloudflared`/`ngrok`), otherwise the button won't show up on a phone.
- Fall back to clipboard copy when `navigator.share` is missing (desktop browsers).
- Optional (stretch) polish: serve a tiny `apple-touch-icon` and OpenGraph tags on `/join/:code` so the AirDropped link previews nicely.
- Not an option for the hackathon: a native iOS app or App Clip using MultipeerConnectivity for true proximity discovery. It's out of scope. If a judge asks, that's the "v2" answer.

---

## 4. Data model (Tiger Data / Postgres)

`db/migrations/001_init.sql`:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS timescaledb;  -- already enabled on Tiger Cloud

-- Restaurants (filled by ingest)
CREATE TABLE restaurants (
  id              text PRIMARY KEY,                 -- Google place id
  name            text NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  address         text,
  rating          real,                             -- 1.0–5.0, nullable
  rating_count    integer NOT NULL DEFAULT 0,
  price_level     smallint,                         -- 0–4, nullable
  primary_type    text,                             -- e.g. 'ramen_restaurant'
  types           text[] NOT NULL DEFAULT '{}',
  photo_name      text,                             -- 'places/{id}/photos/{ref}' for the photo proxy
  maps_uri        text,
  business_status text,                             -- OPERATIONAL | CLOSED_TEMPORARILY | ...
  opening_hours   jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurants_location_gix ON restaurants USING gist (location);

-- Crawl bookkeeping, so ingest can resume and we can audit it
CREATE TABLE ingest_cells (
  id            bigserial PRIMARY KEY,
  parent_id     bigint REFERENCES ingest_cells(id),
  depth         smallint NOT NULL,
  min_lat       double precision NOT NULL,
  min_lng       double precision NOT NULL,
  max_lat       double precision NOT NULL,
  max_lng       double precision NOT NULL,
  radius_m      integer NOT NULL,
  status        text NOT NULL DEFAULT 'pending',  -- pending | done | split | dense | failed
  result_count  integer,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX ingest_cells_status_idx ON ingest_cells (status);

-- Rooms (written for durability/analytics; live state is in memory, see §6)
CREATE TABLE rooms (
  id                     uuid PRIMARY KEY,
  code                   char(6) NOT NULL UNIQUE,
  status                 text NOT NULL,           -- lobby | swiping | matched | exhausted | closed
  center_lat             double precision NOT NULL,
  center_lng             double precision NOT NULL,
  radius_m               integer NOT NULL,
  filters                jsonb NOT NULL DEFAULT '{}',
  seed                   bigint NOT NULL,
  matched_restaurant_id  text REFERENCES restaurants(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  ended_at               timestamptz
);

CREATE TABLE room_members (
  id            uuid PRIMARY KEY,
  room_id       uuid NOT NULL REFERENCES rooms(id),
  display_name  text NOT NULL,
  is_host       boolean NOT NULL DEFAULT false,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz
);

-- Swipes: a Timescale hypertable (time-series event log)
CREATE TABLE swipes (
  swiped_at      timestamptz NOT NULL DEFAULT now(),
  room_id        uuid NOT NULL,
  member_id      uuid NOT NULL,
  restaurant_id  text NOT NULL,
  liked          boolean NOT NULL
);
SELECT create_hypertable('swipes', by_range('swiped_at'));
CREATE INDEX swipes_room_idx ON swipes (room_id, swiped_at DESC);
-- Deduplication (one swipe per member per card) is enforced by the server, not a
-- unique constraint, because unique indexes on hypertables must include swiped_at.

-- Continuous aggregate: "munch popularity" across all rooms
CREATE MATERIALIZED VIEW restaurant_swipe_stats_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', swiped_at) AS bucket,
       restaurant_id,
       count(*) FILTER (WHERE liked) AS likes,
       count(*)                       AS swipes
FROM swipes
GROUP BY bucket, restaurant_id;

SELECT add_continuous_aggregate_policy('restaurant_swipe_stats_daily',
  start_offset => INTERVAL '30 days', end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes');
```

**Tiger track pitch.** PostGIS `ST_DWithin` produces the candidate set for each room. Every swipe is a time-series event in a hypertable. A continuous aggregate turns all those swipes into a crowd-sourced "munch score" that feeds back into ranking (§8). The stats page (§9) shows swipes per minute and the most-liked spots, queried live from the hypertable with `time_bucket`. Consider also enabling compression on old swipe chunks and mention it in the pitch.

Use `asyncpg` with raw SQL (no ORM) so the Tiger/PostGIS features are visible in the code. Register a codec or pass geography as `ST_MakePoint(lng, lat)::geography`.

---

## 5. Contracts (`server/munch/models.py`)

**Pydantic models are the single source of truth.** The server validates every REST body and WebSocket message with them, and the frontend's TypeScript types are generated from them (§5.4), so nobody hand-writes the same type twice.

### 5.1 Models

```python
RoomStatus = Literal["lobby", "swiping", "matched", "exhausted", "closed"]

class Filters(BaseModel):
    price_levels: list[int] | None = None   # subset of 0–4; None/empty = any
    exclude_types: list[str] = []           # e.g. ["fast_food_restaurant"]

class Member(BaseModel):
    id: str
    display_name: str
    is_host: bool
    progress: int                           # number of cards swiped

class Card(BaseModel):
    id: str                                 # google place id
    name: str
    lat: float
    lng: float
    distance_m: float                       # from room center
    rating: float | None
    rating_count: int
    price_level: int | None
    primary_type: str | None                # display: 'ramen_restaurant' → 'Ramen'
    address: str | None
    photo_url: str | None                   # '/api/photos/{id}' (server proxy) or None
    maps_uri: str | None

class RoomState(BaseModel):
    room_id: str
    code: str
    status: RoomStatus
    members: list[Member]
    center: LatLng
    radius_m: int
    filters: Filters
    deck_size: int                          # 0 until started
```

The JSON on the wire uses **camelCase** (`displayName`, `distanceM`, ...). Set `model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)` on a shared `CamelModel` base, and have FastAPI serialize `by_alias=True`. Python code stays snake_case, and the frontend stays idiomatic.

### 5.2 REST API (prefix `/api`)

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/rooms` | `{ displayName, center: {lat,lng}, radiusM?: 3000, filters? }` | `201 { roomId, code, memberId, memberToken }` |
| `POST` | `/rooms/{code}/join` | `{ displayName }` | `200 { roomId, code, memberId, memberToken }` · `404` no room · `409` already started |
| `GET` | `/rooms/{code}` | – | `200 RoomState` (used on page reload and by the join page) |
| `GET` | `/photos/{restaurant_id}` | `?w=800` | Image bytes (proxied from Google, cached) · `404` |
| `GET` | `/stats` | – | `200 { swipesPerMinute: [{t, count}], topRestaurants: [{id, name, likes, swipes}] }` (Tiger-powered) |
| `GET` | `/health` | – | `200 { ok: true }` |

Errors always use the shape `{ "error": { "code": str, "message": str } }`. Add an exception handler to enforce that.

**Room codes** are 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, which leaves out 0/O and 1/I. Generate a new one if it collides with a live room.

**Member tokens** come from `secrets.token_urlsafe(32)`. The client stores `{ roomCode, memberId, memberToken }` in `localStorage` so a page refresh reconnects instead of losing the session.

### 5.3 WebSocket protocol

Endpoint: `GET /ws/{code}?memberId=...&token=...` (upgrade to WebSocket). The server validates the token and closes with code `4401` if it's bad. It uses plain WebSockets, not Socket.IO, so the browser needs no extra library and the Python side stays simple.

Every message in both directions is a JSON envelope: `{ "type": "<name>", "payload": { ... } }`. Model them as Pydantic **discriminated unions** on `type` (`ClientMessage`, `ServerMessage`) so dispatch is one `match` statement.

**Client → Server**

| `type` | Payload | Notes |
|---|---|---|
| `room:start` | `{}` | Host only, and only in `lobby` |
| `swipe` | `{ restaurantId, liked }` | Idempotent: the server ignores repeats |
| `room:leave` | `{}` | Marks the member as left and shrinks the quorum |
| `room:rerun` | `{ radiusM? }` | Host only, in `exhausted` (stretch) |
| `ping` | `{}` | Keepalive every 20 s; the server replies `pong` |

**Server → Client**

| `type` | Payload | When |
|---|---|---|
| `room:state` | `RoomState` | On connect, and whenever members or status change |
| `room:started` | `{ deck: Card[], resumeAt: int }` | Host started (or a client reconnected). The full deck is sent once, up to 80 cards. `resumeAt` is the member's own progress |
| `member:progress` | `{ memberId, progress }` | After each swipe |
| `room:matched` | `{ card: Card, likedBy: string[] }` | Unanimous like |
| `room:exhausted` | `{ topPicks: [{ card: Card, likes: int }] }` | Everyone finished the deck with no match |
| `error` | `{ code, message }` | e.g. `NOT_HOST`, `BAD_STATE`, `UNAUTHORIZED` |
| `pong` | `{}` | Reply to `ping` |

The client (`lib/ws.ts`) reconnects with exponential backoff. On reconnect the server sends `room:state` followed by `room:started` (with `resumeAt`) if the room is already swiping, so a locked phone picks up where it left off.

### 5.4 Generating frontend types

```bash
# from repo root
python -m munch.export_contracts            # writes contracts/openapi.json and contracts/ws-messages.schema.json
npx openapi-typescript contracts/openapi.json -o web/src/lib/generated/api.ts
npx json-schema-to-typescript contracts/ws-messages.schema.json -o web/src/lib/generated/ws.ts
```

Add `make contracts` to run all three. Commit the generated files so the frontend never needs Python installed. Whoever changes `models.py` re-runs it in the same PR.

---

## 6. Server: rooms and match logic

The source of truth for live rooms is an in-memory `RoomManager`, because there is only one server process. All room mutations run on the asyncio event loop, so no locks are needed as long as handlers don't `await` between the check and the update. Every mutation is also written to Postgres in the background (`asyncio.create_task`, with errors logged) so analytics and the Tiger features have data.

```python
@dataclass
class LiveMember:
    id: str; display_name: str; token: str; is_host: bool
    progress: int = 0
    left_at: datetime | None = None
    sockets: set[WebSocket] = field(default_factory=set)

@dataclass
class LiveRoom:
    id: str; code: str; status: RoomStatus
    center: LatLng; radius_m: int; filters: Filters; seed: int
    members: dict[str, LiveMember]
    deck: list[Card] = field(default_factory=list)
    likes: dict[str, set[str]] = field(default_factory=dict)    # restaurant_id → member ids
    swiped: dict[str, set[str]] = field(default_factory=dict)   # member_id → restaurant ids
```

**On `swipe`:**
1. Validate that the room is `swiping`, the card is in the deck, and this member hasn't already swiped it. If any check fails, ignore the event.
2. Record the swipe in `swiped`. If `liked`, add the member to `likes[restaurant_id]`.
3. Insert into the `swipes` hypertable (background task) and broadcast `member:progress`.
4. **Match check:** if `likes[restaurant_id] ⊇ active_members`, set status to `matched`, broadcast `room:matched`, and update `rooms`.
5. **Exhaustion check:** if every active member has swiped the whole deck, set status to `exhausted` and broadcast `room:exhausted` with the top 3 restaurants by like count (ties broken by deck position).

**On leave or disconnect:** an explicit `room:leave` removes the member from the quorum immediately. A socket disconnect does **not** count as leaving. It takes 2 minutes with no socket before the member is treated as left (so phones that lock their screen don't break the room). Whenever the quorum shrinks, re-run the match check over every liked restaurant.

**Cleanup:** a background task started in the FastAPI lifespan removes a room from memory 30 minutes after it reaches a terminal status, or after 2 hours with no activity.

---

## 7. Ingest: Vancouver grid crawler

Run it as a CLI: `uv run python -m munch.ingest [--dry-run] [--max-requests 200] [--bbox city|metro]`.

Write it as an `asyncio` + `httpx.AsyncClient` program with a small concurrency limit (a semaphore of about 5). That fits the "best use of Python" angle and makes the crawl fast. Use `tenacity` or a hand-rolled backoff for retries.

### 7.1 The constraint we're working around
Places API (New) `searchNearby` returns **at most 20 results** and has **no pagination**. If a query comes back with exactly 20, there are probably more places in that circle that we missed. So we do an adaptive quadtree: start with a coarse grid, and split any saturated cell into 4 smaller cells.

### 7.2 Algorithm

```
BBOXES = {
  city:  (min_lat 49.198, min_lng -123.225, max_lat 49.317, max_lng -123.023),  # City of Vancouver
  metro: (min_lat 49.100, min_lng -123.270, max_lat 49.380, max_lng -122.850),  # + Burnaby, Richmond, North Van
}
INITIAL_CELL_M = 1500      # ~10×10 grid over the city
MIN_RADIUS_M   = 75        # stop splitting below this
SATURATION     = 20        # == maxResultCount

seed: tile bbox into INITIAL_CELL_M squares → insert as ingest_cells(status='pending', depth=0)
      (skip seeding if pending/done cells already exist → resumable)

loop while a pending cell exists and requests < MAX_REQUESTS:
  cell   = next pending (lowest depth first)
  center = cell midpoint
  radius = half-diagonal of the cell (so the circle covers the whole square)
  places = search_nearby(center, radius)
  upsert places into restaurants (ON CONFLICT (id) DO UPDATE)
  if len(places) >= SATURATION and radius/2 >= MIN_RADIUS_M:
      mark cell 'split'; insert 4 child quadrants as 'pending', depth+1
  elif len(places) >= SATURATION:
      mark cell 'dense'   # log it; acceptable loss
  else:
      mark cell 'done'
  retry 429/5xx with backoff, mark 'failed' after 3 tries
```

Use these rough conversions at Vancouver's latitude: 1° lat ≈ 111,200 m and 1° lng ≈ 72,600 m. (Or use `math.cos(math.radians(lat))` to compute it.) Keep the cell geometry in pure functions (`tile_bbox`, `split_cell`, `cell_radius_m`) so it's easy to unit test without hitting Google.

Circles that cover a square overlap their neighbours, so the same place will come back more than once. The upsert takes care of that.

### 7.3 Request

```http
POST https://places.googleapis.com/v1/places:searchNearby
X-Goog-Api-Key: $GOOGLE_PLACES_API_KEY
X-Goog-FieldMask: places.id,places.displayName,places.location,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.primaryType,places.types,places.photos,places.googleMapsUri,places.businessStatus,places.regularOpeningHours

{
  "includedTypes": ["restaurant"],
  "maxResultCount": 20,
  "rankPreference": "DISTANCE",
  "locationRestriction": { "circle": { "center": { "latitude": 49.28, "longitude": -123.12 }, "radius": 1060.0 } }
}
```

- `rankPreference: DISTANCE` keeps the 20 *closest* results, so the subdivided children fill in what got cut off.
- `priceLevel` comes back as an enum (`PRICE_LEVEL_MODERATE`, ...). Map it to 0–4.
- Store only `photos[0].name` in `photo_name`.

### 7.4 Cost and ToS guardrails ⚠️
- Fields like `rating`, `userRatingCount`, `priceLevel`, and `regularOpeningHours` push each request into a **more expensive SKU**. Check current Places pricing before running a full crawl.
- **Always run `--dry-run` first.** It prints the initial cell count and an estimate without calling Google. `--max-requests` is a hard cap that defaults to 200.
- Ingest **once** into the shared Tiger DB. Teammates develop against that DB, or against `db/seed/fixtures.sql`. Don't re-crawl from your own machine.
- Photos: `GET /api/photos/{id}` calls `https://places.googleapis.com/v1/{photo_name}/media?maxWidthPx=800&key=...` from the server, so the API key never reaches the client. Cache the bytes (an in-memory LRU, or on disk).
- Google's terms restrict long-term caching of Places content. Place IDs are exempt. That's fine for a hackathon demo, but call it out if anyone asks.

---

## 8. Ranking

Ranking runs once per room when the host presses Start (`server/munch/ranking`). Keep scoring as pure functions so it's trivially testable.

### 8.1 Candidates (SQL)

```sql
SELECT r.*,
       ST_Distance(r.location, ST_MakePoint($2, $1)::geography) AS distance_m,
       COALESCE(s.likes, 0)  AS munch_likes,
       COALESCE(s.swipes, 0) AS munch_swipes
FROM restaurants r
LEFT JOIN (
  SELECT restaurant_id, sum(likes) AS likes, sum(swipes) AS swipes
  FROM restaurant_swipe_stats_daily
  WHERE bucket > now() - INTERVAL '30 days'
  GROUP BY restaurant_id
) s ON s.restaurant_id = r.id
WHERE ST_DWithin(r.location, ST_MakePoint($2, $1)::geography, $3)
  AND r.business_status = 'OPERATIONAL'
  AND ($4::smallint[] IS NULL OR r.price_level = ANY($4))
  AND NOT (r.types && $5::text[])
LIMIT 500;
```

(`$1` = lat, `$2` = lng, `$3` = radius in metres. PostGIS takes longitude first.)

### 8.2 Score

```python
# 1. Bayesian-smoothed rating: a 5.0 with 3 reviews shouldn't beat a 4.6 with 2,000.
C, m = 4.2, 50            # prior mean (≈ Vancouver avg), prior weight (reviews)
R = rating if rating is not None else C
v = rating_count
bayes = (v / (v + m)) * R + (m / (v + m)) * C
rating_score = clamp((bayes - 3.5) / 1.5, 0, 1)         # 3.5★→0, 5★→1

# 2. Distance: smooth decay
distance_score = math.exp(-distance_m / (radius_m / 2))

# 3. Munch popularity (Tiger): like rate across all rooms, Laplace-smoothed
munch_score = (munch_likes + 1) / (munch_swipes + 2)    # 0.5 when unknown

# 4. Combine + jitter
base  = 0.55 * rating_score + 0.35 * distance_score + 0.10 * munch_score
score = base + rng.uniform(-0.12, 0.12)                 # rng = random.Random(room.seed)
```

Put the weights and jitter in `config.py` so they're easy to tune during the hackathon. Optionally use `numpy` for scoring 500 rows at once, but it isn't required.

### 8.3 Building the deck
1. Sort by `score` descending.
2. **Diversity pass:** walk the sorted list and, if a card has the same `primary_type` as either of the previous 2 cards, swap it with the next card that doesn't. This stops five ramen shops from showing up in a row.
3. Keep the top **80** as the deck. Save `room.seed` so that a given room always produces the same deck (useful for reconnects and debugging).
4. If there are fewer than 15 candidates, retry with radius × 2, up to 3 times.

Use `random.Random(seed)`, never the global `random`, because the deck has to be reproducible. A test for that is a good one to write.

---

## 9. Frontend notes

- Design for phones first (375px wide) and use `100dvh` layouts. It should still work on desktop with arrow keys.
- **CardStack** renders the top 3 cards. Only the top card can be dragged. Past ±120px of drag, or on a flick above a velocity threshold, the card commits the swipe, flies off screen, and sends `swipe`. The UI updates optimistically.
- Preload the photos for the next 3 cards. If a card has no `photoUrl`, show a gradient with a food emoji.
- The share flow is described in §3.1. Support deep links: `/join/ABC234` pre-fills the code and fetches `GET /rooms/ABC234` to show who's already in the lobby.
- On load, if `localStorage` has a session, call `GET /rooms/{code}` and reconnect.
- **Stats page** (`/stats`, a Tiger showcase): swipes per minute as a live line chart and a "most-liked this week" list, from `GET /stats`. Poll every 5 s.
- **Mock mode:** `VITE_MOCK=1` uses a fake WebSocket and `fixtures/deck.json`, so frontend work can start before the server exists.

---

## 10. Config

`.env.example`:

```bash
# server
DATABASE_URL=postgres://tsdbadmin:<pw>@<host>.tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require
GOOGLE_PLACES_API_KEY=
WEB_ORIGIN=http://localhost:5173
INGEST_MAX_REQUESTS=200

# web
VITE_API_URL=http://localhost:8000
VITE_MOCK=0
```

Run the server with `uv run uvicorn munch.main:app --reload --port 8000`. Never commit `.env`. Share the Tiger connection string and the Google key over DMs.

**Deploy (demo):** the web app goes on Vercel or Netlify, and it must be served over HTTPS (§3.1). The server needs a long-running host because of WebSockets and in-memory state, so Railway, Render, or Fly work and serverless functions don't. Run a single worker.

---

## 11. Work split

Each workstream owns its own directory and integrates through `models.py` and this doc.

| # | Workstream | Owns | Can start with |
|---|---|---|---|
| 0 | **Scaffold** (first ~45 min, one person) | `server/pyproject.toml`, `models.py`, `config.py`, `main.py` skeleton, `db/migrations/001_init.sql`, `db/seed/fixtures.sql`, `.env.example`, Tiger instance, `make contracts` | – |
| A | **Frontend & design** | `web/` | `VITE_MOCK=1` + fixture deck |
| B | **Rooms + realtime** | `server/munch/{routes,realtime,rooms}` | A stubbed `build_deck()` that returns the fixture rows |
| C | **Ingest** | `server/munch/ingest` | `--dry-run` first, then a small capped run |
| D | **DB + ranking + Tiger features** | `server/munch/{db,ranking}`, migrations, `/stats` | Seed fixtures |

### Milestones
- **M0 scaffold.** Server boots, the migration is applied on Tiger, the fixtures are seeded, and the contracts are generated.
- **M1 end-to-end on fixtures.** Create and join a room, start it, two browsers swipe, and a match fires.
- **M2 real data.** Ingest has populated the city bbox, and ranking runs against the real data.
- **M3 polish and demo.** Animations, the AirDrop share flow, the match screen, the no-match flow, the stats page, and deployment.

### Demo script
The host creates a room and **AirDrops the link to two friends' iPhones** → they tap it and land in the lobby → swipe → two of them like the same place, and nothing happens because the third hasn't liked it yet → the third likes it → 🎉 a match appears on all three phones at once → open the stats page to show live swipes per minute coming out of the Tiger hypertable.

---

## 12. Rules for agents working on this repo

1. Read this doc first. Where it conflicts with your own guess, the doc wins.
2. `server/munch/models.py` is the contract. Don't change a REST shape, WebSocket message, or model without updating §5 and re-running `make contracts` in the same change.
3. Stay inside your workstream's directories (§11). If you need something from another workstream, stub it behind the interface defined here.
4. **The backend is Python only.** Don't add a Node or TypeScript server, and don't reimplement ranking or ingest in the frontend.
5. New schema changes go in a **new** numbered migration file. Never edit a migration that has already been applied.
6. Never call Google Places outside `ingest/` or the photo proxy, and never ship the API key to the client.
7. Type everything (`mypy --strict` and `ruff` must pass), validate all input through the Pydantic models, and keep I/O async (no blocking calls inside request handlers).
8. Pure logic (scoring, deck building, cell splitting, match checks) gets a `pytest` unit test.

---

## 13. Open questions
- Should a match require **unanimous** likes (current rule) or a configurable threshold like "≥ N of M"? Unanimous is simpler and gives a better demo moment.
- Should we add more `includedTypes` (cafe, bakery, bar)? That costs more ingest requests.
- Should cards show "open now"? We'd need `regularOpeningHours` and timezone handling. Stretch.
- Do we have an HTTPS URL for phone testing early (tunnel or a deployed preview)? AirDrop sharing can't be tested without one.
