// Serves public/ and the real Worker (with Node's SQLite standing in for D1) on http://localhost:8790, for the browser check in e2e.py.
import http from "node:http"; import { readFileSync, existsSync } from "node:fs"; import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "../../src/worker.js"; import { makeEnv } from "../helpers.mjs";
const env = makeEnv(), PUB = fileURLToPath(new URL("../../public", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".ttf": "font/ttf", ".txt": "text/plain" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:8790");
  if (url.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    if (process.env.LAG) await new Promise((r) => setTimeout(r, Number(process.env.LAG)));     // LAG=2000 makes every answer take 2 s, to feel a slow server
    const headers = { ...req.headers, "cf-connecting-ip": "127.0.0.1" };
    const r = await worker.fetch(new Request(url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env);
    const out = {}; r.headers.forEach((v, k) => { out[k] = v; });
    const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : []; if (sc.length) out["set-cookie"] = sc;
    res.writeHead(r.status, out); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const f = join(PUB, url.pathname === "/" ? "index.html" : url.pathname);
  if (!f.startsWith(PUB) || !existsSync(f)) { res.writeHead(404); res.end("no"); return; }
  res.writeHead(200, { "content-type": TYPES[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
}).listen(8790, () => console.log("up"));
