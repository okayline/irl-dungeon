-- 003: names, signed first finds and saved cells (v0.05). Run on the live database before the push that needs it.
-- A name is two word ids from src/names.js ("adj:3", "noun:7"); the pair is unique. Null until the player signs a find.
ALTER TABLE players ADD COLUMN name_a TEXT;
ALTER TABLE players ADD COLUMN name_b TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (name_a, name_b) WHERE name_a IS NOT NULL;
-- 1 once the first finder has signed the wing (the signing is also sealed on the ledger, without the name).
ALTER TABLE wing_firsts ADD COLUMN signed INTEGER NOT NULL DEFAULT 0;
-- Cells a player saved, to come back to (up to 20). Private: never published.
CREATE TABLE IF NOT EXISTS saved_cells (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell)
);
