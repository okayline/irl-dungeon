// irl-dungeon API: a Cloudflare Worker with a D1 database (binding DB). No dependencies.
//   GET  /wing?cell=&path=      -> {committed:false} | {committed:true, wing, date, moon, name}
//   POST /commit                -> {ok, entry, firstVisit} | 409 {error, wing}      (header: Authorization: Bearer <save key>)
//          body {cell, path, day, moves, entry_id, proof, signed}
//   GET  /ledger?cell=          -> {rows: [...]}   public ledger, a cell's entries or the latest 50
//   GET  /atlas                 -> {name, rows: [...]}   the player's own entries  (Authorization: Bearer <save key>)
// The server never sees coordinates: only cell IDs. It never stores the save key: only its hash.
import WING from "../wing.js";

const MOON_REF = Date.UTC(2000, 0, 6, 18, 14), SYN = 29.530588853;
const moonIndex = ms => { let a = ((ms - MOON_REF) / 86400000) % SYN; if (a < 0) a += SYN; return Math.floor(a / SYN * 8 + 0.5) % 8; };

// PLACEHOLDER NAME LISTS: to be replaced with the designer's own lists. Names are only ever picked from these.
const ADJ = ["QUIET", "AMBER", "HOLLOW", "SALT", "PALE", "IRON", "LOW", "STATIC", "VELVET", "DIM", "COPPER", "SLOW", "GLASS", "ASH", "LATE", "TIDAL"];
const NOUN = ["MOTH", "LANTERN", "KEY", "TIDE", "HOUND", "SIGNAL", "WELL", "BELL", "CRANE", "STAIR", "RELAY", "ORCHID", "VAULT", "RIVER", "SPARK", "OWL"];
const nameFrom = hex => ADJ[parseInt(hex.slice(0, 4), 16) % ADJ.length] + " " + NOUN[parseInt(hex.slice(4, 8), 16) % NOUN.length];

const enc = new TextEncoder();
async function sha256(s) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
  return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
}

const CELL_RE = /^[0-9a-f]{15}$/, HEX64 = /^[0-9a-f]{64}$/, ID_RE = /^[0-9a-f]{32}$/, KEY_RE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;

function cors(env, req) {
  const allow = (env.ALLOW_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  const ok = !allow.length || allow.includes(origin);
  return { "Access-Control-Allow-Origin": ok ? (origin || "*") : allow[0], "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
}
const json = (h, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });

async function playerFrom(req, db) {
  const key = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/, "").trim().toUpperCase();
  if (!KEY_RE.test(key)) return null;
  const id = await sha256("player:" + key);
  return { id, name: nameFrom(await sha256("name:" + id)) };
}

// Replay the moves on the regenerated wing: every step must go through an open side, and every tile must be
// walked. This is the whole check for "clear": the client can't just claim it.
function replay(w, moves) {
  if (typeof moves !== "string" || moves.length > 2000 || /[^FLR]/.test(moves)) return false;
  let x = w.start.x, y = w.start.y, f = "N";
  const walked = new Set([x + "," + y]);
  for (const m of moves) {
    if (m === "L") f = WING.left[f];
    else if (m === "R") f = WING.right[f];
    else {
      if (WING.blocked(w, x, y, f)) return false;
      const [dx, dy] = WING.DIRS[f]; x += dx; y += dy;
      walked.add(x + "," + y);
    }
  }
  return walked.size === w.size * w.size;
}

const publicRow = r => ({ cell: r.cell, path: r.path, date: r.date, minute: r.minute || null, moon: r.moon,
  name: r.signed_name || r.anon, signed: !!r.signed_name, proof: r.proof, hash: r.commit_hash });

