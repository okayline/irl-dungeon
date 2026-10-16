// The ledger: one SHA-256 hash chain over everything the game seals, in the order sealed.
// Same design as the other games' ledgers (scoundrel.exe, dawn-baton).
//
//   record = JSON of the event
//   hash   = SHA-256( prev_hash + "|" + record )
//
// The first entry chains from GENESIS. Changing any old record breaks its hash and every hash after it.
// prev_hash is UNIQUE, so two entries can never build on the same head: no forks, and two writers racing for the
// head can't both win (the loser re-reads the head and tries again).
//
// Records hold no names, no coordinates and no exact times the game doesn't want public. Who did it is kept in the
// table's own player_id column, which no endpoint publishes.
//
// WHAT A CHAIN CANNOT DO: it can't show that the newest entries were dropped. Only a copy of the head kept somewhere
// else can (verifyChain returns the head so it can be saved). See test/ledger.test.mjs, "KNOWN LIMIT".
//
// Whatever else a write must change goes in the same D1 batch as its ledger entry (chainInserts), so an action is
// saved if and only if it is on the ledger.

export const GENESIS = "0".repeat(64);

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function head(db) {
  const h = await db.prepare("SELECT hash FROM ledger ORDER BY id DESC LIMIT 1").first();
  return h ? h.hash : GENESIS;
}

// Build insert statements for a list of entries chained one after another from `prev`.
// Each entry: { kind, record (a JSON string), playerId?, t (seconds) }.
export async function chainInserts(db, prev, entries) {
  const stmts = [];
  let p = prev;
  for (const e of entries) {
    const hash = await sha256(p + "|" + e.record);
    stmts.push(db.prepare(
      "INSERT INTO ledger (kind, player_id, record, prev_hash, hash, created_at) VALUES (?,?,?,?,?,?)")
      .bind(e.kind, e.playerId ?? null, e.record, p, hash, e.t));
    p = hash;
  }
  return stmts;
}

export const isUnique = (e) => /UNIQUE/i.test(String(e && e.message));
export const chainClash = (e) => isUnique(e) && /ledger\.(prev_)?hash/.test(String(e.message));

// Seal one entry on the current head. Returns "sealed", or "duplicate" if some other unique rule (added later for a
// particular kind of entry) says it is already there. Someone else moving the head first is retried; if the ledger
// stays busy it fails loudly and writes nothing.
export async function seal(db, entry) {
  for (let i = 0; i < 8; i++) {
    const stmts = await chainInserts(db, await head(db), [entry]);
    try { await db.batch(stmts); return "sealed"; }
    catch (e) {
      if (chainClash(e)) continue;
      if (isUnique(e)) return "duplicate";
      throw e;
    }
  }
  throw new Error("The ledger is busy. Try again.");
}

// Check that rows (oldest first) form an unbroken chain starting from `from` (the genesis by default; pass the hash
// of the row before the first one to check a later slice). Returns { ok: true, count, head } or { ok: false, at: id }.
export async function verifyChain(rows, from = GENESIS) {
  let p = from;
  for (const r of rows) {
    if (r.prev_hash !== p) return { ok: false, at: r.id };
    if ((await sha256(p + "|" + r.record)) !== r.hash) return { ok: false, at: r.id };
    p = r.hash;
  }
  return { ok: true, count: rows.length, head: p };
}
