-- City stamps: a "passport" of the special cities (Vancouver, Toronto, Edmonton, see
-- frontend/src/city.tsx) where a signed-in user has used the app. The phone works out the
-- city itself and only sends its name; coordinates never reach the server.
--
-- The server checks the name against models.StampCity, so adding a city needs no migration.

CREATE TABLE user_city_stamps (
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city              text NOT NULL,
  first_visited_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, city)  -- one stamp per city; visiting again changes nothing
);
