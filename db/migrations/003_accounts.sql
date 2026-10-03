-- Accounts: sign-in, sessions, preferences, friends and each user's swipes.
-- Accounts are optional: guests keep playing anonymously, so every user_id on room data is
-- nullable. Login is Google (verified ID token) or an emailed one-time code; no passwords.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  handle        citext UNIQUE                     -- friend search; case-insensitive
                CHECK (handle ~ '^[a-zA-Z0-9_]{3,20}$'),
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 24),
  email         citext UNIQUE,                    -- verified addresses only; never sent to other users
  avatar_url    text,
  share_likes   boolean NOT NULL DEFAULT false,   -- let friends see liked restaurants
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One row per login method, so a user can have Google and email. `subject` is Google's `sub`
-- (stable, unlike the email) or the lowercased email address.
CREATE TABLE auth_identities (
  provider      text NOT NULL CHECK (provider IN ('google', 'email')),
  subject       text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX auth_identities_user_idx ON auth_identities (user_id);

-- Opaque bearer tokens; only the SHA-256 is stored, so a DB leak doesn't leak sessions.
CREATE TABLE sessions (
  token_hash    bytea PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Emailed one-time codes. Hash only; the server caps attempts and rate-limits per email.
CREATE TABLE email_login_codes (
  id            bigserial PRIMARY KEY,
  email         citext NOT NULL,
  code_hash     bytea NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  attempts      smallint NOT NULL DEFAULT 0,
  consumed_at   timestamptz
);
CREATE INDEX email_login_codes_email_idx ON email_login_codes (email, created_at DESC);

-- Saved preferences. Hard filters (price, exclude_types, dietary) merge into a room's
-- Filters at Start; favorite_types is a soft ranking boost. Type names are Google place types.
CREATE TABLE user_preferences (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  price_levels    smallint[] CHECK (price_levels <@ ARRAY[0, 1, 2, 3, 4]::smallint[]),  -- NULL = any
  exclude_types   text[] NOT NULL DEFAULT '{}',
  favorite_types  text[] NOT NULL DEFAULT '{}',
  dietary         text[] NOT NULL DEFAULT '{}'
                  CHECK (dietary <@ ARRAY['vegetarian', 'vegan', 'halal', 'gluten_free']),
  max_radius_m    integer CHECK (max_radius_m BETWEEN 100 AND 50000),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per pair, smaller id first, so (a, b) and (b, a) can't both exist.
CREATE TABLE friendships (
  user_a        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL CHECK (status IN ('pending', 'accepted')),
  requested_by  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b),
  CHECK (requested_by IN (user_a, user_b))
);
CREATE INDEX friendships_user_b_idx ON friendships (user_b);

CREATE TABLE blocks (
  blocker_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

-- Link room data to accounts. Deleting a user keeps the rows for analytics, anonymised.
ALTER TABLE room_members ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX room_members_user_idx ON room_members (user_id) WHERE user_id IS NOT NULL;

-- Every swipe a signed-in user makes, one row per swipe. Rows are never overwritten, so a
-- user who passed on a place in March and liked it in May has both rows. Used to learn what
-- they like (cuisine and price affinity for ranking) and for the profile's Liked / Passed
-- lists. Their current opinion of a restaurant is their latest row:
--   SELECT DISTINCT ON (restaurant_id) restaurant_id, liked, swiped_at
--   FROM swipes WHERE user_id = $1 ORDER BY restaurant_id, swiped_at DESC
-- Restaurant details are joined at read time (Google ToS: only place ids are kept long term).
-- A regular table, not a hypertable: a hypertable can't have swipe_id as its only unique key.
CREATE TABLE swipes (
  swipe_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- stable id other tables can reference
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id  text NOT NULL REFERENCES restaurants(id),
  liked          boolean NOT NULL,
  swiped_at      timestamptz NOT NULL DEFAULT now()
);
-- Latest decision per restaurant (the DISTINCT ON above) and full history for one place.
CREATE INDEX swipes_user_restaurant_idx ON swipes (user_id, restaurant_id, swiped_at DESC);
-- A user's swipes newest first (profile lists, recency-weighted taste).
CREATE INDEX swipes_user_time_idx ON swipes (user_id, swiped_at DESC);
