-- 004: admin and test mode (v0.07). Run on the live database before the push that needs it.
-- admin: 1 for the owner's player (set by hand). test_mode: an admin's switch; while on, nothing they do counts.
ALTER TABLE players ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN test_mode INTEGER NOT NULL DEFAULT 0;
-- Doors an admin opened in test mode, kept apart from real unlocks: no key, no day, never on the ledger, and only that
-- admin's test floors use them.
CREATE TABLE IF NOT EXISTS test_unlocks (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  door        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (player_id, cell, layer, door)
);
