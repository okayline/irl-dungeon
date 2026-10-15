// Local dev server: the page plus the Worker on Node's SQLite (standing in for D1).
//   node --no-warnings test/dev-server.mjs [port]   then open http://localhost:PORT/?api=http://localhost:PORT/api&cell=8a2ab8264d07fff
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/index.js";
const root = new URL("..", import.meta.url).pathname, port = +(process.argv[2] || 8787);
const sql = new DatabaseSync(":memory:");
sql.exec(readFileSync(root + "worker/schema.sql", "utf8"));
const stmt = (q, args = []) => ({ bind: (...a) => stmt(q, a), first: async () => sql.prepare(q).get(...args) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args) }), run: async () => sql.prepare(q).run(...args) });
const env = { DB: { prepare: q => stmt(q), batch: async l => { sql.exec("BEGIN"); try { for (const s of l) await s.run(); sql.exec("COMMIT"); } catch (e) { sql.exec("ROLLBACK"); throw e; } } }, ALLOW_ORIGIN: "" };
const TYPES = { html: "text/html", js: "text/javascript", ttf: "font/ttf" };
http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/")) {
    let body = ""; for await (const c of req) body += c;
    const r = await worker.fetch(new Request("http://x" + req.url.slice(4), { method: req.method, headers: req.headers, body: body || undefined }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
  }
  const p = root + (decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html")).slice(1);
  if (!existsSync(p) || p.includes("..")) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[p.split(".").pop()] || "application/octet-stream" }); res.end(readFileSync(p));
}).listen(port, () => console.log("http://localhost:" + port));
