// The SAVE screen: your name, your saved cells and (for the admin) test mode. It looks like 4Dungeon's overlays (a panel
// of screen text laid over the frame, with bracketed buttons). The server side is src/worker.js. Save codes, passkeys,
// logging in and the copy you carry are in the footer's ≡ window (/api/carry), not here.

export async function api(path, body) {
  const res = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try { return await res.json(); } catch { return { error: "The server didn't answer properly. Try again." }; }
}

// Draws the panel into `root` (a div over the frame). `onClose()` is called when the player closes it. `cell()` is the cell you're in (for SAVE THIS CELL); `onGo(cell)`
// takes you to a saved one.
export function openSave(root, { onClose = () => {}, fetchApi = api, cell = () => null, onGo = () => {}, onTest = () => {} } = {}) {
  let msg = "", last = null, rerollArmed = false;
  const pre = root.querySelector("pre");
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const line = (text = "", cls) => { const d = el("div", cls, text || " "); pre.appendChild(d); return d; };
  const button = (label, fn, cls = "") => { const b = el("span", "btn " + cls, `[${label}]`); b.setAttribute("role", "button"); b.tabIndex = 0; b.onclick = fn; b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } }; return b; };
  const row = (...parts) => { const d = el("div"); for (const p of parts) d.append(typeof p === "string" ? document.createTextNode(p) : p); pre.appendChild(d); return d; };

  // Text is laid out for 45 columns: this panel sits inside the 3D view (47 columns, 17 rows) and scrolls. The title
  // row stays at the top and the message row stays at the foot, as in 4Dungeon's bag.
  // The panel opens at once with what it showed last (or "Loading..."), and fills in when the server answers.
  async function draw() {
    paint(last);
    const a = await fetchApi("account");
    if (root.hidden) return;                                     // closed while waiting
    last = a; paint(a);
  }
  function paint(a) {
    const top = root.scrollTop;
    pre.textContent = "";
    root.hidden = false;
    // The head (title, rule, and the message when there is one) stays at the top; nothing is pinned at the foot.
    const head = el("div", "top"); pre.appendChild(head);
    const t = el("div"); t.append(" SAVE", " ".repeat(26), button("CLOSE", close)); head.appendChild(t);
    head.appendChild(el("div", null, " " + "-".repeat(43)));
    const m = el("div", "msg gold", msg ? " " + msg : ""); m.hidden = !msg; head.appendChild(m);
    if (!a) { line(" Loading...", "dim"); return; }
    if (a.error) { line(" " + a.error); return; }
    if (a.admin) {
      line(" ADMIN", "gold");
      row(`   TEST MODE: ${a.test ? "ON " : "OFF"}  `, button(a.test ? "TURN OFF" : "TURN ON", () => setTest(!a.test)));
      line(a.test ? "   No key or travel limits. Nothing counts." : "   A sandbox where nothing you do counts.", "dim");
      line();
    }
    line(" NAME");
    if (a.name) { row("   " + a.name + "  ", button(rerollArmed ? "YES, REROLL" : "REROLL", reroll), ...(rerollArmed ? ["  ", button("KEEP IT", () => { rerollArmed = false; msg = ""; paint(last); })] : [])); line("   Shown on finds you sign, with their cell.", "dim"); }
    else line("   None yet. Sign a find to get one.", "dim");
    line();
    const here = cell();
    line(` SAVED CELLS (${a.cells.length}/20)`);
    for (const c of a.cells) row(`   ${c.cell}${c.cell === here ? " *" : "  "} `, button("GO", () => { close(); onGo(c.cell); }), " ", button("FORGET", () => forgetCell(c.cell)));
    if (!a.cells.length) line("   None yet.", "dim");
    if (here && !a.cells.some((c) => c.cell === here)) row("   ", button("SAVE THIS CELL", () => saveCell(here)));
    line();
    root.scrollTop = top;
  }

  // Messages show under the title, at the top with it, so they never cover the list.
  const say = (t) => { msg = t; const m = pre.querySelector(".msg"); if (m) { m.textContent = t ? " " + t : ""; m.hidden = !t; } };
  const close = () => { root.hidden = true; pre.textContent = ""; onClose(); };

  // A reroll asks first: the old name can't be picked again (names are random), so a stray tap shouldn't lose it.
  async function reroll() {
    if (!rerollArmed) { rerollArmed = true; msg = "A new name? This one can't come back."; return paint(last); }
    rerollArmed = false;
    const r = await fetchApi("name", { action: "reroll" }); if (r.error) return say(r.error); msg = "Your name is now " + r.name + "."; draw();
  }
  async function setTest(on) { const r = await fetchApi("admin", { action: "test", on, cell: cell() }); if (r.error) return say(r.error); msg = on ? "Test mode is on." : "Test mode is off. Back where you started."; draw(); onTest(on, r.back || null); }
  async function saveCell(c) { const r = await fetchApi("cells", { action: "save", cell: c }); if (r.error) return say(r.error); msg = "Saved."; draw(); }
  async function forgetCell(c) { const r = await fetchApi("cells", { action: "forget", cell: c }); if (r.error) return say(r.error); msg = "Forgotten."; draw(); }
  draw();
  return { close, redraw: draw };
}
