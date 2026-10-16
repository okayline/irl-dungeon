-- 007: a wall hides 0 to 3 things (v0.10). Run on the live database before the push that needs it:
--   npx wrangler d1 execute irl-dungeon-db --remote --file=migrations/007_walls.sql
-- A find now belongs to a wall and a place on it (slot 0, 1, 2), a player can find several things in a room on a day
-- (one per wall slot), and a room-day deals a separate deck for each rarity, so the deck place is unique per rarity.
-- searches on a wall are a running total: the n-th thing on a wall turns up when the total reaches the needs of
-- the things up to it. Old progress had no wall, so it is dropped (a few searches lost at most).
-- Existing finds are copied as they are (wall '', slot 0).
DROP TABLE search_prog;
CREATE TABLE search_prog (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  spot        TEXT NOT NULL,
  day         INTEGER NOT NULL,
  wall        TEXT NOT NULL,
  searches    INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell, layer, spot, day, wall)
);
CREATE TABLE finds_new (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  spot        TEXT NOT NULL,
  day         INTEGER NOT NULL,
  wall        TEXT NOT NULL DEFAULT '',
  slot        INTEGER NOT NULL DEFAULT 0,
  rarity      TEXT NOT NULL,
  deck_pos    INTEGER NOT NULL,
  item_id     INTEGER NOT NULL,
  copy        INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (player_id, cell, layer, spot, day, wall, slot),
  UNIQUE (cell, layer, spot, day, rarity, deck_pos),
  UNIQUE (item_id, copy)
);
INSERT INTO finds_new (id, player_id, cell, layer, spot, day, rarity, deck_pos, item_id, copy, created_at)
  SELECT id, player_id, cell, layer, spot, day, rarity, deck_pos, item_id, copy, created_at FROM finds;
DROP TABLE finds;
ALTER TABLE finds_new RENAME TO finds;
CREATE INDEX IF NOT EXISTS finds_by_player ON finds (player_id, id);
