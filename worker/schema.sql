-- irl-dungeon: D1 schema. Apply with: wrangler d1 execute irl-dungeon --remote --file worker/schema.sql

-- A player is only the hash of their save key. No email, no name they typed, no location.
-- name: their consistent public name, generated from the id (only shown on entries they sign).
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created INTEGER NOT NULL
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
