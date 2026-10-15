-- irl-dungeon: D1 schema. Apply with: wrangler d1 execute irl-dungeon --remote --file worker/schema.sql

-- A player (v0.07): a random id and the hash of their first device's token. No email, no name they typed, no location.
-- name: their consistent public name, generated from the id (only shown on finds they sign).
-- proof_secret: makes each public entry's proof, so the player can later show "that was me".
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE,
  name TEXT NOT NULL,
  proof_secret TEXT NOT NULL,
  created INTEGER NOT NULL
);

-- Logging in elsewhere, the same way as scoundrel.exe and the 88x31 cLuB: save codes and passkeys are two
-- separate ways into one player. Only hashes of tokens and codes are stored.
CREATE TABLE IF NOT EXISTS sessions (           -- other devices a player is loaded on
  token_hash TEXT PRIMARY KEY,
  player_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_player ON sessions (player_id);
CREATE TABLE IF NOT EXISTS save_codes (         -- up to 5 per player, shown once
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS save_codes_player ON save_codes (player_id);
CREATE TABLE IF NOT EXISTS passkeys (           -- the public half of each passkey
  id INTEGER PRIMARY KEY,
  player_id TEXT NOT NULL,
  cred_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_player ON passkeys (player_id);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  challenge TEXT PRIMARY KEY,
  player_id TEXT,
  kind TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (        -- slows down guessing save codes
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window_start)
);

-- Committed wings: the frozen snapshot of the day it was first cleared. After this it is data;
-- generator changes never touch it.
CREATE TABLE IF NOT EXISTS wings (
  cell TEXT NOT NULL,
  path TEXT NOT NULL,
  day INTEGER NOT NULL,            -- the cell's local day number it was committed on
  moon INTEGER NOT NULL,           -- moon phase 0-7 at the commit
  snapshot TEXT NOT NULL,          -- the wing as JSON
  entry_id TEXT NOT NULL,
  PRIMARY KEY (cell, path)
);

-- THE PRIVATE LEDGER: the source of record. Lean on purpose: cell, wing, time, player. No GPS, no trails.
CREATE TABLE IF NOT EXISTS private_ledger (
  entry_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  player_id TEXT NOT NULL,
  cell TEXT NOT NULL,
  path TEXT NOT NULL,
  day INTEGER NOT NULL,
  at_ms INTEGER NOT NULL,
  signed INTEGER NOT NULL,
  commit_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS private_by_player ON private_ledger (player_id, seq);

-- THE PUBLIC LEDGER: a projection of the private one. No player id. Anonymous entries show the minute;
-- signed ones show the player's consistent name and the date only.
CREATE TABLE IF NOT EXISTS public_ledger (
  entry_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  cell TEXT NOT NULL,
  path TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD (UTC)
  minute TEXT,                     -- HH:MM (UTC), anonymous entries only
  moon INTEGER NOT NULL,
  anon TEXT NOT NULL,              -- per-entry anonymous name, from the proof
  signed_name TEXT,                -- the player's consistent name, signed entries only
  proof TEXT NOT NULL,             -- sha256(proof key + entry id): lets the player show "that was me"
  commit_hash TEXT NOT NULL        -- sha256 of the full private entry
);
CREATE INDEX IF NOT EXISTS public_by_cell ON public_ledger (cell, seq);
CREATE INDEX IF NOT EXISTS public_by_seq ON public_ledger (seq);

-- SIGNATURES (v0.06): signing later is appended here, never an edit to the public ledger. A signed entry shows the
-- player's consistent name; the public ledger row itself stays as it was written.
CREATE TABLE IF NOT EXISTS signatures (
  entry_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  signed_name TEXT NOT NULL,
  at_ms INTEGER NOT NULL
);
