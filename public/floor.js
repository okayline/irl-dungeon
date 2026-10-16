// irl-dungeon floor generator: TRIMMED from okayline/daily-dungeon floor.js (4Dungeon), commit 43cebc2.
// Kept: the wing layout code and the door/sealing rules, as 4Dungeon has them. Removed: everything a room holds
// (room kinds, demons, items, silver, clues, the locker, bonus and void rooms, painted doors) and everything that
// draws a screen (the heat map; the minimap is kept, without the locker and stairs marks). Rooms are empty for now.  Comments below are 4Dungeon's, lightly edited.
//
// A floor is a chain of WINGS, each a small cluster of three spaces joined by open doors. Each wing but the last
// two hangs two LOCKED doors: unlocking one seals the other. The room behind a door is the first space of the next
// wing, and a wing is built the moment its door is unlocked, so nothing past the next doors exists yet.
// The last wing holds the stairs down (in its passage or dead end). Everything is rolled from the floor's seed.
//
// Two seeds: `seed` (shared) decides the SHAPE; `pseed` (private, per player) decides only `sym`, the per-player
// rotation/mirror of the map, so door labels differ from player to player while the shape is the same.
const FLOOR = (() => {
  const DIRS = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
  const OPP = { N: "S", E: "W", S: "N", W: "E" };
  const DAYS = 7;

  // Small seeded random generator, so a floor can be rolled again from its seed.
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffleWith(a, rand) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }


  // The map privacy transform: one of the 8 ways to rotate/mirror a square grid (the dihedral
  // group), picked once per floor from the private seed and held fixed for as long as she's on it --
  // it never spins as she turns or moves. Two players on the same shared wing see the same rooms in
  // the same true layout, just possibly rotated or mirrored relative to each other, so neither's
  // map or door callouts give away the other's. `sym` 0-3 are the four rotations, 4-7 the same
  // four mirrored first. Undefined (an in-progress floor from before this existed) means identity --
  // no change to any wing already built, and any new wing on that same floor stays unrotated too.
  function symTransform(sym) {
    const mir = (sym || 0) >= 4, k = (sym || 0) % 4;
    const IDX = { N: 0, E: 1, S: 2, W: 3 }, LBL = ["N", "E", "S", "W"];
    return {
      dir(d) { let i = IDX[d]; if (mir) i = (4 - i) % 4; i = (i + k) % 4; return LBL[i]; },
      pos(r, c) { let dr = r, dc = c; if (mir) dc = -dc; for (let t = 0; t < k; t++) { const nr = dc, nc = -dr; dr = nr; dc = nc; } return { r: dr, c: dc }; }
    };
  }

  // opts.days is how many days this floor lasts (3 to 7): days - 1 wings hang two locked doors, the next wing hangs one.
  function generate(seed = Math.floor(Math.random() * 2 ** 32), pseed = Math.floor(Math.random() * 2 ** 32), opts = {}) {
    const prand = rng(pseed);
    const days = Math.max(3, Math.min(DAYS, opts.days || DAYS)), pairs = days - 1;
    const floor = { v: 1, seed, pseed, days, pairs, rooms: [], start: 0, stairs: -1,
      sym: Math.floor(prand() * 8),                                // map rotate/mirror, stamped once (private, see symTransform)
      wings: [], exits: {}, count: 0, pos: [], cells: {}, parent: [], depth: [] };
    buildWing(floor, book(floor, -1, 0, 0), null);
    return floor;
  }

  // Book a place on the grid for a space: its number, spot and depth. (The grid has no edges.)
  function book(floor, from, r, c) {
    const idx = floor.count++;
    floor.pos[idx] = { r, c }; floor.cells[r + "," + c] = idx;
    floor.parent[idx] = from; floor.depth[idx] = from < 0 ? 0 : floor.depth[from] + 1;
    return idx;
  }

  // Build the wing that begins with space k (booked, not built). `from` is the door it was entered by ({ dir, room }),
  // or null for the first wing. Lays out the three spaces, books the two locked exits, and fills every space.
  function buildWing(floor, k, from) {
    const stage = floor.wings.length;
    const rand = rng((floor.seed ^ Math.imul(stage + 7, 0x9e3779b1)) >>> 0);
    const R = n => Math.floor(rand() * n);
    const exitsWanted = stage < floor.pairs ? 2 : stage === floor.pairs ? 1 : 0;     // the stairs wing has one exit: the wildcard door
    // The wall k was entered by, in the floor's own (raw, shared) terms -- not from.dir, which by the time
    // this runs may already be a player's rotated/mirrored label. floor.exits[k] is booked in raw terms
    // by the parent wing below, so it's the one true source for "which wall did we just come in through."
    const back = from ? OPP[floor.exits[k].dir] : null;
    const at = (p, d) => ({ r: p.r + DIRS[d][0], c: p.c + DIRS[d][1] });
    const key = p => p.r + "," + p.c;

    // Cells to keep clear: next to any other door still locked (a sealed one never gets built), so that room keeps space to build its own wing.
    const halo = new Set();
    for (let j = 0; j < floor.count; j++) if (j !== k && !floor.rooms[j] && !(floor.sealed && floor.sealed[j])) for (const d of Object.keys(DIRS)) halo.add(key(at(floor.pos[j], d)));
    const roomy = (p, taken) => Object.keys(DIRS).filter(d => !(key(at(p, d)) in floor.cells) && !taken.has(key(at(p, d)))).length >= 3;

    // Try one layout: pick free cells for the spaces and the exits. Returns a plan, or null if it doesn't fit.
    // `tight` lets it ignore the keep-clear cells (only after many failed tries).
    function attempt(layout, tight) {
      const taken = new Set(), pos = { K: floor.pos[k] }, used = { K: new Set(back ? [back] : []), P: new Set(), X: new Set() };
      const out = (sp, isExit) => {                         // a free cell next to space sp, through a wall not yet used
        for (const d of shuffleWith(Object.keys(DIRS), rand)) {
          if (used[sp].has(d)) continue;
          const p = at(pos[sp], d), kk = key(p);
          if (kk in floor.cells || taken.has(kk) || (!tight && halo.has(kk))) continue;
          if (isExit && !tight && !roomy(p, taken)) continue;
          taken.add(kk); used[sp].add(d);
          return { d, p };
        }
        return null;
      };
      const plan = { layout, links: [], exits: [] };
      if (layout !== "solo") {
        const kp = out("K"); if (!kp) return null;
        pos.P = kp.p; used.P.add(OPP[kp.d]); plan.links.push({ a: "K", b: "P", d: kp.d });
        const host = layout === "chain" ? "P" : "K";        // the dead end hangs off the passage (chain) or the room (star)
        const x = out(host); if (!x) return null;
        pos.X = x.p; used.X.add(OPP[x.d]); plan.links.push({ a: host, b: "X", d: x.d });
      }
      const exitHosts = layout === "chain" ? ["K", "P"] : layout === "star" ? ["P", "P"] : ["K", "K"];
      for (let i = 0; i < exitsWanted; i++) {
        const e = out(exitHosts[i], true); if (!e) return null;
        plan.exits.push({ host: exitHosts[i], d: e.d, p: e.p });
      }
      plan.pos = pos;
      return plan;
    }
    let plan = null;
    for (let tries = 0; !plan && tries < 600; tries++) plan = attempt(tries % 50 === 49 || tries >= 300 ? "solo" : rand() < 0.5 ? "chain" : "star", tries >= 40);
    if (!plan) { plan = { layout: "solo", links: [], exits: [], pos: { K: floor.pos[k] } }; floor.stuck = (floor.stuck || 0) + 1; }   // 4Dungeon says "never reached in practice"; it is (see test/floor.test.mjs)

    // Commit the plan: book the spaces and the exits.
    const idx = { K: k };
    if (plan.pos.P) idx.P = book(floor, k, plan.pos.P.r, plan.pos.P.c);
    if (plan.pos.X) idx.X = book(floor, plan.links.find(l => l.b === "X").a === "P" ? idx.P : k, plan.pos.X.r, plan.pos.X.c);
    const doors = { K: {}, P: {}, X: {} };
    if (from) doors.K[back] = from.room;
    for (const l of plan.links) { doors[l.a][l.d] = idx[l.b]; doors[l.b][OPP[l.d]] = idx[l.a]; }
    const exitIdx = [];
    plan.exits.forEach((e) => {
      const x = book(floor, idx[e.host], e.p.r, e.p.c);
      floor.exits[x] = { wing: stage, from: idx[e.host], dir: e.d };
      doors[e.host][e.d] = x; exitIdx.push(x);
    });
    const names = Object.keys(idx);
    if (stage === floor.pairs) {                                  // the last wing: the stairs, in the passage or the dead end
      const home = names.includes("P") && names.includes("X") ? (R(2) ? "P" : "X") : names.includes("X") ? "X" : names.includes("P") ? "P" : "K";
      floor.stairs = idx[home];
    }
    floor.wings[stage] = { rooms: names.map(n => idx[n]), exits: exitIdx };

    // From here down each room is finalized for display: its doors relabeled and its position rotated/mirrored by the
    // floor's one fixed symmetry (see symTransform). floor.pos/.cells stay raw, so later wings still build on real geometry.
    const T = symTransform(floor.sym);
    const remapDoors = raw => { const out = {}; for (const d in raw) out[T.dir(d)] = raw[d]; return out; };
    for (const n of names) {
      const i = idx[n], p = T.pos(floor.pos[i].r, floor.pos[i].c);
      const room = { r: p.r, c: p.c, doors: remapDoors(doors[n]), wing: stage };
      if (n === "P") room.hall = true;                       // a passage
      if (n === "X") room.dead = true;                       // a dead end
      floor.rooms[i] = room;
    }
    return k;
  }


  // Open the door `dir` out of room `from`: build the wing behind it if it isn't built yet. Returns the room's number.
  function grow(floor, from, dir) {
    const i = floor.rooms[from].doors[dir];
    if (i === undefined) return undefined;
    if (!floor.sealed) floor.sealed = {};
    if (!floor.rooms[i]) {
      // Opening one door of an offer seals the other: she takes one room of the two.
      const e = floor.exits[i];
      if (e) for (const j of floor.wings[e.wing].exits) if (j !== i) floor.sealed[j] = true;
      buildWing(floor, i, { dir, room: from });
    }
    return i;
  }

  // Doors by number rather than by direction. Direction labels are rotated per player (see symTransform), but a door's
  // number (its room index) is the same for everyone who takes the same path, so the server and the page agree on it.
  // lockedDoors: the doors that can be unlocked right now (not built, not sealed). growDoor: unlock one by number.
  const lockedDoors = (floor) => Object.keys(floor.exits).map(Number).filter(i => !floor.rooms[i] && !(floor.sealed && floor.sealed[i]));
  function growDoor(floor, door) {
    if (!lockedDoors(floor).includes(door)) return undefined;
    const e = floor.exits[door];
    return grow(floor, e.from, symTransform(floor.sym).dir(e.dir));
  }

  // A door whose offer was settled the other way: it stays shut for good.
  const isSealed = (floor, from, dir) => { const i = floor.rooms[from].doors[dir]; return i !== undefined && !floor.rooms[i] && !!(floor.sealed && floor.sealed[i]); };

  // Minimap: only rooms you has been in are drawn, with door stubs leading out of them.
  // A passage has no brackets; a locked door shows #; a sealed one is plain wall.
  // state: { at: room index, visited: [bool per room], facing }
  // The map is centered on you: her room is always in the middle and the floor moves around her.
  // Rooms two steps away up or down fall outside the 5 rows and stay off the map.
  function minimap(floor, state) {
    // One symbol per room: [@] you, [v] where you started (the way up), [ ] a visited room. Open doors are blank gaps.
    const W = 29, H = 5, rows = Array.from({ length: H }, () => Array(W).fill(" "));
    const put = (r, c, s) => [...s].forEach((ch, k) => {
      if (r >= 0 && r < H && c + k >= 0 && c + k < W) rows[r][c + k] = ch;
    });
    const here = floor.rooms[state.at];
    // Every room you has been in is outlined in + - | walls (neighbors share a wall), opened wherever there is a door
    // (open, locked, false or sealed), so a corner next to a door turns into - or |.
    const seen = [];
    floor.rooms.forEach((room, i) => {
      if (room && state.visited[i]) seen.push({ i, room, row: 2 + (room.r - here.r) * 2, col: 13 + (room.c - here.c) * 4 });
    });
    const wall = Array.from({ length: H }, () => Array(W).fill(false)), vert = Array.from({ length: H }, () => Array(W).fill(false));
    const mark = (r, c, v) => { if (r >= 0 && r < H && c >= 0 && c < W) wall[r][c] = v; };
    for (const { row, col } of seen)
      for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 3; c++) if (r !== row || c === col - 1 || c === col + 3) {
        mark(r, c, true);
        if ((c === col - 1 || c === col + 3) && r >= 0 && r < H && c >= 0 && c < W) vert[r][c] = true;   // a side wall keeps going past the edge of the window
      }
    // Rooms of one wing read as a single big room: their doors are just gaps in the wall, with no door mark.
    const same = (room, d) => { const o = floor.rooms[room.doors[d]]; return !!o && o.wing === room.wing && state.visited[room.doors[d]]; };
    const open = (row, col, d) => {
      if (d === "E") mark(row, col + 3, false); if (d === "W") mark(row, col - 1, false);
      if (d === "S") for (let k = 0; k < 3; k++) mark(row + 1, col + k, false);
      if (d === "N") for (let k = 0; k < 3; k++) mark(row - 1, col + k, false);
    };
    for (const { room, row, col } of seen) { for (const d of Object.keys(room.doors)) open(row, col, d); }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (wall[r][c]) {
      const n = r > 0 ? wall[r - 1][c] : vert[r][c], s = r < H - 1 ? wall[r + 1][c] : vert[r][c], w = c > 0 && wall[r][c - 1], e = c < W - 1 && wall[r][c + 1];
      rows[r][c] = (n || s) && (w || e) ? "+" : n || s ? "|" : "-";
    }
    seen.forEach(({ i, room, row, col }) => {
      const mark = state.at === i ? "@" : i === floor.start ? "v" : " ";
      put(row, col, room.hall ? " " + mark + " " : "[" + mark + "]");   // a passage has no brackets: blank, or just your @ (or a mark)
      // Door marks sit in the opened gaps: an open door is just blank, # for a locked or false one; a sealed one is plain wall.
      const stub = (d, locked) => {
        if (d === "E") put(row, col + 3, locked ? "#" : " ");
        if (d === "W") put(row, col - 1, locked ? "#" : " ");
        if (d === "S") put(row + 1, col + 1, locked ? "#" : " ");
        if (d === "N") put(row - 1, col + 1, locked ? "#" : " ");
      };
      for (const d of Object.keys(room.doors)) {
        const j = room.doors[d], shut = !floor.rooms[j];
        if (same(room, d)) continue;                              // inside a wing: one big room, no door mark
        stub(d, shut);
        if (shut && floor.sealed && floor.sealed[j]) {            // a sealed door shows x
          if (d === "E") put(row, col + 3, "|"); if (d === "W") put(row, col - 1, "|");
          if (d === "S") put(row + 1, col + 1, "-"); if (d === "N") put(row - 1, col + 1, "-");
        }
      }
    });
    // your facing: an arrow in the gap on that side of her room. A locked door's # always stays on top of it.
    const f = state.facing, arrow = (r, c, ch) => { if (rows[r][c] !== "#") put(r, c, ch); };
    if (f === "E") arrow(2, 16, ">"); else if (f === "W") arrow(2, 12, "<");
    else if (f === "N") arrow(1, 14, "^"); else if (f === "S") arrow(3, 14, "v");
    return rows.map(r => r.join("").replace(/\s+$/, ""));
  }

  // The shared seed for one cell's layer. Provisional: the layer index is 0 until seasons exist, and the server will
  // use this same function to check a player's unlocks. FNV-1a over the text, so the same cell and layer always
  // give the same floor.
  function seedFor(cell, layer = 0) {
    let h = 0x811c9dc5;
    for (const ch of `irl|${cell}|${layer}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }

  // A fresh floor as you arrive: only the first wing is known.
  function arrive(floor) {
    return { at: 0, visited: [true], facing: Object.keys(floor.rooms[0].doors)[0] };
  }

  const api = { generate, grow, growDoor, lockedDoors, minimap, arrive, seedFor, rng, isSealed, symTransform, DAYS };
  return api;
})();
export default FLOOR;
