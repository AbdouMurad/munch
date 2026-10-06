 # Munch: Design Doc

> Tinder for food. Make a room, share the code, everyone swipes on nearby restaurants, and the first one everybody likes wins.

**Status:** v2 (hackathon). This file is the source of truth for the architecture and the contracts between the pieces. If you (or your agent) need to change a contract, meaning the API shapes, WebSocket messages, or DB schema, update this doc and the Pydantic models in the same PR, then tell the team.

---

## 0. Tracks we're targeting

| Track | What we do for it | Where |
|---|---|---|
| **Main (general)** | A complete, demo-able product: create room → join → swipe → match | everything |
| **Best use of Python** | The *entire* backend is Python: async FastAPI, WebSockets, Pydantic v2 contracts, asyncpg, an adaptive geospatial crawler, and a ranking engine (seeded RNG, Bayesian smoothing). Typed end to end (`mypy --strict`), `uv` managed, `pytest` tested | `server/` |
| **Best use of Tiger Data** | Tiger Cloud Postgres with PostGIS for the per-room candidate query (built). *Planned, not built:* a TimescaleDB **hypertable** for every swipe, a **continuous aggregate** that feeds crowd popularity back into ranking, and a live stats page | §4, §8, §9 |
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
- Required accounts. Signing in is optional (§5.5); guests still join with just a name.
- Cities beyond the ones we've crawled (`BBOXES` in `ingest/grid.py`: Metro Vancouver and Edmonton). A room is always created at the host's real location, so a host elsewhere gets a thin deck rather than another city's restaurants.
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
4. **Match.** The first restaurant liked by **⌈⅔ of the active players⌉** (2→2, 3→2, 4→3, 5→4, 6→4) wins: every client switches to the results screen.
5. **Search farther.** Mid-game, the host can tap *Search farther*: the radius grows by 2 km and restaurants that were **never dealt** in this room are added to the end of everyone's deck (players who had finished go back to swiping).
6. **Results.** The winner, or if everyone ran out of cards with no match, the **top 3 by like count**, shown as a pile of cards (swipe the top one to send it to the bottom). *Play again* takes everyone back to this room's lobby (`room:replay`).

**Rules**
- You can only join while the room is in `lobby`. Joining after Start returns 409.
- A match needs likes from ⌈⅔⌉ of the members who haven't left; a pair must still agree. The first match ends the game. If someone leaves mid-swipe the bar drops, so re-check every liked restaurant at that point (the earliest in the deck wins).
- Everyone gets the **same set of restaurants, each in their own order** (`personal_order` in `rooms/manager.py`): every card moves up to 12 places from its ranked position, seeded by the room seed and the member id. Friends aren't swiping the same card at the same moment, the best places still come early for everyone, and a reconnect gets the same order back. Cards from *Search farther* come after a player's existing cards, shuffled the same way.
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

**Current schema** (`db/migrations/001_init.sql`, applied on Tiger): restaurant data only. The
crawl and room state live outside the DB for now (crawl progress in a local resume file, rooms in
memory, §6).

```sql
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE restaurants (
  id              text PRIMARY KEY,                 -- Google place id
  name            text NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  address         text,
  rating          real,                             -- 1.0–5.0, nullable
  rating_count    integer NOT NULL DEFAULT 0,
  price_level     smallint,                         -- 0–4, nullable (~16% have none)
  primary_type    text,                             -- e.g. 'ramen_restaurant'
  types           text[] NOT NULL DEFAULT '{}',
  photo_name      text,                             -- 'places/{id}/photos/{ref}' for the photo proxy
  maps_uri        text,
  business_status text,                             -- OPERATIONAL | CLOSED_TEMPORARILY | ...
  opening_hours   jsonb,                            -- Google regularOpeningHours, used by open_now
  fetched_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurants_location_gix ON restaurants USING gist (location);
CREATE INDEX restaurants_business_status_idx ON restaurants (business_status);
```

