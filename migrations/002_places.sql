-- 002: the travel check (v0.04). Run on the live database before the push that needs it.
-- Each player's last credited cell and when they claimed it (seconds). One row per player, overwritten; never
-- published. A cell id is about 100 m of location, so this is kept only to check that claims make sense together.
CREATE TABLE IF NOT EXISTS places (
  player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  at          INTEGER NOT NULL
);
