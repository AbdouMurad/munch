-- Profile pictures uploaded from the app. The phone crops and shrinks them to a small square
-- JPEG first, so each one is tens of kilobytes; storing them in Postgres keeps the hackathon
-- setup to one database with no file storage service.
--
-- users.avatar_url (003) points at GET /api/users/{id}/avatar?v=<version> for an uploaded
-- picture, or at Google's picture for Google sign-ins that never uploaded one.

CREATE TABLE user_avatars (
  user_id       uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data          bytea NOT NULL CHECK (octet_length(data) <= 1000000),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
`