**Data on Tiger** (crawl paused at the request cap, §7): 3,783 restaurants across Vancouver and
Burnaby, 3,618 operational. 84% have a price level, 95% a rating, 90% opening hours.

**Drafted, not applied yet:**
- **`002_rooms_swipe_events.sql` (Tiger track):** `rooms`, `room_members`, the anonymous
  `swipe_events` hypertable (every swipe in every room, guests included), the
  `restaurant_swipe_stats_daily` continuous aggregate behind `/stats` and the crowd-popularity
  term, and compression on chunks older than 7 days.
- **`003_accounts.sql`:** optional accounts (guests still play anonymously). `users`,
  `auth_identities` (Google `sub` or email; `008` adds the email password hash and drops
  003's old `email_login_codes`), hashed `sessions`, `user_preferences` (hard filters merged into a room's `Filters` at Start, plus soft
  `favorite_types`), `friendships` (one row per ordered pair, pending/accepted) and `blocks`,
  `room_members.user_id`, and **`swipes`**: one row per signed-in swipe (`swipe_id` primary key,
  `user_id, restaurant_id, liked, swiped_at`), never overwritten, used to learn what each user
  likes and for the profile's Liked/Passed lists (latest row per restaurant).

**Applying migrations:** `cd server && uv run python -m munch.db.migrate` runs every pending
file in order, each in its own transaction, and records it in `schema_migrations` (version,
name, checksum). `--status` lists applied/pending; `--baseline N` marks 001..N as applied
without running them (for a DB that already had them). Editing an applied file is refused.

Use `asyncpg` with raw SQL (no ORM) so the Tiger/PostGIS features are visible in the code. Pass
geography as `ST_MakePoint(lng, lat)::geography` (longitude first).

---

## 5. Contracts (`server/munch/models.py`)

**Pydantic models are the single source of truth.** The server validates every REST body and WebSocket message with them, and the frontend's TypeScript types are generated from them (§5.4), so nobody hand-writes the same type twice.

### 5.1 Models

