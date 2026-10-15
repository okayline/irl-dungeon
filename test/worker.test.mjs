// Runs the Worker against Node's built-in SQLite standing in for D1:  node --no-warnings test/worker.test.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import worker from "../worker/index.js";
import WING from "../wing.js";

const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a),
  first: async () => sql.prepare(q).get(...args) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args) }),
  run: async () => sql.prepare(q).run(...args),
});
const DB = { prepare: q => stmt(q), batch: async list => { sql.exec("BEGIN"); try { for (const s of list) await s.run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } } };
const env = { DB, ALLOW_ORIGIN: "" };
const call = async (method, path, body, key) => {
  const r = await worker.fetch(new Request("https://x" + path, { method, body: body && JSON.stringify(body), headers: key ? { Authorization: "Bearer " + key } : {} }), env);
  return { status: r.status, body: await r.json() };
};

// A route that walks every tile: depth-first, turning to face each way and stepping back out.
function walkAll(w) {
  let f = "N", moves = "";
  const face = d => { while (f !== d) { f = WING.right[f]; moves += "R"; } };
  const OPP = { N: "S", S: "N", E: "W", W: "E" }, seen = new Set();
  (function go(x, y) {
    seen.add(x + "," + y);
    for (const d of ["N", "E", "S", "W"]) {
      const [dx, dy] = WING.DIRS[d], k = (x + dx) + "," + (y + dy);
      if (WING.blocked(w, x, y, d) || seen.has(k)) continue;
      face(d); moves += "F"; go(x + dx, y + dy); face(OPP[d]); moves += "F";
    }
  })(w.start.x, w.start.y);
  return moves;
}

let fails = 0;
const check = (name, ok) => { console.log((ok ? "ok   " : "FAIL ") + name); if (!ok) fails++; };
const KEY = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ23-4567", KEY2 = "BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-2222";
const cell = "8a2ab8264d07fff", day = Math.floor(Date.now() / 86400000);
const w = WING.generate(cell, day, ""), moves = walkAll(w);
const id = () => createHash("md5").update(String(Math.random())).digest("hex");
const proof = () => createHash("sha256").update(String(Math.random())).digest("hex");

check("unclaimed wing reads as not committed", (await call("GET", `/wing?cell=${cell}`)).body.committed === false);
check("commit without save key is refused", (await call("POST", "/commit", { cell, day, moves, entry_id: id(), proof: proof() })).status === 401);
check("commit with a missed tile is refused", (await call("POST", "/commit", { cell, day, moves: "F", entry_id: id(), proof: proof() }, KEY)).status === 400);
check("commit on a far-off day is refused", (await call("POST", "/commit", { cell, day: day - 5, moves, entry_id: id(), proof: proof() }, KEY)).status === 400);
const c = await call("POST", "/commit", { cell, day, moves, entry_id: id(), proof: proof(), signed: true }, KEY);
check("a full clear commits", c.status === 200 && c.body.ok);
check("second finder gets 409", (await call("POST", "/commit", { cell, day, moves, entry_id: id(), proof: proof() }, KEY2)).status === 409);
const g = await call("GET", `/wing?cell=${cell}`);
check("committed wing returns the frozen snapshot", g.body.committed && JSON.stringify(g.body.wing.walls) === JSON.stringify(w.walls));
const cell2 = "8a2ab8264d0ffff", w2 = WING.generate(cell2, day, "");
await call("POST", "/commit", { cell: cell2, day, moves: walkAll(w2), entry_id: id(), proof: proof() }, KEY);
const led = (await call("GET", "/ledger")).body.rows;
check("public ledger has both entries", led.length === 2);
check("signed entry: consistent name, date only", led[1].signed && led[1].minute === null);
check("anon entry: per-entry name, has minute", !led[0].signed && /^\d\d:\d\d$/.test(led[0].minute));
check("public ledger has no player id", !JSON.stringify(led).includes("player"));
const at = (await call("GET", "/atlas", null, KEY)).body;
check("atlas lists the player's two finds under one name", at.rows.length === 2 && at.rows.every(r => r.name === at.name));
check("another player's atlas is empty", (await call("GET", "/atlas", null, KEY2)).body.rows.length === 0);
process.exit(fails ? 1 : 0);
