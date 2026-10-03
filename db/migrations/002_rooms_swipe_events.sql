-- Rooms, members and the swipe log (DESIGN.md §4 "Planned").
-- Live room state stays in memory (§6); these rows are written in the background for
-- durability, analytics and the Tiger features.

CREATE EXTENSION IF NOT EXISTS timescaledb;  -- already enabled on Tiger Cloud

CREATE TABLE rooms (
  id                     uuid PRIMARY KEY,
  code                   char(6) NOT NULL,               -- reused once a room is gone
  status                 text NOT NULL
                         CHECK (status IN ('lobby', 'swiping', 'matched', 'exhausted', 'closed')),
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
CREATE INDEX rooms_code_idx ON rooms (code, created_at DESC);
CREATE INDEX rooms_matched_idx ON rooms (matched_restaurant_id) WHERE matched_restaurant_id IS NOT NULL;

CREATE TABLE room_members (
  id            uuid PRIMARY KEY,
  room_id       uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  display_name  text NOT NULL,
  is_host       boolean NOT NULL DEFAULT false,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  left_at       timestamptz
);
CREATE INDEX room_members_room_idx ON room_members (room_id);

-- Every swipe in every room, guests included, as a time-series event log (Timescale
-- hypertable). Anonymous: it feeds /stats and crowd popularity. Per-user likes live in
-- `swipes` (003_accounts).
-- No foreign keys: rows are written from a background task and must never be rejected.
-- One swipe per member per card is enforced by the server, since a unique index on a
-- hypertable would have to include swiped_at.
CREATE TABLE swipe_events (
  swiped_at      timestamptz NOT NULL DEFAULT now(),
  room_id        uuid NOT NULL,
  member_id      uuid NOT NULL,
  restaurant_id  text NOT NULL,
  liked          boolean NOT NULL
);
SELECT create_hypertable('swipe_events', by_range('swiped_at'));
CREATE INDEX swipe_events_room_idx ON swipe_events (room_id, swiped_at DESC);
CREATE INDEX swipe_events_restaurant_idx ON swipe_events (restaurant_id, swiped_at DESC);

-- Crowd popularity across all rooms, fed back into ranking and shown on /stats.
CREATE MATERIALIZED VIEW restaurant_swipe_stats_daily
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 day', swiped_at) AS bucket,
       restaurant_id,
       count(*) FILTER (WHERE liked) AS likes,
       count(*)                       AS swipes
FROM swipe_events
GROUP BY bucket, restaurant_id
WITH NO DATA;

SELECT add_continuous_aggregate_policy('restaurant_swipe_stats_daily',
  start_offset      => INTERVAL '30 days',
  end_offset        => INTERVAL '1 hour',
  schedule_interval => INTERVAL '15 minutes');

-- Compress swipe chunks older than a week (Tiger pitch: storage stays small as the log grows).
ALTER TABLE swipe_events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'restaurant_id',
  timescaledb.compress_orderby   = 'swiped_at DESC'
);
SELECT add_compression_policy('swipe_events', INTERVAL '7 days');
