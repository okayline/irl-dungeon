-- 005: searching and finds (v0.08). Run on the live database before the push that needs it.
-- What a player has worked at on a wall today (searches so far), and what they found.
CREATE TABLE IF NOT EXISTS search_prog (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  spot        TEXT NOT NULL,                  -- the room: wing key + ":" + room number (src/search.js)
  day         INTEGER NOT NULL,
  searches    INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell, layer, spot, day)
);
-- An item found: one per player per room per day. item_id is the id in the shared item table (okayline/dungeon-items).
-- deck_pos is the place in that room-day's shuffled deck (src/deal.js), unique, so no two players get the same kind
-- until the deck is used up; copy is which copy of that item this is (1, 2, 3...), unique per item.
CREATE TABLE IF NOT EXISTS finds (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  spot        TEXT NOT NULL,
  day         INTEGER NOT NULL,
  rarity      TEXT NOT NULL,
  deck_pos    INTEGER NOT NULL,
  item_id     INTEGER NOT NULL,
  copy        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (player_id, cell, layer, spot, day),
  UNIQUE (cell, layer, spot, day, deck_pos),
  UNIQUE (item_id, copy)
);
CREATE INDEX IF NOT EXISTS finds_by_player ON finds (player_id, id);
