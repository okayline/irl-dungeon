// The INVOKE screen: what you have found. invokeLines() is the text (plain, tested); openInvoke() puts it in a panel
// over the 3D view. Nothing can be used yet, so it is only a list.
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
    if (r.error) add(r.error); else for (const l of invokeLines(r.finds)) add(l);
    add(""); const b = document.createElement("div"), btn = document.createElement("span");
    btn.className = "btn"; btn.textContent = "[CLOSE]"; btn.setAttribute("role", "button"); btn.tabIndex = 0; btn.onclick = close; b.appendChild(btn); pre.appendChild(b); btn.focus();
  }).catch(() => { pre.textContent = ""; add("INVOKE", "gold"); add("Couldn't reach the server."); });
  root.onclick = (e) => { if (e.target === root) close(); };
  return { close };
}
