-- 001: the game's own tables (v0.03). Run on the live database before the push that needs it.
-- Each door a player has unlocked, in order. door is the exit's room number. day is the player's local day (days since
-- 1970): UNIQUE (player_id, day) is the one-key-a-day rule. tz_check says whether the claimed UTC offset matched the
-- time zone Cloudflare infers from the IP (match, mismatch, unknown): a soft signal, never a reason to refuse.
CREATE TABLE IF NOT EXISTS unlocks (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  door        INTEGER NOT NULL,
  day         INTEGER NOT NULL,
  tz_check    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (player_id, day),
  UNIQUE (player_id, cell, layer, door)
);
CREATE INDEX IF NOT EXISTS unlocks_run ON unlocks (player_id, cell, layer, id);

-- A wing a player has walked in full. wing_key is the path that leads to the wing: "0" for the first wing, then the
-- door numbers unlocked on the way ("0>3>7").
CREATE TABLE IF NOT EXISTS completions (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  wing_key    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell, layer, wing_key)
);

-- The first finder of each wing, forever. The primary key is what makes "first" mean first: a second claim for the
-- same wing is refused by the database. The same batch seals the entry on the ledger (anonymous: player_id stays in
-- this table and in the ledger's own private column, so a name can be attached later).
CREATE TABLE IF NOT EXISTS wing_firsts (
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  wing_key    TEXT NOT NULL,
  player_id   INTEGER NOT NULL REFERENCES players(id),
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (cell, layer, wing_key)
);
