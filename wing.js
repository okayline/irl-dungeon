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

  // Build the wing: a maze carved from the seed (every tile reachable), a few extra openings so it isn't all
  // corridors, the entrance on the south edge, and on a cell's first wing the one locked door, set in an outer wall.
  function generate(cell, day, path) {
    path = path || "";
    const rand = stream(seedOf(`${cell}|${day}|${path}`));
    const R = n => Math.floor(rand() * n);
    // walls[y][x] holds the sides of that tile that are walled: { N, E, S, W }
    const walls = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ({ N: true, E: true, S: true, W: true })));
    const seen = Array.from({ length: SIZE }, () => Array(SIZE).fill(false));
    const start = { x: Math.floor(SIZE / 2), y: SIZE - 1 };
    const stack = [start]; seen[start.y][start.x] = true;
    while (stack.length) {
      const cur = stack[stack.length - 1];
      const open = ORDER.filter(d => { const [dx, dy] = DIRS[d], nx = cur.x + dx, ny = cur.y + dy; return nx >= 0 && ny >= 0 && nx < SIZE && ny < SIZE && !seen[ny][nx]; });
      if (!open.length) { stack.pop(); continue; }
      const d = open[R(open.length)], [dx, dy] = DIRS[d], nx = cur.x + dx, ny = cur.y + dy;
      walls[cur.y][cur.x][d] = false; walls[ny][nx][OPP[d]] = false; seen[ny][nx] = true;
      stack.push({ x: nx, y: ny });
    }
    for (let k = 0; k < 3; k++) {                    // a few extra openings
      const x = R(SIZE - 1), y = R(SIZE);
      walls[y][x].E = false; walls[y][x + 1].W = false;
    }
    // The locked door (first wing only): an outer wall of a tile on the far half, never the entrance's.
    let door = null;
    if (path === "") {
      const spots = [];
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) for (const d of ORDER) {
        const [dx, dy] = DIRS[d], nx = x + dx, ny = y + dy;
        if ((nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) && y < SIZE - 1) spots.push({ x, y, d });
      }
      door = spots[R(spots.length)];
    }
    return { cell, day, path, size: SIZE, walls, start, door };
  }

  const isDoor = (w, x, y, d) => !!(w.door && w.door.x === x && w.door.y === y && w.door.d === d);
  const blocked = (w, x, y, d) => w.walls[y][x][d];
  const left = { N: "W", E: "N", S: "E", W: "S" }, right = { N: "E", E: "S", S: "W", W: "N" };

  // What KURA sees, in daily-dungeon's terms: wall flags for the two segments ahead on each side, and what ends
  // the view (a plain wall, the locked door, or the dark when the way runs on).
  function view(w, x, y, f) {
    const L = [], Rt = [];
    let cx = x, cy = y, end = "wall", lock = "";
    for (let k = 0; k < 2; k++) {
      L.push(blocked(w, cx, cy, left[f])); Rt.push(blocked(w, cx, cy, right[f]));
      if (blocked(w, cx, cy, f)) { if (isDoor(w, cx, cy, f)) { end = "door"; lock = "+"; } break; }
      if (k === 1) { end = "dark"; break; }
      const [dx, dy] = DIRS[f]; cx += dx; cy += dy;
    }
    while (L.length < 2) { L.push(true); Rt.push(true); }
    return { left: L, right: Rt, end, lock };
  }

  // The panel minimap: one character per tile, a space between. @ is KURA, . a walked tile, : one not yet walked.
  function minimap(w, x, y, walked) {
    const rows = [];
    for (let j = 0; j < w.size; j++) {
      let r = "";
      for (let i = 0; i < w.size; i++) r += (i ? " " : "") + (i === x && j === y ? "@" : walked.has(i + "," + j) ? "." : ":");
      rows.push(r);
    }
    const pad = " ".repeat(Math.floor((28 - rows[0].length) / 2));
    return rows.map(r => pad + r);
  }

  const api = { SIZE, DIRS, left, right, seedOf, generate, view, blocked, minimap };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WING = api;
})(this);
