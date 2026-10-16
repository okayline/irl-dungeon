-- irl-dungeon database (Cloudflare D1)
--   npx wrangler d1 create irl-dungeon-db            (paste the id into wrangler.jsonc)
--   npx wrangler d1 execute irl-dungeon-db --remote --file=schema.sql
--
-- Foundation only: players, the ledger, and the ways back in. Game tables arrive with the game, each with a
-- migration in migrations/ and an update here.

-- A player is a browser cookie (only the token's SHA-256 is stored). No location, no email. A name (two word ids from
-- src/names.js, a unique pair) only once they sign a find.
CREATE TABLE IF NOT EXISTS players (
  id          INTEGER PRIMARY KEY,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL,
  name_a      TEXT,
  name_b      TEXT,
  admin       INTEGER NOT NULL DEFAULT 0,      -- set by hand for the owner
  test_mode   INTEGER NOT NULL DEFAULT 0,      -- an admin's switch: while on, nothing they do counts (see test_unlocks)
  test_from   TEXT                             -- the cell they switched test mode on in; switching off goes back there
);
CREATE UNIQUE INDEX IF NOT EXISTS players_name ON players (name_a, name_b) WHERE name_a IS NOT NULL;

-- THE LEDGER: one SHA-256 hash chain over everything the game seals, in the order sealed.
--   hash = SHA-256(prev_hash + "|" + record), the first entry chains from 64 zeros.
-- prev_hash is UNIQUE, so two entries can never build on the same parent: the chain can't fork, and two writers
-- racing for the head can't both win. Changing any old record breaks every hash after it.
-- player_id is kept here for the game's own use and is never published; the sealed record never holds a name.
CREATE TABLE IF NOT EXISTS ledger (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL,
  player_id   INTEGER,
  record      TEXT NOT NULL,          -- the sealed JSON record
  prev_hash   TEXT NOT NULL UNIQUE,
  hash        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);

-- extra devices a player is loaded on (the first device keeps using players.token_hash)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,         -- SHA-256 of the cookie token
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player_id);

-- save codes like K7QM-2XPA-9RTD-HV4C-8NBE; only their hash is stored (up to 5 per player)
CREATE TABLE IF NOT EXISTS save_codes (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  code_hash     TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS save_codes_player ON save_codes (player_id);

-- passkeys (WebAuthn): the public half of each key
CREATE TABLE IF NOT EXISTS passkeys (
  id            INTEGER PRIMARY KEY,
  player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cred_id       TEXT NOT NULL UNIQUE,
  public_key    TEXT NOT NULL,          -- JWK
  alg           INTEGER NOT NULL,       -- -7 ES256, -257 RS256
  sign_count    INTEGER NOT NULL DEFAULT 0,
  label         TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys (player_id);

CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge   TEXT PRIMARY KEY,
  player_id   INTEGER,
  kind        TEXT NOT NULL,            -- register | login
  expires_at  INTEGER NOT NULL
);

-- slows down guessing save codes and making players
CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT NOT NULL,
  window_start  INTEGER NOT NULL,
  count         INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- THE GAME'S OWN STATE (v0.03). Ordinary tables, only read by the player they belong to; what needs proving to other
-- people goes on the ledger instead.

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
  signed      INTEGER NOT NULL DEFAULT 0,        -- 1 once the finder has signed it (src/worker.js sign)
  PRIMARY KEY (cell, layer, wing_key)
);

-- Each player's last credited cell and when they claimed it (seconds), for the travel check (src/travel.js). One row
-- per player, overwritten; never published.
CREATE TABLE IF NOT EXISTS places (
  player_id   INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  at          INTEGER NOT NULL
);

-- Cells a player saved, to come back to (up to 20). Private: never published.
CREATE TABLE IF NOT EXISTS saved_cells (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell)
);

-- Doors an admin opened in test mode, kept apart from real unlocks: no key, no day, never on the ledger.
CREATE TABLE IF NOT EXISTS test_unlocks (
  id          INTEGER PRIMARY KEY,
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  door        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (player_id, cell, layer, door)
);

-- Searching and finds (migrations/005, 007).
-- searches is the running total of searches on one wall by one player on one day. The n-th thing on a wall turns up when
-- that total reaches the needs of the things up to it (src/search.js), so a find never has to reset anything.
CREATE TABLE IF NOT EXISTS search_prog (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  spot        TEXT NOT NULL,                  -- the room: wing key + ":" + room number (src/search.js)
  day         INTEGER NOT NULL,
  wall        TEXT NOT NULL,
  searches    INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell, layer, spot, day, wall)
);
-- An item found: a wall hides 0 to 3 things and each is found once per player per day, so a find is one (wall, slot).
-- item_id is the id in the shared item table (okayline/dungeon-items). deck_pos is the place in that room-day's shuffled
-- deck of that rarity (src/deal.js), unique per rarity, so no two players get the same kind until the deck is used up;
-- copy is which copy of that item this is (1, 2, 3...), unique per item. The number comes from the shared registry
-- (migrations/006): a find is saved first and numbered a moment later, so copy may be empty until then. Empty values
-- never clash, so any number of finds can be waiting.
CREATE TABLE IF NOT EXISTS finds (
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
CREATE INDEX IF NOT EXISTS finds_by_player ON finds (player_id, id);

-- The rooms a player has stood in (migrations/008). Room 0 is written when they open a cell that earns credit; the page sends
-- the others in batches (POST /api/rooms), so a reload keeps a half-walked wing. Private: never published, never on the ledger.
CREATE TABLE IF NOT EXISTS walked_rooms (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  cell        TEXT NOT NULL,
  layer       INTEGER NOT NULL DEFAULT 0,
  room        INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (player_id, cell, layer, room)
);