```python
RoomStatus = Literal["lobby", "swiping", "matched", "exhausted", "closed"]

class Filters(BaseModel):                   # all optional; how each applies: §8.1
    price_levels: list[int] | None = None   # subset of 0–4; None/empty = any
    include_unknown_price: bool = True      # with price_levels set, keep places with no price
    include_types: list[str] = []           # any of, e.g. ["sushi_restaurant"]; empty = any
    exclude_types: list[str] = []           # e.g. ["fast_food_restaurant"]
    min_rating: float | None = None         # 1–5
    min_reviews: int = 0
    open_now: bool = False                  # room's local time; drops places w/o hours

class Member(BaseModel):
    id: str
    display_name: str
    is_host: bool
    progress: int                           # number of cards swiped
    user_id: str | None = None              # signed-in account (for "add friend"); None = guest
    avatar_url: str | None = None           # their profile picture, if they have one

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
    deck_size: int                          # 0 until started; grows on "search farther"
    match_threshold: int                    # likes needed: ceil(2/3 of active members)
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
| `room:expand` | `{ radiusM? }` | Host only, in `swiping`. Default: current radius + 2 km (max 50 km) |
| `room:replay` | `{}` | Anyone, once the game is over (`matched`/`exhausted`): the same room goes back to `lobby` (same code and players, new seed, everything else reset). Repeats are no-ops |
| `room:rerun` | `{ radiusM? }` | Host only, in `exhausted` (stretch, not implemented) |
| `ping` | `{}` | Keepalive every 20 s; the server replies `pong` |

**Server → Client**

| `type` | Payload | When |
|---|---|---|
| `room:state` | `RoomState` | On connect, and whenever members or status change |
| `room:started` | `{ deck: Card[], resumeAt: int }` | Host started (or a client reconnected). The full deck is sent once, up to 80 cards. `resumeAt` is the member's own progress |
| `member:progress` | `{ memberId, progress }` | After each swipe |
| `room:matched` | `{ card: Card, likedBy: string[] }` | The first restaurant ⌈⅔⌉ of the room liked. Ends the game |
| `room:exhausted` | `{ topPicks: [{ card: Card, likes: int }] }` | Everyone finished the deck with no match |
| `room:deck_extended` | `{ cards: Card[], radiusM }` | The host searched farther; append `cards` to the deck (none were dealt before) |

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

### 5.5 Accounts, friends and invites

Optional accounts (tables: migrations `003`, `004_room_invites`, `005_user_avatars`). Code: `server/munch/accounts/` and
`routes/{auth,me,friends,invites}.py`. Everything here needs `DATABASE_URL`; without it these
endpoints answer `503 UNAVAILABLE` and rooms keep working for guests.

**Sign-in.** Either Google (the app gets an ID token from Google Sign-In; the server checks its
signature, issuer, expiry, that the audience is one of `GOOGLE_CLIENT_IDS`, and that the email
is verified) or **email + password**. Registering takes email, password (8+ characters), name
and handle in one call. Passwords are hashed with scrypt (`accounts/passwords.py`); 10 wrong
passwords for one email lock it for 15 minutes; a wrong password and an unknown email get the
same `401` so nobody can probe who has an account. All return
`AuthResponse { sessionToken, user: MyProfile, isNew }`. Google joins an existing account with
the same verified address, and since a password account's address was never proven, that
account's password and sessions are removed at that moment (the real owner keeps Google). The client stores `sessionToken` (SecureStore
on phones) and sends `Authorization: Bearer <sessionToken>`. Only its SHA-256 is stored.
Logout deletes the session.

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/auth/google` | `{ idToken }` | `AuthResponse` · `401` bad token |
| `POST` | `/auth/register` | `{ email, password, displayName, handle }` | `201 AuthResponse` · `409 EMAIL_TAKEN` / `HANDLE_TAKEN` |
| `POST` | `/auth/login` | `{ email, password }` | `AuthResponse` · `401` wrong email or password · `429 RATE_LIMITED` |
| `POST` | `/auth/logout` | – | `204` |
| `GET` / `PATCH` | `/me` | `{ handle?, displayName?, shareLikes? }` | `MyProfile` · `409 HANDLE_TAKEN` |
| `PUT` | `/me/avatar` | the image file itself (`Content-Type: image/jpeg`, png or webp, ≤ 1 MB) | `MyProfile` with the new `avatarUrl` |
| `DELETE` | `/me/avatar` | – | `MyProfile` (`avatarUrl: null`) |
| `GET` | `/users/{userId}/avatar` | – | image bytes, cached forever (the URL changes on every upload) · `404` |
| `GET` / `PUT` | `/me/preferences` | `Preferences { priceLevels, excludeTypes, favoriteTypes, dietary, maxRadiusM }` | `Preferences` |
| `GET` | `/me/invites` | – | `{ invites: RoomInvite[] }` (pending, unexpired) |
| `GET` | `/friends` | – | `{ friends, incoming, outgoing }`, each `Friendship { user: PublicUser, status, since }` |
| `POST` | `/friends` | `{ handle }` or `{ userId }` | `Friendship` (`outgoing`, or `friends` if they had already asked) |
| `POST` | `/friends/{userId}/accept` | – | `204` |
| `DELETE` | `/friends/{userId}` | – | `204` (unfriend, decline or cancel) |
| `POST` | `/rooms/{code}/invites` | `{ userIds }` | `{ invited: userId[] }` (friends only; repeats skipped) · `403` not in the room |
| `POST` | `/invites/{id}/accept` | – | `RoomSession` (joins as your account) · `404` expired |
| `POST` | `/invites/{id}/decline` | – | `204` |

`POST /rooms` and `/rooms/{code}/join` accept the same optional Bearer header: the member is
then linked to the account (`Member.userId`) and their swipes are saved to `swipes`. A bad or
missing token there just means guest. `PublicUser { id, handle, displayName, avatarUrl }` is
how other people appear; it never carries an email.

