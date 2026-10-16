-- 006: finds are numbered by the shared registry (v0.09). Run on the live database before the push that needs it:
--   npx wrangler d1 execute irl-dungeon-db --remote --file=migrations/006_registry_copies.sql
-- A find is saved first and numbered a moment later (the number comes from the registry in okayline/dungeon-items), so
-- `copy` may be empty until then. SQLite can't drop NOT NULL in place, so the table is rebuilt: the rows are copied as
-- they are, and nothing refers to finds. UNIQUE (item_id, copy) stays: any number of finds may be waiting for a number
-- (empty values never clash), but a number is never on two finds of the same item.
CREATE TABLE finds_new (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  spot        TEXT NOT NULL,
  day         INTEGER NOT NULL,
  rarity      TEXT NOT NULL,
  deck_pos    INTEGER NOT NULL,
  item_id     INTEGER NOT NULL,
  copy        INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE (player_id, cell, layer, spot, day),
  UNIQUE (cell, layer, spot, day, deck_pos),
  UNIQUE (item_id, copy)
);
INSERT INTO finds_new (id, player_id, cell, layer, spot, day, rarity, deck_pos, item_id, copy, created_at)
  SELECT id, player_id, cell, layer, spot, day, rarity, deck_pos, item_id, copy, created_at FROM finds;
DROP TABLE finds;
ALTER TABLE finds_new RENAME TO finds;
CREATE INDEX IF NOT EXISTS finds_by_player ON finds (player_id, id);
