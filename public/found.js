// The "You found X!" window. foundLines() is the text (plain, tested); openFound() puts it in a panel over the 3D view.
export function foundLines(p) {
  const lines = [`You found ${p.name}!`, ""];
  lines.push(p.rarity.toUpperCase() + (p.type ? " " + p.type.toUpperCase() : "") + (p.copy ? `   COPY #${p.copy}` : ""));
  if (p.note) lines.push("", p.note);
  return lines;
}
// `root` is the panel div; `onClose` runs when it is dismissed (button, Enter, Escape or a click).
export function openFound(root, p, onClose = () => {}) {
  const pre = root.querySelector("pre");
  pre.textContent = "";
  const add = (text, cls) => { const d = document.createElement("div"); if (cls) d.className = cls; d.textContent = text || " "; pre.appendChild(d); return d; };
  const [title, , meta, ...rest] = foundLines(p);
  add(title, "gold");
  if (p.image) { const d = document.createElement("div"); const img = document.createElement("img"); img.src = p.image; img.alt = p.name; img.className = "foundpic"; d.appendChild(img); pre.appendChild(d); }
  add(meta, "dim");
  for (const l of rest) add(l);
  add("");
  const b = document.createElement("div"); const btn = document.createElement("span");
  btn.className = "btn"; btn.textContent = "[OK]"; btn.setAttribute("role", "button"); btn.tabIndex = 0; b.appendChild(btn); pre.appendChild(b);
  const close = () => { root.hidden = true; pre.textContent = ""; onClose(); };
  btn.onclick = close; root.onclick = (e) => { if (e.target === root) close(); };
  root.hidden = false; btn.focus();
  return { close };
}
