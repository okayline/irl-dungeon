-- 008: the rooms a player has stood in (v0.14). Run on the live database before the push that needs it:
--   npx wrangler d1 execute irl-dungeon-db --remote --file=migrations/008_walked_rooms.sql
-- Private to the player, never published and never on the ledger: a cell id and a room number, no coordinates, no time of day.
-- It is what the minimap outlines (rooms you have been in) and the area map's "entered" mark read.
CREATE TABLE IF NOT EXISTS walked_rooms (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  room        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell, layer, room)
);
