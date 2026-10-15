// THE WING GENERATOR. A wing is a pure function of its seed: the cell, the cell's local calendar day, and the
// path of doors taken to reach it ("" for a cell's first wing). Nothing is stored until a wing is committed,
// so unvisited ground costs nothing. Shared by the web page and node (for testing).
(function (root) {
  const SIZE = 5;                                   // a wing is SIZE x SIZE tiles
  const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
  const ORDER = ["N", "E", "S", "W"];
  const OPP = { N: "S", S: "N", E: "W", W: "E" };

  // A string to a 32-bit seed (xmur3), then a seeded random stream (mulberry32).
  function seedOf(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function stream(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Build the wing, the way daily-dungeon builds one (floor.js): a few SPACES joined by open doors, one step each.
  //   K  the room you come in to,
  //   P  a passage (no brackets on the map),
  //   X  a dead end,
  //   and sometimes a second room, R.
  // Laid out as a chain (K-P-X) or a star (P and X both off K), on a small grid. On a cell's first wing, one wall of
  // the room or the passage holds the locked door. Clearing a wing means stepping into every space.
  function generate(cell, day, path) {
    path = path || "";
    const rand = stream(seedOf(`${cell}|${day}|${path}`));
    const R = n => Math.floor(rand() * n);
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = R(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    for (let tries = 0; ; tries++) {
      const walls = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({ N: true, E: true, S: true, W: true })));
      const kinds = {}, spaces = [];
      const start = { x: 2, y: 2 };
      const put = (p, kind) => { kinds[p.x + "," + p.y] = kind; spaces.push({ x: p.x, y: p.y }); };
      const free = p => p.x >= 0 && p.y >= 0 && p.x < SIZE && p.y < SIZE && !((p.x + "," + p.y) in kinds);
      // A free space next to `from`, joined to it by an open door.
      const grow = (from, kind) => {
        for (const d of shuffle(ORDER.slice())) {
          const [dx, dy] = DIRS[d], p = { x: from.x + dx, y: from.y + dy };
          if (!free(p)) continue;
          walls[from.y][from.x][d] = false; walls[p.y][p.x][OPP[d]] = false;
          put(p, kind); return p;
        }
        return null;
      };
      put(start, "room");
      const P = grow(start, "hall");
      const X = P && grow(rand() < 0.5 ? P : start, "dead");          // chain: off the passage; star: off the room
      const R2 = X && rand() < 0.5 ? grow(rand() < 0.5 ? P : start, "room") : true;   // sometimes a second room
      if (!P || !X || !R2) { if (tries < 50) continue; }
      // The locked door (first wing only): a wall of the room or the passage with nothing built behind it.
      let door = null;
      if (path === "") {
        const spots = [];
        for (const sp of [start, P]) if (sp) for (const d of ORDER) {
          const [dx, dy] = DIRS[d], q = { x: sp.x + dx, y: sp.y + dy };
          if (walls[sp.y][sp.x][d] && free(q)) spots.push({ x: sp.x, y: sp.y, d });
        }
        door = spots.length ? spots[R(spots.length)] : null;
      }
      return { cell, day, path, size: SIZE, walls, start, door, spaces, kinds };
    }
  }

  const isDoor = (w, x, y, d) => !!(w.door && w.door.x === x && w.door.y === y && w.door.d === d);
  const blocked = (w, x, y, d) => w.walls[y][x][d];
  const left = { N: "W", E: "N", S: "E", W: "S" }, right = { N: "E", E: "S", S: "W", W: "N" };

  // What KURA sees, in daily-dungeon's terms: the walls of the space she stands in (left and right), and what is
  // ahead: a plain wall, an open door into the next space, or the locked door.
  function view(w, x, y, f) {
    const L = [blocked(w, x, y, left[f]), true], Rt = [blocked(w, x, y, right[f]), true];
    let end = "wall", lock = "";
    if (!blocked(w, x, y, f)) end = "door";
    else if (isDoor(w, x, y, f)) { end = "door"; lock = "+"; }
    return { left: L, right: Rt, end, lock };
  }

  // The panel minimap, drawn the way daily-dungeon draws its floor: each walked tile is a room [ ] outlined in
  // + - | walls (neighbors share a wall), opened wherever the way is open. Only walked tiles are drawn, the map is
  // a window centered on KURA (5 rows, 29 columns), and it moves around her. The locked door shows #, and KURA's
  // facing is an arrow in the gap on that side of her room.
  function minimap(w, px, py, walked, facing) {
    const W = 29, H = 5, rows = Array.from({ length: H }, () => Array(W).fill(" "));
    const put = (r, c, s) => [...s].forEach((ch, k) => { if (r >= 0 && r < H && c + k >= 0 && c + k < W) rows[r][c + k] = ch; });
    const seen = [];
    for (let y = 0; y < w.size; y++) for (let x = 0; x < w.size; x++)
      if (walked.has(x + "," + y)) seen.push({ x, y, row: 2 + (y - py) * 2, col: 13 + (x - px) * 4 });
    const wall = Array.from({ length: H }, () => Array(W).fill(false)), vert = Array.from({ length: H }, () => Array(W).fill(false));
    const mark = (r, c, v) => { if (r >= 0 && r < H && c >= 0 && c < W) wall[r][c] = v; };
    for (const { row, col } of seen)
      for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 3; c++) if (r !== row || c === col - 1 || c === col + 3) {
        mark(r, c, true);
        if ((c === col - 1 || c === col + 3) && r >= 0 && r < H && c >= 0 && c < W) vert[r][c] = true;   // a side wall keeps going past the edge of the window
      }
    const open = (row, col, d) => {
      if (d === "E") mark(row, col + 3, false); if (d === "W") mark(row, col - 1, false);
      if (d === "S") for (let k = 0; k < 3; k++) mark(row + 1, col + k, false);
      if (d === "N") for (let k = 0; k < 3; k++) mark(row - 1, col + k, false);
    };
    const isDoor = (x, y, d) => !!(w.door && w.door.x === x && w.door.y === y && w.door.d === d);
    for (const { x, y, row, col } of seen) for (const d of ORDER) if (!w.walls[y][x][d] || isDoor(x, y, d)) open(row, col, d);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (wall[r][c]) {
      const n = r > 0 ? wall[r - 1][c] : vert[r][c], s = r < H - 1 ? wall[r + 1][c] : vert[r][c], wl = c > 0 && wall[r][c - 1], e = c < W - 1 && wall[r][c + 1];
      rows[r][c] = (n || s) && (wl || e) ? "+" : n || s ? "|" : "-";
    }
    for (const { x, y, row, col } of seen) {
      const me = x === px && y === py ? "@" : " ", hall = w.kinds && w.kinds[x + "," + y] === "hall";
      put(row, col, hall ? " " + me + " " : "[" + me + "]");   // a passage has no brackets (as in daily-dungeon)
      for (const d of ORDER) if (isDoor(x, y, d)) {
        if (d === "E") put(row, col + 3, "#"); if (d === "W") put(row, col - 1, "#");
        if (d === "S") put(row + 1, col + 1, "#"); if (d === "N") put(row - 1, col + 1, "#");
      }
    }
    const arrow = (r, c, ch) => { if (rows[r][c] !== "#") put(r, c, ch); };
    if (facing === "E") arrow(2, 16, ">"); else if (facing === "W") arrow(2, 12, "<");
    else if (facing === "N") arrow(1, 14, "^"); else if (facing === "S") arrow(3, 14, "v");
    return rows.map(r => r.join("").replace(/\s+$/, ""));
  }

  const spaceCount = w => (w.spaces ? w.spaces.length : w.size * w.size);
  const api = { SIZE, DIRS, left, right, seedOf, generate, view, blocked, minimap, spaceCount };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WING = api;
})(this);
