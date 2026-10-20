// The INVOKE screen: what you have found. invokeLines() is the text (plain, tested); openInvoke() puts it in a panel
// over the 3D view. Nothing can be used yet, so it is only a list. A numbered find's #copy links to that copy's page on
// the shared registry's public ledger (its whole history), the same page 4Dungeon's HISTORY opens with [L]EDGER.
export const LEDGER_URL = "https://88x31.app/registry";   // the shared registry's public ledger page (88x31.app passes it through)
export const copyUrl = (f) => (f.copy && f.item_id ? `${LEDGER_URL}?item=${f.item_id}&copy=${f.copy}` : null);
export function invokeLines(finds) {
  if (!finds.length) return ["Nothing yet.", "Press into a wall to search it."];
  return finds.map((f) => `${f.item.name}   ${f.item.rarity.toUpperCase()}${f.item.type ? " " + f.item.type.toUpperCase() : ""}${f.copy ? "  #" + f.copy : ""}`);
}
export function openInvoke(root, { fetchApi, onClose = () => {} }) {
  const pre = root.querySelector("pre");
  const add = (text, cls) => { const d = document.createElement("div"); if (cls) d.className = cls; d.textContent = text || " "; pre.appendChild(d); return d; };
  const close = () => { root.hidden = true; pre.textContent = ""; onClose(); };
  pre.textContent = ""; add("INVOKE", "gold"); add("Loading..."); root.hidden = false;
  fetchApi("finds").then((r) => {
    if (root.hidden) return;
    pre.textContent = ""; add("INVOKE", "gold"); add("");
    if (r.error) add(r.error);
    else if (!r.finds.length) for (const l of invokeLines(r.finds)) add(l);
    else for (const f of r.finds) {
      const line = invokeLines([f])[0], url = copyUrl(f), tag = "  #" + f.copy;
      if (!url || !line.endsWith(tag)) { add(line); continue; }
      const d = add(line.slice(0, -tag.length) + "  "), a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener"; a.className = "btn"; a.textContent = "#" + f.copy; a.title = "This copy's history on the ledger";
      d.appendChild(a);
    }
    add(""); const b = document.createElement("div"), btn = document.createElement("span");
    btn.className = "btn"; btn.textContent = "[CLOSE]"; btn.setAttribute("role", "button"); btn.tabIndex = 0; btn.onclick = close; b.appendChild(btn); pre.appendChild(b); btn.focus();
  }).catch(() => { pre.textContent = ""; add("INVOKE", "gold"); add("Couldn't reach the server."); });
  root.onclick = (e) => { if (e.target === root) close(); };
  return { close };
}
