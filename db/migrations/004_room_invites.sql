-- Room invites between friends. An invite reaches a friend live over /ws/me while the app is
-- open, and stays in their inbox (GET /api/me/invites) until it's answered or expires.

CREATE TABLE room_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id       uuid NOT NULL,            -- no FK: live rooms are in memory, the row may lag
  room_code     char(6) NOT NULL,         -- what the friend needs to join
  from_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,     -- room start, or 30 min, whichever comes first
  responded_at  timestamptz,
  CHECK (from_user_id <> to_user_id)
);
-- One pending invite per friend per room, so inviting twice doesn't spam.
CREATE UNIQUE INDEX room_invites_one_pending
  ON room_invites (room_id, to_user_id) WHERE status = 'pending';
-- A user's pending invites, newest first (home screen inbox).
CREATE INDEX room_invites_inbox_idx ON room_invites (to_user_id, status, created_at DESC);
