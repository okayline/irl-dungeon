// irl-dungeon floor generator: TRIMMED from okayline/daily-dungeon floor.js (4Dungeon), commit 43cebc2.
// Kept: the wing layout code and the door/sealing rules, as 4Dungeon has them. Removed: everything a room holds
// (room kinds, demons, items, silver, clues, the locker, bonus and void rooms, painted doors) and everything that
// draws a screen (minimap, heat map). Rooms are empty for now.  Comments below are 4Dungeon's, lightly edited.
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

  // A door whose offer was settled the other way: it stays shut for good.
  const isSealed = (floor, from, dir) => { const i = floor.rooms[from].doors[dir]; return i !== undefined && !floor.rooms[i] && !!(floor.sealed && floor.sealed[i]); };

  const api = { generate, grow, rng, isSealed, symTransform, DAYS };
  return api;
})();
export default FLOOR;
