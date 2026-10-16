// The SAVE screen: save codes and passkeys. It looks like 4Dungeon's overlays (a panel of screen text laid over the
// frame, with bracketed buttons); the logic is Dawn Baton's account screen. The server side is src/worker.js.
// A save code is shown once and only its fingerprint is kept; a passkey keeps only its public half.

export const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64 = (t) => { t = t.replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "===".slice((t.length + 3) % 4)), (c) => c.charCodeAt(0)); };
export const passkeysOk = () => !!(typeof window !== "undefined" && window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
const monthDay = (s) => new Date(s * 1000).toLocaleDateString([], { month: "short", day: "numeric" });

export async function api(path, body) {
  const res = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  try { return await res.json(); } catch { return { error: "The server didn't answer properly. Try again." }; }
}

const deviceLabel = () => { const ua = navigator.userAgent; return /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows PC" : "This device"; };

// Draws the panel into `root` (a div over the frame). `onChange()` is called after a login or logout, so the page can
// refresh; `onClose()` when the player closes it. `cell()` is the cell you're in (for SAVE THIS CELL); `onGo(cell)`
// takes you to a saved one.
export function openSave(root, { onChange = () => {}, onClose = () => {}, fetchApi = api, cell = () => null, onGo = () => {}, onTest = () => {} } = {}) {
  let newCode = null, msg = "", last = null, copied = false, rerollArmed = false;
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
    if (newCode) {
      line(" YOUR NEW SAVE CODE (shown once)", "gold");
      line("   " + newCode, "gold code");
      line(" Write it down. It can't be shown again.");
      row("   ", button(copied ? "COPIED" : "COPY", copyCode), "  ", button("DOWNLOAD AS A TEXT FILE", download));
      row("   ", button("DONE", () => { newCode = null; copied = false; msg = ""; paint(last); }));
      line();
    }
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
    line(` SAVE CODES (${a.codes.length}/5)`);
    for (const c of a.codes) row(`   made ${monthDay(c.created_at)}${c.last_used_at ? ", used " + monthDay(c.last_used_at) : ""}  `, button("FORGET", () => forget("codes", c.id)));
    if (!a.codes.length) line("   None yet.", "dim");
    row("   ", button("MAKE A SAVE CODE", makeCode));
    line();
    line(` PASSKEYS (${a.passkeys.length})`);
    for (const k of a.passkeys) row(`   ${(k.label || "passkey").slice(0, 14)}, ${monthDay(k.created_at)}  `, button("FORGET", () => forget("passkey", k.id)));
    if (!a.passkeys.length) line("   None yet.", "dim");
    if (passkeysOk()) row("   ", button("ADD A PASSKEY", addPasskey));
    else line("   This browser can't do passkeys.", "dim");
    line();
    line(" LOG IN ON THIS DEVICE");
    const input = el("input", "codebox"); input.placeholder = "K7QM-2XPA-9RTD-HV4C-8NBE"; input.autocomplete = "off"; input.spellcheck = false; input.maxLength = 40;
    input.onkeydown = (e) => { if (e.key === "Enter") useCode(input.value); e.stopPropagation(); };
    row("   ", input);
    row("   ", button("USE CODE", () => useCode(input.value)));
    if (passkeysOk()) row("   ", button("LOG IN WITH A PASSKEY", loginPasskey));
    line();
    if (a.codes.length || a.passkeys.length) row(" ", button("LOG OUT OF THIS BROWSER", logout));
    line();
    line(a.player ? ` Saved on ${a.devices} device${a.devices === 1 ? "" : "s"}.` : " No player yet. A code or passkey makes one.", "dim");
    root.scrollTop = top;
  }

  // Messages show under the title, at the top with it, so they never cover the list.
  const say = (t) => { msg = t; const m = pre.querySelector(".msg"); if (m) { m.textContent = t ? " " + t : ""; m.hidden = !t; } };
  const close = () => { root.hidden = true; pre.textContent = ""; onClose(); };
  async function after(r, ok) { if (r.error) return say(r.error); if (ok) msg = ok; draw(); onChange(); }

  async function copyCode() {
    try { await navigator.clipboard.writeText(newCode); copied = true; paint(last); say("Copied. Keep it somewhere safe."); }
    catch { const c = pre.querySelector(".code"); if (c) { const r = document.createRange(); r.selectNodeContents(c); const s = getSelection(); s.removeAllRanges(); s.addRange(r); } say("Couldn't copy. The code is selected: copy it by hand."); }
  }
  // A reroll asks first: the old name can't be picked again (names are random), so a stray tap shouldn't lose it.
  async function reroll() {
    if (!rerollArmed) { rerollArmed = true; msg = "A new name? This one can't come back."; return paint(last); }
    rerollArmed = false;
    const r = await fetchApi("name", { action: "reroll" }); if (r.error) return say(r.error); msg = "Your name is now " + r.name + "."; draw();
  }
  async function setTest(on) { const r = await fetchApi("admin", { action: "test", on }); if (r.error) return say(r.error); msg = on ? "Test mode is on." : "Test mode is off. Back to your real game."; draw(); onTest(on); }
  async function saveCell(c) { const r = await fetchApi("cells", { action: "save", cell: c }); if (r.error) return say(r.error); msg = "Saved."; draw(); }
  async function forgetCell(c) { const r = await fetchApi("cells", { action: "forget", cell: c }); if (r.error) return say(r.error); msg = "Forgotten."; draw(); }
  async function makeCode() { const r = await fetchApi("codes", { action: "new" }); if (r.error) return say(r.error); newCode = r.code; msg = ""; draw(); onChange(); }
  async function forget(path, id) { const r = await fetchApi(path, { action: "remove", id }); if (r.error) return say(r.error); msg = "Forgotten."; draw(); }
  async function useCode(code) { if (!code.trim()) return say("Type your save code first."); after(await fetchApi("load", { code }), "Logged in."); }
  async function logout() { after(await fetchApi("logout", {}), "Logged out."); }
  function download() {
    const text = `irl-dungeon save code\n\n${newCode}\n\nGo to ${location.origin}, press SAVE, and type this code under "Log in on this device" to be your player on any browser.\nKeep this file private: anyone with the code can log in as you.\n`;
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "irl-dungeon-save-code.txt";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  async function addPasskey() {
    try {
      say("Waiting for your fingerprint, face or PIN...");
      const o = await fetchApi("passkey", { action: "register_options" }); if (o.error) return say(o.error);
      const cred = await navigator.credentials.create({ publicKey: { ...o, challenge: unb64(o.challenge), user: { ...o.user, id: unb64(o.user.id) }, excludeCredentials: o.excludeCredentials.map((c) => ({ ...c, id: unb64(c.id) })) } });
      const r = await fetchApi("passkey", { action: "register", label: deviceLabel(), credential: { id: cred.id, response: { clientDataJSON: b64(cred.response.clientDataJSON), attestationObject: b64(cred.response.attestationObject) } } });
      after(r, "Passkey added.");
    } catch (e) { say(e && e.name === "NotAllowedError" ? "Passkey cancelled (or it timed out)." : (e && e.message) || "The passkey didn't work."); }
  }
  async function loginPasskey() {
    try {
      say("Waiting for your passkey...");
      const o = await fetchApi("passkey", { action: "login_options" }); if (o.error) return say(o.error);
      const cred = await navigator.credentials.get({ publicKey: { ...o, challenge: unb64(o.challenge) } });
      const r = await fetchApi("passkey", { action: "login", credential: { id: cred.id, response: { clientDataJSON: b64(cred.response.clientDataJSON), authenticatorData: b64(cred.response.authenticatorData), signature: b64(cred.response.signature) } } });
      after(r, "Logged in.");
    } catch (e) { say(e && e.name === "NotAllowedError" ? "Passkey cancelled (or it timed out)." : (e && e.message) || "The passkey didn't work."); }
  }

  draw();
  return { close, redraw: draw };
}
