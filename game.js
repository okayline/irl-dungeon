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
  let game = null, msg = "", popup = null;          // popup: null, "key" (the SAVE menu), "newcode", "keyentry", "atlas", "ledger", "map"
  let atlas = null, ledger = null, area = null, acct = null, keyDraft = "", newCode = "", busy = false;

  // THE PLAYER: this device's token (sent as Authorization: Bearer). The server makes a player on the first find,
  // save code or passkey and hands back a token; a save code or a passkey logs another device into the same
  // player. Save codes and passkeys are two separate ways in, the same as scoundrel.exe and the 88x31 cLuB.
  const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
    del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
  const getToken = () => store.get("irl.token");
  const keepToken = t => { if (t) store.set("irl.token", t); };
  const randId = () => [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, "0")).join("");

  async function api(method, path, body) {
    const token = getToken(), headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    const r = await fetch(API + path, { method, headers, body: body && JSON.stringify(body) });
    const b = await r.json().catch(() => ({}));
    if (b && b.token && !token) keepToken(b.token);   // a player was just made for this device
    return { status: r.status, body: b };
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
    if (popup === "key") {
      const head = !acct ? "   Reading..." : `   SAVE CODES  ${acct.codes.length}      PASSKEYS  ${acct.passkeys.length}`;
      return box(["", head, "", "   [1] NEW SAVE CODE", "   [2] ADD A PASSKEY", "   [3] LOG IN WITH A SAVE CODE",
        "   [4] LOG IN WITH A PASSKEY", "", "   [O] LOG OUT           [ESC] BACK"], 41);
    }
    if (popup === "newcode") return box(["", "   YOUR NEW SAVE CODE:", "", "   " + newCode, "",
      "   Shown once. Keep it somewhere safe.", "", "   [D] DOWNLOAD .TXT     [ESC] DONE"], 41);
    if (popup === "keyentry") return box(["", "   TYPE YOUR SAVE CODE.", "", "   " + keyDraft, "",
      "   Dashes and spaces don't matter.", "", "   [ENTER] LOG IN        [ESC] BACK"], 41);
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
    const entry_id = randId();
    msg = "Sending..."; draw();
    try {
      const r = await api("POST", "/commit", { cell: game.cell, day: game.day, moves: game.moves, entry_id });
      if (r.status === 200) {
        game.mine = true;
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

  // ---------- save codes and passkeys (ported from scoundrel.exe's client) ----------
  async function openSave() {
    popup = "key"; acct = null; draw();
    if (!API) { msg = "Offline: save codes and passkeys need the server."; popup = null; return draw(); }
    try { acct = (await api("GET", "/account")).body; } catch (e) { msg = "The server didn't answer."; }
    if (popup === "key") draw();
  }
  async function makeCode() {
    if (busy) return; busy = true;
    try {
      const r = await api("POST", "/codes", { action: "new" });
      if (r.body.code) { newCode = r.body.code; popup = "newcode"; msg = "Save code made."; } else msg = r.body.error || "No save code was made.";
    } catch (e) { msg = "The server didn't answer."; }
    busy = false; draw();
  }
  async function loadWithCode() {
    if (busy) return; busy = true;
    try {
      const r = await fetch(API + "/load", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: keyDraft }) });
      const b = await r.json().catch(() => ({}));
      if (b.token) { store.set("irl.token", b.token); popup = null; msg = "Logged in. Your atlas is here now."; }
      else msg = b.error || "That save code didn't work.";
    } catch (e) { msg = "The server didn't answer."; }
    busy = false; draw();
  }
  async function logOut() {
    try {
      const r = await api("POST", "/logout", {});
      if (r.body.ok) { store.del("irl.token"); popup = null; msg = "Logged out. Log back in any time with a save code or passkey."; }
      else msg = r.body.error || "Couldn't log out.";
    } catch (e) { msg = "The server didn't answer."; }
    draw();
  }

  // The browser speaks WebAuthn in ArrayBuffers; the server speaks base64url. (From the 88x31 cLuB.)
  const pkSupported = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  const fromB64 = s => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), c => c.charCodeAt(0)).buffer; };
  const toB64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const deviceName = () => {
    const u = navigator.userAgent;
    return /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows PC" : /Linux/.test(u) ? "Linux" : "this device";
  };
  const pkOops = e => (e && e.name === "NotAllowedError" ? "Passkey cancelled (or it timed out)." : e && e.name === "InvalidStateError" ? "This device already has a passkey for you." : (e && e.message) || "The passkey didn't work.");
  async function addPasskey() {
    if (busy) return;
    if (!pkSupported()) { msg = "This browser can't do passkeys. A save code works everywhere."; return draw(); }
    busy = true; msg = "Waiting for your fingerprint, face or PIN..."; draw();
    try {
      const o = (await api("POST", "/passkey", { action: "register_options" })).body;
      if (!o.challenge) throw new Error(o.error || "The passkey didn't work.");
      const cred = await navigator.credentials.create({ publicKey: {
        ...o, token: undefined, challenge: fromB64(o.challenge), user: { ...o.user, id: fromB64(o.user.id) },
        excludeCredentials: o.excludeCredentials.map(c => ({ ...c, id: fromB64(c.id) })) } });
      const r = await api("POST", "/passkey", { action: "register", label: deviceName(), credential: {
        id: cred.id, response: { clientDataJSON: toB64(cred.response.clientDataJSON), attestationObject: toB64(cred.response.attestationObject) } } });
      if (!r.body.ok) throw new Error(r.body.error);
      msg = "Passkey saved. On another device: [S]AVE, [4] LOG IN WITH A PASSKEY.";
      acct = (await api("GET", "/account")).body;
    } catch (e) { msg = pkOops(e); }
    busy = false; draw();
  }
  async function loadWithPasskey() {
    if (busy) return;
    if (!pkSupported()) { msg = "This browser can't do passkeys. Use a save code."; return draw(); }
    busy = true; msg = "Waiting for your passkey..."; draw();
    try {
      const post = async b => (await (await fetch(API + "/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })).json());
      const o = await post({ action: "login_options" });
      if (!o.challenge) throw new Error(o.error || "The passkey didn't work.");
      const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: fromB64(o.challenge) } });
      const d = await post({ action: "login", credential: { id: cred.id, response: { clientDataJSON: toB64(cred.response.clientDataJSON),
        authenticatorData: toB64(cred.response.authenticatorData), signature: toB64(cred.response.signature) } } });
      if (!d.token) throw new Error(d.error);
      store.set("irl.token", d.token); popup = null; msg = "Logged in with your passkey. Your atlas is here now.";
    } catch (e) { msg = pkOops(e); }
    busy = false; draw();
  }

  // The new save code as a .txt file, for keeping somewhere safe.
  function downloadCode() {
    const text = ["irl-dungeon save code", "", "  " + newCode, "",
      "This code logs you in as your player on any browser or device.",
      "On that one: open " + location.origin + location.pathname + ", press [S]AVE, then [3] LOG IN WITH A SAVE CODE.",
      "Keep it private: anyone with this code can log in as you.", "Made " + new Date().toISOString().slice(0, 10) + ".", ""].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = "irl-dungeon-save-code.txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    msg = "Save code downloaded as a .txt file."; draw();
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
    if (!getToken()) { atlas = { rows: [] }; return draw(); }
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
      else if (k === "1") { makeCode(); return true; }
      else if (k === "2") { addPasskey(); return true; }
      else if (k === "3") { popup = "keyentry"; keyDraft = ""; }
      else if (k === "4") { loadWithPasskey(); return true; }
      else if (K === "O") { logOut(); return true; } else return false;
    } else if (popup === "newcode") {
      if (k === "Escape" || k === "Enter") { popup = "key"; newCode = ""; openSave(); return true; }
      else if (K === "D") { downloadCode(); return true; } else return false;
    } else if (popup === "keyentry") {
      if (k === "Escape") popup = "key";
      else if (k === "Backspace") keyDraft = keyDraft.replace(/-?.$/, "");
      else if (k === "Enter") { loadWithCode(); return true; }
      else if (/^[0-9A-Z]$/.test(K) && keyDraft.length < 24) keyDraft += (keyDraft.length % 5 === 4 ? "-" : "") + K;
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
    else if (K === "S") { openSave(); return true; }
    else return false;
    draw(); return true;
  }
  document.addEventListener("keydown", e => { if (press(e.key)) e.preventDefault(); });

  // TAPPABLE BUTTONS: each bracketed control on screen is wrapped in a span that presses its key.
  const BUTTONS = [["[  ^  ]", "ArrowUp"], ["[ < ]", "ArrowLeft"], ["[ > ]", "ArrowRight"], ["A[T]LAS", "t"], ["[1] NEW SAVE CODE", "1"], ["[2] ADD A PASSKEY", "2"], ["[3] LOG IN WITH A SAVE CODE", "3"], ["[4] LOG IN WITH A PASSKEY", "4"], ["[O] LOG OUT", "o"], ["[ESC] DONE", "Escape"], ["[ENTER] LOG IN", "Enter"], ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => [`[${n}] SIGN`, String(n)]), ["[S]AVE", "s"], ["[D] DOWNLOAD .TXT", "d"],
    ["[L]EDGER", "l"], ["[M]AP", "m"], ["[ESC] BACK", "Escape"]];
  const buttons = html => BUTTONS.reduce((h, [label, key]) => h.split(esc(label)).join(`<span class="btn" data-k="${key}">${esc(label)}</span>`), html);
  out.addEventListener("click", e => { const b = e.target.closest(".btn"); if (b) press(b.dataset.k); });

  document.getElementById("ver").textContent = SMT.VERSION;
  setInterval(() => game && draw(), 30000);          // keep the clock and moon current
  findCell().then(start, err => { out.textContent = err; });
})();