**Invites** reach a friend while the app is open, live over `GET /ws/me?token=<sessionToken>`
(server sends `{ type: "invite:received", payload: RoomInvite }`; client may `ping`), and wait
in `GET /me/invites` (the home screen inbox) otherwise. There are no push notifications. Invites
expire when the room starts or after 30 minutes.

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
4. **Match check:** if at least `match_threshold(active)` = ⌈⅔ × active⌉ active members like it, set status to `matched` and broadcast `room:matched`.
5. **Exhaustion check:** if every active member has swiped the whole deck, set status to `exhausted` and broadcast `room:exhausted` with the top 3 restaurants by like count (ties broken by deck position).

**On `room:expand`** (host): lock the room (`expanding`), build cards for `radius + 2 km` with `exclude` = every id already in the deck (the `DeckBuilder` takes an `exclude` set; the SQL filters `NOT id = ANY(...)`), append them, update `radius_m`, broadcast `room:deck_extended` then `room:state`. If nothing new is found, the radius still grows and the host gets a `NOT_FOUND` error.

**On leave or disconnect:** an explicit `room:leave` removes the member from the quorum immediately. A socket disconnect does **not** count as leaving. It takes 2 minutes with no socket before the member is treated as left (so phones that lock their screen don't break the room). Whenever the quorum shrinks, re-run the match check over every liked restaurant.

**Cleanup:** a background task started in the FastAPI lifespan removes a room from memory 30 minutes after it reaches a terminal status, or after 2 hours with no activity.

---

## 7. Ingest: grid crawler

Code: `server/munch/ingest/`. **Run instructions, flags and cost notes are in
[server/munch/ingest/README.md](../server/munch/ingest/README.md).** Only `ingest/` (and the photo
proxy) may call Google.

```bash
cd server && set -a && source ../.env && set +a
uv run python -m munch.ingest --dry-run                         # grid size, no calls
uv run python -m munch.ingest --bbox vanburnaby --max-requests 1000
uv run python -m munch.ingest.search --lat 49.2827 --lng -123.1207   # one search, no DB
```

### 7.1 The constraint
Places API (New) `searchNearby` returns **at most 20 results** with **no pagination**, and in
practice **trims some after the cap**: a saturated circle can come back with 19. So any result of
**18 or more** is treated as saturated (found by testing at Metrotown, where a 915 m search returned
19 while smaller circles inside it found dozens more).

### 7.2 Algorithm
- **Boxes** (`ingest/grid.py`, south-west and north-east corners):
  `test` Metrotown 49.222,-123.012 → 49.232,-122.992 · `city` 49.198,-123.225 → 49.317,-123.023 ·
  **`vanburnaby` (default)** 49.180,-123.225 → 49.317,-122.890 · `metro` 49.100,-123.270 → 49.380,-122.850 ·
  `edmonton` 53.395,-113.714 → 53.716,-113.271 (City of Edmonton).
- Tile the box into 1,500 m squares (187 for `vanburnaby`). Search each with the smallest circle
  covering it (half the diagonal), `rankPreference: DISTANCE`, 5 requests in flight.
- **Saturated cell → density-sized split.** Results are nearest-first, so the distance to the
  farthest result gives local density; the cell is split into a grid sized for ~12 places per
  child, **capped at 3×3** per split (density isn't uniform; an 8×8 cap wasted calls on empty
  residential edges). Children wholly inside 90% of the covered radius are skipped.
- Below a **40 m** search radius a still-saturated cell is logged as dense (mall food courts).
- Every result is upserted by place id (`ON CONFLICT (id) DO UPDATE`), so overlapping circles never
  duplicate rows; `RETURNING (xmax = 0)` reports which were new.
- Progress is saved to `server/crawl_state-<area>.json` (one file per area) after every response. Re-running the same
  command **resumes** without re-paying; the file is deleted when the crawl completes. `--fresh`
  starts over.
- Pure geometry (`tile_bbox`, `split_dims`, `split_cell`, `inside_disk`) is unit tested.

### 7.3 Request
`POST https://places.googleapis.com/v1/places:searchNearby` with `includedTypes: ["restaurant"]`,
`maxResultCount: 20`, `rankPreference: DISTANCE`, a circle `locationRestriction`, and the field mask
in `ingest/places.py` (id, name, location, address, rating, review count, price level, types,
photos, maps link, business status, opening hours). `priceLevel` enums map to 0–4; only
`photos[0].name` is stored.

### 7.4 Cost and ToS guardrails ⚠️
- Rating, review count, price level and hours put every call in the **Enterprise** Nearby Search
  SKU. Ranking needs those fields, and per-place detail calls would cost more, so this is the
  cheapest way to get them. Check current pricing and set a budget alert before a big run.
- The first `vanburnaby` run used 1,000 calls for 3,783 restaurants and stopped at the cap with
  420 cells queued; finishing it should take roughly 450–600 more.
- Always `--dry-run` first; `--max-requests` is a hard cap (default 200).
- Crawl **once** into the shared Tiger DB. Teammates use that DB; don't re-crawl from your machine.
- Photos: `GET /api/photos/{id}` should call `https://places.googleapis.com/v1/{photo_name}/media?maxWidthPx=800&key=...`
  server-side so the key never reaches the client. Cache the bytes.
- Google's terms restrict long-term caching of Places content (place IDs are exempt). Fine for a
  hackathon demo; say so if asked.

---

## 8. Ranking

Code: `server/munch/ranking/`. **`deck.py`** builds the deck, **`scoring.py`** holds the pure
scoring, shuffle and variety functions, **`hours.py`** the open-now check. Weights live in
`config.py` (§10).

**Wiring.** `main.py` uses `make_deck_builder(db_pool, settings)` when `DATABASE_URL` is set, and
falls back to `rooms/fixture_deck.py` without a DB. Both match the `DeckBuilder` signature
`(center: LatLng, radius_m: int, filters: Filters, seed: int) -> list[Card]`, so the room code
doesn't care which one runs.

Try it from the command line (all `Filters` fields have flags):

```bash
cd server
uv run python -m munch.ranking --lat 49.2276 --lng -123.0003 --count 15
uv run python -m munch.ranking --price 1 2 --known-price --exclude fast_food_restaurant --min-rating 4.5
uv run python -m munch.ranking --type sushi_restaurant ramen_restaurant --open-now --min-reviews 200
```

### 8.1 Candidates and filters (SQL)
Up to 1,000 nearest operational restaurants within the radius (PostGIS `ST_DWithin` plus KNN
`ORDER BY location <-> point`), with every `Filters` field (§5.1) except `open_now` applied in
SQL:

| Filter | Rule |
|---|---|
| radius (`radiusM` on the room) | `ST_DWithin(location, point, radius)` |
| `priceLevels` | `price_level = ANY(...)`; places with no price are kept unless `includeUnknownPrice` is false |
| `includeTypes` | the place's `types` overlap the list (any of). Empty = any |
| `excludeTypes` | no overlap with the list |
| `minRating` | `rating >= minRating` (unrated places drop out) |
| `minReviews` | `rating_count >= minReviews` |
| `openNow` | checked in Python against `opening_hours` at the current time **where the room is searching** (`tz_for` in `ranking/hours.py`: a box per crawled province, defaulting to `America/Vancouver`); places with no hours drop out |

Type values are Google's: `sushi_restaurant`, `ramen_restaurant`, `pizza_restaurant`,
`vegan_restaurant`, `fast_food_restaurant`, `cafe`, `bakery`, and so on. The most common in our
data are `restaurant` (generic), `chinese_restaurant`, `pizza_restaurant`, `japanese_restaurant` and
`fast_food_restaurant`.

If fewer than `min_candidates` (15) match, the radius doubles, up to 3 times.

### 8.2 Score

```python
# 1. Bayesian-smoothed rating: a 5.0 with 3 reviews shouldn't beat a 4.6 with 2,000.
bayes = (v * R + m * C) / (v + m)            # C = 4.2 prior mean, m = 50 prior reviews
rating_score = clamp((bayes - 3.5) / 1.5)    # 3.5★ → 0, 5★ → 1

# 2. Popularity: lots of reviews is rewarded on its own, log scale, maxing at 2,000
popularity_score = clamp(log1p(v) / log1p(2000))

# 3. Distance: 1 at the center, ~0.37 at half the radius, ~0.14 at the edge
distance_score = exp(-distance_m / (radius_m / 2))

base  = 0.5 * rating_score + 0.2 * popularity_score + 0.3 * distance_score
score = base + rng.uniform(-0.05, 0.05)      # rng = random.Random(seed)
```

The jitter is deliberately **bounded**: a place can only overtake places within 0.1 of its own
score, so the best places stay near the front but the order changes per seed. (Unbounded Gumbel
noise was tried first; with ~1,000 candidates at Metrotown it let a 0.64 land 2nd, ahead of a
0.88.) When the swipes hypertable exists (§4), a crowd-popularity term from the continuous
aggregate can join the sum.

### 8.3 Building the deck
1. Sort by jittered score.
2. **Variety pass:** if a card's `primary_type` matches either of the previous 2, pull forward the
   next card that doesn't. Generic types (`restaurant`, `food`, `meal_takeaway`) never count as a
   repeat.
3. Keep the top `deck_size` (80) and convert to `Card`. `photoUrl` is `/api/photos/{id}` when the
   place has a photo.
4. The same seed and data always give the same deck (tested), so `room.seed` reproduces a room's
   deck. Use `random.Random(seed)`, never the global `random`.

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

`DATABASE_URL` must include the password (`postgres://tsdbadmin:PASSWORD@...`); typing it at a psql prompt doesn't help the server or the crawler. With it set, the server deals real decks from Tiger; without it, it falls back to the fixture deck.

Ranking knobs in `config.py` (override with env vars of the same name in upper case): `RATING_PRIOR_MEAN` 4.2, `RATING_PRIOR_WEIGHT` 50, `POPULAR_REVIEWS` 2000, `WEIGHT_RATING` 0.5, `WEIGHT_POPULARITY` 0.2, `WEIGHT_DISTANCE` 0.3, `JITTER` 0.05, `DECK_SIZE` 80, `MIN_CANDIDATES` 15.

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

### Status (2026-10-03)
- **Done (C, D):** `restaurants` schema on Tiger; crawler with density splits and resume; 3,783
  Vancouver + Burnaby restaurants loaded; real `build_deck` with all filters, wired into `main.py`.
- **Done (B):** contract models, config, app skeleton, `RoomManager`, room REST routes, WebSocket
  protocol, fixture deck.
- **Changed from the original plan:** the schema is restaurants only (§4), `Filters` gained fields
  (§5.1), the ranking swapped the swipe-based term for review-count popularity (§8.2). The frontend
  lives in `frontend/` (Expo) rather than `web/`; §2, §5.4 and §9 still describe the old `web/`
  plan for the frontend team to update.
- **Open:**
  - Finish the crawl (420 cells queued, §7.4).
  - Photo proxy route `GET /api/photos/{id}`: `Card.photoUrl` already points at it, but it isn't
    built, so images 404 for now.
  - Decide whether to build the Tiger track (swipes hypertable, continuous aggregate, `/stats`,
    §4). The demo script's stats page depends on it.
  - `rooms/fixture_deck.py` only applies the price and exclude-type filters; fine for no-DB dev.
  - Regenerate frontend types for the new `Filters` fields once a contracts script exists for
    `frontend/`.

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
