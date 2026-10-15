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
  let game = null, msg = "", popup = null;          // popup: null, "key" (the SAVE menu), "keyentry", "atlas", "ledger", "map"
  let atlas = null, ledger = null, area = null, keyDraft = "";

  // THE SAVE CODE: the player's whole identity. Made here, kept in this browser; the server only ever sees its hash.
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
      map: WING.minimap(g.w, g.x, g.y, g.walked, g.f), ichor: 0, silver: 0, day: 1,
      cell: short(g.cell), wing: 1, tiles: [g.walked.size, total()],
      wingState: g.found || g.mine ? "found" : "unclaimed", breathNow: 6, breathMax: 6,
    };
    let lines = SMT.renderScreen(st, msg).split("\n");
    if (popup) lines = overlay(lines, popupBox());
    out.innerHTML = lines.map(l => buttons(cells(l))).join("\n");
  }

  // A box 41 wide laid over the 3D view, or 76 wide over the whole middle for the atlas.
  function box(rows, w) { return ["+" + "-".repeat(w) + "+", ...rows.map(r => "|" + pad(r, w) + "|"), "+" + "-".repeat(w) + "+"]; }
  function popupBox() {
    // THE SAVE MENU. The code is always the SAVE CODE; KEY or PASSKEY only ever means the passkey.
    if (popup === "key" && getKey()) return box(["", "   YOUR SAVE CODE.", "", "   " + getKey().slice(0, 19), "   " + getKey().slice(20), "",
      "   It's the only way back to your atlas.", "", "   [P] PASSKEY       [D] DOWNLOAD .TXT", "   [N] ANOTHER CODE  [ESC] BACK"], 41);
    if (popup === "key") return box(["", "   NO SAVE CODE YET.", "", "   One is made on your first find, or:", "",
      "   [C] MAKE A SAVE CODE", "   [R] RESTORE A SAVE CODE", "   [P] PASSKEY", "   [ESC] BACK"], 41);
    if (popup === "keyentry") return box(["", "   TYPE YOUR SAVE CODE.", "", "   " + keyDraft.slice(0, 19), "   " + keyDraft.slice(20), "",
      "", "   [ENTER] USE IT         [ESC] BACK"], 41);
    if (popup === "atlas") {
      const rows = !atlas ? ["", "  Reading the atlas..."] : atlas.error ? ["", "  " + atlas.error] : !atlas.rows.length ? ["", "  Nothing found yet."]
        : ["  DATE          MOON             CELL   WING  SIGNED", ...atlas.rows.slice(0, 11).map((r, n) =>
          "  " + pad(r.date, 14) + pad(MOONS[r.moon], 17) + pad(short(r.cell), 7) + pad("1", 6) + (r.signed ? "yes" : n < 9 ? `[${n + 1}] SIGN` : "-"))];
      const head = atlas && atlas.name ? `  ATLAS of ${atlas.name}` : "  ATLAS";
      return box([head, ...rows, ...Array(Math.max(0, 13 - rows.length)).fill(""), "  [ESC] BACK"], 76);
    }
    if (popup === "map") {
      const grid = area && area.grid ? area.grid : ["", "  " + (area && area.error ? area.error : "Reading the cells around you...")];
      return box(["  THE CELLS AROUND YOU  (north is up, each about 100 m)", ...grid, ...Array(Math.max(0, 13 - grid.length)).fill(""),
        "  [@] you   [#] found   [ ] not found yet" + " ".repeat(20) + "[ESC] BACK"], 76);
    }
    if (popup === "ledger") {
      const rows = !ledger ? ["", "  Reading the ledger..."] : ledger.error ? ["", "  " + ledger.error] : !ledger.rows.length ? ["", "  Nothing found anywhere yet."]
        : ["  DATE        MOON             CELL   FOUND BY", ...ledger.rows.slice(0, 11).map(r =>
          "  " + pad(r.date, 12) + pad(MOONS[r.moon], 17) + pad(short(r.cell), 7) + r.name)];
      return box(["  THE LEDGER: the latest finds, everywhere", ...rows, ...Array(Math.max(0, 13 - rows.length)).fill(""), "  [ESC] BACK"], 76);
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
    if (fresh && g.walked.size === total() && !g.found && !g.mine) commit();   // no popup: every find goes in anonymous; sign later from the atlas
  }
  function turn(dir) { game.f = WING[dir][game.f]; game.moves += dir === "left" ? "L" : "R"; msg = ""; }

  async function commit() {
    if (!API) { msg = "Offline: nothing was sent."; return draw(); }
    if (!getKey()) store.set("irl.key", makeKey());
    const entry_id = randId(), proof = await sha256((await sha256("proof:" + getKey())) + entry_id);
    msg = "Sending..."; draw();
    try {
      const r = await api("POST", "/commit", { cell: game.cell, day: game.day, moves: game.moves, entry_id, proof });
      if (r.status === 200) {
        game.mine = true;
        // (No popup: a first save code is made quietly, and [S]AVE shows it whenever the player wants.)
        msg = `Found, ${stamp(r.body.entry.date, r.body.entry.moon)}. It's in your atlas.`;
      } else if (r.status === 409) {
        game.found = true; msg = "Someone walked it first, moments ago.";
      } else msg = "The server refused it (" + (r.body.error || r.status) + ").";
    } catch (e) { msg = "The server didn't answer. Nothing was sent."; }
    draw();
  }

  // THE MAP: the real cells around the player, three rings out, placed by their true centers (north up).
  // Found cells (someone has walked their first wing) show [#]. Only cell IDs go to the server.
  async function openMap() {
    popup = "map"; area = null; draw();
    if (typeof h3 === "undefined") { area = { error: "The map needs the cell library, which didn't load." }; return draw(); }
    const ring = h3.gridDisk(game.cell, 3), [lat0, lng0] = h3.cellToLatLng(game.cell), k = Math.cos(lat0 * Math.PI / 180);
    const pts = ring.map(c => { const [la, ln] = h3.cellToLatLng(c); return { c, x: (ln - lng0) * k, y: la - lat0 }; });
    const s = Math.min(...pts.filter(p => p.c !== game.cell).map(p => Math.hypot(p.x, p.y)));   // the spacing between neighbors
    let found = [];
    if (API) { try { found = (await api("GET", "/cells?ids=" + ring.join(","))).body.found || []; } catch (e) {} }
    const W = 74, H = 13, rows = Array.from({ length: H }, () => Array(W).fill(" "));
    for (const p of pts) {
      const col = Math.round(37 + p.x / s * 5) - 1, row = Math.round(6 - p.y / s * 2);
      const t = p.c === game.cell ? "[@]" : found.includes(p.c) ? "[#]" : "[ ]";
      if (row >= 0 && row < H) [...t].forEach((ch, i) => { if (col + i >= 0 && col + i < W) rows[row][col + i] = ch; });
    }
    area = { grid: rows.map(r => r.join("")) };
    if (popup === "map") draw();
  }

  async function openLedger() {
    popup = "ledger"; ledger = null; draw();
    if (!API) { ledger = { error: "Offline: there is no ledger without the server." }; return draw(); }
    try { ledger = (await api("GET", "/ledger")).body; if (!ledger.rows) ledger = { error: "Couldn't read the ledger." }; }
    catch (e) { ledger = { error: "The server didn't answer." }; }
    if (popup === "ledger") draw();
  }

  // PASSKEYS: the save code itself rides inside the passkey (as its user handle), so Face ID or a fingerprint
  // brings it back on any device the passkey syncs to. Nothing about it goes to the server.
  const PK_OK = !!(window.PublicKeyCredential && navigator.credentials);
  async function makePasskey() {
    if (!PK_OK) { msg = "This browser can't make passkeys."; return draw(); }
    const key = getKey();
    try {
      await navigator.credentials.create({ publicKey: {
        rp: { name: "irl-dungeon" }, challenge: crypto.getRandomValues(new Uint8Array(32)),
        user: { id: new TextEncoder().encode(key), name: "irl-dungeon " + key.slice(0, 4), displayName: "irl-dungeon save code" },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "preferred" } } });
      popup = null; msg = "Passkey made. It can bring your save code back on any device it syncs to.";
    } catch (e) { msg = "No passkey was made."; }
    draw();
  }
  async function usePasskey() {
    if (!PK_OK) { msg = "This browser can't use passkeys."; return draw(); }
    try {
      const c = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), userVerification: "preferred" } });
      const key = new TextDecoder().decode(c.response.userHandle || new ArrayBuffer(0));
      if (!KEY_RE.test(key)) { msg = "That passkey doesn't hold a save code."; return draw(); }
      store.set("irl.key", key); popup = null; msg = "Save code restored from your passkey.";
    } catch (e) { msg = "The passkey wasn't used."; }
    draw();
  }

  // The save code as a .txt file, for keeping somewhere safe.
  function downloadKey() {
    const text = "irl-dungeon save code\n\n" + getKey() + "\n\nThis code is the only way back to your atlas. Keep it private.\n" + location.origin + location.pathname + "\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "irl-dungeon-save-code.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg = "Save code downloaded."; draw();
  }

  // SIGN LATER: put the player's consistent name on one of their finds. Appended on the server, never an edit.
  async function signFind(n) {
    const r = atlas && atlas.rows && atlas.rows[n];
    if (!r || r.signed) return;
    try {
      const res = await api("POST", "/sign", { entry_id: r.entry_id });
      if (res.body.ok) { r.signed = true; msg = "Signed. The ledger shows your name on it now."; }
      else msg = "It couldn't be signed (" + (res.body.error || res.status) + ").";
    } catch (e) { msg = "The server didn't answer."; }
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

  // Every control goes through here, from the keyboard or from tapping the button on screen.
  // Returns false when the key does nothing right now.
  function press(k) {
    if (!game) return false;
    const K = k.toUpperCase();
    if (popup === "key") {
      if (k === "Enter" || k === "Escape") popup = null;
      else if ((K === "N" && getKey()) || (K === "R" && !getKey())) { popup = "keyentry"; keyDraft = ""; }
      else if (K === "C" && !getKey()) { store.set("irl.key", makeKey()); msg = "Save code made."; }
      else if (K === "D") { downloadKey(); return true; }
      else if (K === "P" || k === "Passkey") { if (getKey()) makePasskey(); else usePasskey(); return true; } else return false;
    } else if (popup === "keyentry") {
      if (k === "Escape") popup = "key";
      else if (k === "Backspace") keyDraft = keyDraft.replace(/-?.$/, "");
      else if (k === "Enter") {
        if (KEY_RE.test(keyDraft)) { store.set("irl.key", keyDraft); popup = null; msg = "Save code changed."; }
        else msg = "That isn't a whole save code.";
      } else if (/^[A-Z2-7]$/.test(K) && keyDraft.length < 39) keyDraft += (keyDraft.length % 5 === 4 ? "-" : "") + K;
      else return false;
    } else if (popup === "atlas" && /^[1-9]$/.test(k)) { signFind(+k - 1); return true;
    } else if (popup === "atlas" || popup === "ledger" || popup === "map") {
      if (k === "Escape" || k === "Enter") popup = null; else return false;
    } else if (k === "ArrowUp") step();
    else if (k === "ArrowLeft") turn("left");
    else if (k === "ArrowRight") turn("right");
    else if (K === "T") { openAtlas(); return true; }
    else if (K === "L") { openLedger(); return true; }
    else if (K === "M") { openMap(); return true; }
    else if (K === "S") popup = "key";
    else return false;
    draw(); return true;
  }
  document.addEventListener("keydown", e => { if (press(e.key)) e.preventDefault(); });

  // TAPPABLE BUTTONS: each bracketed control on screen is wrapped in a span that presses its key.
  const BUTTONS = [["[  ^  ]", "ArrowUp"], ["[ < ]", "ArrowLeft"], ["[ > ]", "ArrowRight"], ["A[T]LAS", "t"], ["[C] MAKE A SAVE CODE", "c"], ["[R] RESTORE A SAVE CODE", "r"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`[${n}] SIGN`, String(n)]), ["[S]AVE", "s"], ["[D] DOWNLOAD .TXT", "d"], ["[N] ANOTHER CODE", "n"],
    ["[S] SIGN IT", "s"], ["[ENTER] STAY ANON", "Enter"], ["[ENTER] OK", "Enter"], ["[P] PASSKEY", "Passkey"], ["[L]EDGER", "l"], ["[M]AP", "m"],
    ["[ENTER] USE IT", "Enter"], ["[ESC] BACK", "Escape"]];
  const buttons = html => BUTTONS.reduce((h, [label, key]) => h.split(esc(label)).join(`<span class="btn" data-k="${key}">${esc(label)}</span>`), html);
  out.addEventListener("click", e => { const b = e.target.closest(".btn"); if (b) press(b.dataset.k); });

  document.getElementById("ver").textContent = SMT.VERSION;
  setInterval(() => game && draw(), 30000);          // keep the clock and moon current
  findCell().then(start, err => { out.textContent = err; });
})();
