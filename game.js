// The page: finds the player's cell, plays today's wing (or the frozen one, if someone already found it),
// and sends a clear to the server with the moves that prove it.
(function () {
  // The Worker's address, no trailing slash. Blank plays offline: nothing is sent or loaded.
  // ?api=<url> overrides it (for testing).
  const API = new URLSearchParams(location.search).get("api") || "https://irl-dungeon.ddddungeon.workers.dev";
  const RES = 10;                                   // H3 resolution 10: cells of roughly 100 m
  const out = document.getElementById("screen");
  const tz = SMT.zone();
  const MOONS = ["new moon", "waxing crescent", "first quarter", "waxing gibbous", "full moon", "waning gibbous", "last quarter", "waning crescent"];
  const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  let game = null, msg = "", popup = null;          // popup: null, "clear", "key", "keyentry", "atlas"
  let atlas = null, keyDraft = "", newKey = false;

  // THE SAVE KEY: the player's whole identity. Made here, kept in this browser; the server only ever sees its hash.
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
  const KEY_RE = /^[A-Z2-7]{4}(-[A-Z2-7]{4}){7}$/;
  function makeKey() {
    const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", b = crypto.getRandomValues(new Uint8Array(32));
    return [...b].map(x => A[x & 31]).join("").match(/.{4}/g).join("-");
  }
  const getKey = () => { const k = store.get("irl.key"); return k && KEY_RE.test(k) ? k : null; };
  async function sha256(s) {
    const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
    return [...b].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  const randId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");

  async function api(method, path, body) {
    const key = getKey(), headers = { "Content-Type": "application/json" };
    if (key) headers.Authorization = "Bearer " + key;
    const r = await fetch(API + path, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }

  // The cell where the player stands. Only the cell ID is kept; the coordinates are dropped right here.
  // ?cell=<h3 index> plays a given cell instead (for testing away from it).
  function findCell() {
    const forced = new URLSearchParams(location.search).get("cell");
    if (forced) return Promise.resolve(forced);
    return new Promise((ok, fail) => {
      if (!navigator.geolocation) return fail("NO LOCATION ON THIS DEVICE.");
      navigator.geolocation.getCurrentPosition(
        p => ok(h3.latLngToCell(p.coords.latitude, p.coords.longitude, RES)),
        () => fail("NO LOCATION. THE DUNGEON NEEDS TO KNOW WHERE YOU STAND."),
        { enableHighAccuracy: false, timeout: 20000, maximumAge: 600000 });
    });
  }

  const stamp = (date, moon) => { const [y, m, d] = date.split("-"); return `${MON[+m - 1]} ${d} ${y}, under a ${MOONS[moon]}`; };

  async function start(cell) {
    const day = SMT.localDay(SMT.now(), tz);
    let w = WING.generate(cell, day, ""), found = null;
    if (API) {
      try {
        const r = await api("GET", `/wing?cell=${cell}`);
        if (r.body.committed) { w = r.body.wing; found = r.body; }
      } catch (e) { msg = "The server didn't answer. Playing offline."; }
    }
    game = { cell, day, w, x: w.start.x, y: w.start.y, f: "N", moves: "", found, walked: new Set([w.start.x + "," + w.start.y]) };
    // The finder's sign, inside the dungeon.
    if (found) msg = `A sign: first walked ${stamp(found.date, found.moon)}${found.name ? ", by " + found.name : ""}.`;
    else if (!msg) msg = "No one has walked this wing. Today it looks like this.";
    draw();
  }

  const esc = t => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cells = line => esc(line)
    .replace(/[░▒▓█◆╭╮╰╯─│]/g, ch => `<span class="cell${/[░▒▓█]/.test(ch) ? " ph" : ""}"><span class="g">${ch}</span></span>`)
    .replace(/([一-鿿])/g, '<span class="kanji"><span class="g">$1</span></span>');
  const short = cell => cell.replace(/f+$/, "").slice(-4);
  const total = () => game.w.size * game.w.size;
  const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);

  function draw() {
    const g = game, v = WING.view(g.w, g.x, g.y, g.f);
    const st = {
      view: v, facing: g.f, tz, party: [{ name: "KURA", lv: 1, hp: 40, hpmax: 40, mp: 12, mpmax: 12 }],
      map: WING.minimap(g.w, g.x, g.y, g.walked), ichor: 0, silver: 0, day: 1,
      cell: short(g.cell), wing: 1, tiles: [g.walked.size, total()],
      wingState: g.found || g.mine ? "found" : "unclaimed", breathNow: 6, breathMax: 6,
    };
    let lines = SMT.renderScreen(st, msg).split("\n");
    if (popup) lines = overlay(lines, popupBox());
    out.innerHTML = lines.map(cells).join("\n");
  }

  // A box 41 wide laid over the 3D view, or 76 wide over the whole middle for the atlas.
  function box(rows, w) { return ["+" + "-".repeat(w) + "+", ...rows.map(r => "|" + pad(r, w) + "|"), "+" + "-".repeat(w) + "+"]; }
  function popupBox() {
    if (popup === "clear") return box(["", "           EVERY TILE WALKED.", "", "   This wing goes in your atlas, as it", "   stands today, for good.", "", "   [S] SIGN IT         [ENTER] STAY ANON", ""], 41);
    if (popup === "key") return box(["", newKey ? "   YOUR SAVE KEY. WRITE IT DOWN." : "   YOUR SAVE KEY.", "", "   " + getKey().slice(0, 19), "   " + getKey().slice(20), "",
      "   It is the only way back to your atlas.", "   [ENTER] OK         [N] USE ANOTHER"], 41);
    if (popup === "keyentry") return box(["", "   TYPE YOUR SAVE KEY.", "", "   " + keyDraft.slice(0, 19), "   " + keyDraft.slice(20), "",
      "", "   [ENTER] USE IT         [ESC] BACK"], 41);
    if (popup === "atlas") {
      const rows = !atlas ? ["", "  Reading the atlas..."] : atlas.error ? ["", "  " + atlas.error] : !atlas.rows.length ? ["", "  Nothing found yet."]
        : ["  DATE          MOON             CELL   WING  SIGNED", ...atlas.rows.slice(0, 11).map(r =>
          "  " + pad(r.date, 14) + pad(MOONS[r.moon], 17) + pad(short(r.cell), 7) + pad("1", 6) + (r.signed ? "yes" : "-"))];
      const head = atlas && atlas.name ? `  ATLAS of ${atlas.name}` : "  ATLAS";
      return box([head, ...rows, ...Array(Math.max(0, 13 - rows.length)).fill(""), "  [ESC] BACK"], 76);
    }
    return null;
  }
  function overlay(lines, b) {
    if (!b) return lines;
    const wide = b[0].length > 50, r0 = wide ? 6 : 8;
    b.forEach((t, i) => { const r = r0 + i; lines[r] = wide ? "|" + t + "|" : "|  " + t + "  " + lines[r].slice(48); });
    return lines;
  }

  function step() {
    const g = game;
    if (WING.blocked(g.w, g.x, g.y, g.f)) {
      const d = g.w.door;
      msg = d && d.x === g.x && d.y === g.y && d.d === g.f ? "The door is locked." : "A wall.";
      return;
    }
    const [dx, dy] = WING.DIRS[g.f];
    g.x += dx; g.y += dy; g.moves += "F";
    const fresh = !g.walked.has(g.x + "," + g.y);
    g.walked.add(g.x + "," + g.y);
    msg = "";
    if (fresh && g.walked.size === total() && !g.found && !g.mine) popup = "clear";
  }
  function turn(dir) { game.f = WING[dir][game.f]; game.moves += dir === "left" ? "L" : "R"; msg = ""; }

  async function commit(signed) {
    popup = null;
    if (!API) { msg = "Offline: nothing was sent."; return draw(); }
    newKey = !getKey();
    if (newKey) store.set("irl.key", makeKey());
    const entry_id = randId(), proof = await sha256((await sha256("proof:" + getKey())) + entry_id);
    msg = "Sending..."; draw();
    try {
      const r = await api("POST", "/commit", { cell: game.cell, day: game.day, moves: game.moves, entry_id, proof, signed });
      if (r.status === 200) {
        game.mine = true;
        msg = `Found, ${stamp(r.body.entry.date, r.body.entry.moon)}. It's in your atlas.`;
        if (newKey) popup = "key";
      } else if (r.status === 409) {
        game.found = true; msg = "Someone walked it first, moments ago.";
      } else msg = "The server refused it (" + (r.body.error || r.status) + ").";
    } catch (e) { msg = "The server didn't answer. Nothing was sent."; }
    draw();
  }

  async function openAtlas() {
    popup = "atlas"; atlas = null; draw();
    if (!API) { atlas = { error: "Offline: there is no atlas without the server." }; return draw(); }
    if (!getKey()) { atlas = { rows: [] }; return draw(); }
    try { atlas = (await api("GET", "/atlas")).body; if (!atlas.rows) atlas = { error: "Couldn't read the atlas." }; }
    catch (e) { atlas = { error: "The server didn't answer." }; }
    if (popup === "atlas") draw();
  }

  document.addEventListener("keydown", e => {
    if (!game) return;
    const k = e.key, K = k.toUpperCase();
    if (popup === "clear") {
      if (K === "S") commit(true); else if (k === "Enter") commit(false); else return;
    } else if (popup === "key") {
      if (k === "Enter" || k === "Escape") popup = null;
      else if (K === "N") { popup = "keyentry"; keyDraft = ""; } else return;
    } else if (popup === "keyentry") {
      if (k === "Escape") popup = "key";
      else if (k === "Backspace") keyDraft = keyDraft.replace(/-?.$/, "");
      else if (k === "Enter") {
        if (KEY_RE.test(keyDraft)) { store.set("irl.key", keyDraft); popup = null; msg = "Save key changed."; }
        else msg = "That isn't a whole save key.";
      } else if (/^[A-Z2-7]$/.test(K) && keyDraft.length < 39) keyDraft += (keyDraft.length % 5 === 4 ? "-" : "") + K;
      else return;
    } else if (popup === "atlas") {
      if (k === "Escape" || k === "Enter") popup = null; else return;
    } else if (k === "ArrowUp") step();
    else if (k === "ArrowLeft") turn("left");
    else if (k === "ArrowRight") turn("right");
    else if (K === "T") { openAtlas(); return e.preventDefault(); }
    else if (K === "K") { if (getKey()) { popup = "key"; newKey = false; } else { popup = "keyentry"; keyDraft = ""; } }
    else return;
    e.preventDefault(); draw();
  });

  setInterval(() => game && draw(), 30000);          // keep the clock and moon current
  findCell().then(start, err => { out.textContent = err; });
})();
