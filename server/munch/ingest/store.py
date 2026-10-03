"""Write crawled places into the restaurants table."""

import json

import asyncpg

from munch.ingest.places import Place

# xmax = 0 only for freshly inserted rows, so this tells new places from duplicates.
UPSERT_SQL = """
INSERT INTO restaurants (
  id, name, location, lat, lng, address, rating, rating_count, price_level,
  primary_type, types, photo_name, maps_uri, business_status, opening_hours, fetched_at
) VALUES (
  $1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $3, $4, $5, $6, $7, $8,
  $9, $10, $11, $12, $13, $14::jsonb, now()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  location = EXCLUDED.location,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  address = EXCLUDED.address,
  rating = EXCLUDED.rating,
  rating_count = EXCLUDED.rating_count,
  price_level = EXCLUDED.price_level,
  primary_type = EXCLUDED.primary_type,
  types = EXCLUDED.types,
  photo_name = EXCLUDED.photo_name,
  maps_uri = EXCLUDED.maps_uri,
  business_status = EXCLUDED.business_status,
  opening_hours = EXCLUDED.opening_hours,
  fetched_at = now()
RETURNING (xmax = 0) AS inserted
"""


async def upsert_places(pool: asyncpg.Pool, places: list[Place]) -> int:
    """Insert or refresh places; returns how many were new to the table."""
    new = 0
    async with pool.acquire() as conn, conn.transaction():
        for p in places:
            inserted: bool = await conn.fetchval(
                UPSERT_SQL,
                p.id,
                p.name,
                p.lat,
                p.lng,
                p.address,
                p.rating,
                p.rating_count,
                p.price_level,
                p.primary_type,
                p.types,
                p.photo_name,
                p.maps_uri,
                p.business_status,
                json.dumps(p.opening_hours) if p.opening_hours is not None else None,
            )
            new += inserted
    return new
