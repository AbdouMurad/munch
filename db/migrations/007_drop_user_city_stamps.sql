-- City stamps were scrapped. 006 created the table and is already applied, so it stays
-- (the migration runner needs every applied file); this removes the table again.

DROP TABLE IF EXISTS user_city_stamps;
