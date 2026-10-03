CREATE EXTENSION IF NOT EXISTS postgis;

-- Restaurants (filled by ingest)
CREATE TABLE restaurants (
  id              text PRIMARY KEY,                 -- Google place id
  name            text NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  address         text,
  rating          real,                             -- 1.0-5.0, nullable
  rating_count    integer NOT NULL DEFAULT 0,
  price_level     smallint,                         -- 0-4, nullable
  primary_type    text,                             -- e.g. 'ramen_restaurant'
  types           text[] NOT NULL DEFAULT '{}',
  photo_name      text,                             -- 'places/{id}/photos/{ref}' for the photo proxy
  maps_uri        text,
  business_status text,                             -- OPERATIONAL | CLOSED_TEMPORARILY | ...
  opening_hours   jsonb,
  fetched_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX restaurants_location_gix ON restaurants USING gist (location);
CREATE INDEX restaurants_business_status_idx ON restaurants (business_status);