export default {
  async fetch(req, env) {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url), db = env.DB, path = url.pathname.replace(/\/+$/, "");
    try {
      if (req.method === "GET" && path === "/wing") {
        const cell = url.searchParams.get("cell") || "", wp = url.searchParams.get("path") || "";
        if (!CELL_RE.test(cell) || wp !== "") return json(h, { error: "bad cell" }, 400);
        const w = await db.prepare("SELECT w.snapshot, w.moon, p.date, p.signed_name FROM wings w JOIN public_ledger p ON p.entry_id = w.entry_id WHERE w.cell = ?1 AND w.path = ?2").bind(cell, wp).first();
        if (!w) return json(h, { committed: false });
        return json(h, { committed: true, wing: JSON.parse(w.snapshot), date: w.date, moon: w.moon, name: w.signed_name || null });
      }

      if (req.method === "POST" && path === "/commit") {
        const p = await playerFrom(req, db);
        if (!p) return json(h, { error: "no save key" }, 401);
        const b = await req.json().catch(() => ({}));
        const { cell, day, moves, entry_id, proof } = b, wp = b.path || "", signed = !!b.signed;
        if (!CELL_RE.test(cell || "") || wp !== "" || !ID_RE.test(entry_id || "") || !HEX64.test(proof || "")) return json(h, { error: "bad request" }, 400);
        // The day must be today somewhere on Earth: within a day of UTC's.
        const now = Date.now(), utcDay = Math.floor(now / 86400000);
        if (!Number.isInteger(day) || Math.abs(day - utcDay) > 1) return json(h, { error: "wrong day" }, 400);
        const taken = await db.prepare("SELECT snapshot FROM wings WHERE cell = ?1 AND path = ?2").bind(cell, wp).first();
        if (taken) return json(h, { error: "already found", wing: JSON.parse(taken.snapshot) }, 409);
        const w = WING.generate(cell, day, wp);
        if (!replay(w, moves)) return json(h, { error: "not cleared" }, 400);

        await db.prepare("INSERT INTO players (id, name, created) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO NOTHING").bind(p.id, p.name, now).run();
        const seqRow = await db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM private_ledger").first();
        const seq = seqRow.n, moon = moonIndex(now), iso = new Date(now).toISOString();
        const priv = { entry_id, seq, player_id: p.id, cell, path: wp, day, at_ms: now, signed: signed ? 1 : 0 };
        const commit_hash = await sha256(JSON.stringify(priv));
        const anon = nameFrom(proof);
        // One batch, so the wing, both ledgers and the player row land together or not at all. The wing's
        // primary key also settles two players finishing at once: the second insert fails and gets the 409 next time.
        await db.batch([
          db.prepare("INSERT INTO wings (cell, path, day, moon, snapshot, entry_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(cell, wp, day, moon, JSON.stringify(w), entry_id),
          db.prepare("INSERT INTO private_ledger (entry_id, seq, player_id, cell, path, day, at_ms, signed, commit_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(entry_id, seq, p.id, cell, wp, day, now, priv.signed, commit_hash),
          db.prepare("INSERT INTO public_ledger (entry_id, seq, cell, path, date, minute, moon, anon, signed_name, proof, commit_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
            .bind(entry_id, seq, cell, wp, iso.slice(0, 10), signed ? null : iso.slice(11, 16), moon, anon, signed ? p.name : null, proof, commit_hash),
        ]);
        return json(h, { ok: true, entry: { cell, path: wp, date: iso.slice(0, 10), moon, name: signed ? p.name : anon, signed } });
      }

      if (req.method === "GET" && path === "/ledger") {
        const cell = url.searchParams.get("cell");
        const q = cell && CELL_RE.test(cell)
          ? db.prepare("SELECT * FROM public_ledger WHERE cell = ?1 ORDER BY seq DESC LIMIT 50").bind(cell)
          : db.prepare("SELECT * FROM public_ledger ORDER BY seq DESC LIMIT 50");
        return json(h, { rows: (await q.all()).results.map(publicRow) });
      }

      if (req.method === "GET" && path === "/atlas") {
        const p = await playerFrom(req, db);
        if (!p) return json(h, { error: "no save key" }, 401);
        const rows = (await db.prepare("SELECT p.* FROM private_ledger v JOIN public_ledger p ON p.entry_id = v.entry_id WHERE v.player_id = ?1 ORDER BY v.seq DESC LIMIT 200").bind(p.id).all()).results;
        return json(h, { name: p.name, rows: rows.map(r => ({ ...publicRow(r), name: p.name })) });
      }

      return json(h, { error: "not found" }, 404);
    } catch (e) {
      return json(h, { error: "server error" }, 500);
    }
  },
};
