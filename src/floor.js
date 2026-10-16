// COPIED from okayline/daily-dungeon floor.js (4Dungeon), commit 43cebc2. Only the wrapper differs: the browser/node
// wrapper became an ES module so the Worker can import it. Keep the rest identical, and put any fix in both repos.
// Floor generation for the daily dungeon.
// A floor is four WINGS, each a small cluster of three spaces joined by open doors. KURA starts in the first wing.
// Each wing but the last has two LOCKED doors out of it: an OFFER of two rooms. The six room kinds are dealt out
// over the floor's three offers, so every kind is offered once, and she opens one door of each offer (one key a day).
// The room behind a door is the first space of the next wing. A wing holds:
//   - a room (the one she unlocked, with its kind; the start room has none),
//   - a PASSAGE (no kind, no demons, little in it), and
//   - a DEAD END, which hides a big clue about one of the wing's two locked doors,
// plus sometimes a FALSE DOOR (it looks locked, but it is only paint). The last wing has no locked doors:
// the stairs down are hidden in its passage or its dead end.
// A wing is built the moment its door is unlocked, so nothing past the next offer exists yet.
// Everything is rolled from the floor's seed, so a floor can be rolled again from it.
// Shared by the web page and node, like screen.js.
const FLOOR = (() => {
  const PAINTED_DOORS = false;   // false doors (painted, no room behind) are parked for now
  const DIRS = { N: [-1, 0], E: [0, 1], S: [1, 0], W: [0, -1] };
  const KINDS = ["den", "bay", "relay", "vault", "forge", "altar"];
  const BONUS_KIND = "archive";                  // the seventh type: only on bonus weeks, behind the wildcard door
  const ANTI_KIND = "void";                      // the eighth type: only on a CHAOS omen streak, behind a locked door
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

  // The minimap privacy transform: one of the 8 ways to rotate/mirror a square grid (the dihedral
  // group), picked once per floor from the private seed and held fixed for as long as she's on it --
  // it never spins as she turns or moves. Two players on the same shared wing see the same rooms in
  // the same true layout, just possibly rotated or mirrored relative to each other, so neither's
  // minimap or door callouts give away the other's. `sym` 0-3 are the four rotations, 4-7 the same
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

  // The week's deck: the six types dealt twice into pairs (never the same type twice in a pair), one pair for each of
  // days 1 to (days-1). The last day is a wildcard: one door of a random type (on a bonus week, the seventh type).
  // opts.days is how many days this floor lasts (up to 7).
  //
  // Two seeds, two different jobs (the async-multiplayer "shared shape, private contents" split):
  //   `seed` (shared) decides the floor's SHAPE -- wing count, each wing's internal layout, and which two
  //     kinds are paired together this floor. Every player on the same (epoch, floor depth) agrees on this.
  //   `pseed` (private, per account) decides everything that would turn the shared shape into a walkthrough
  //     if shared -- which paired kind lands in which slot, where things are hidden, the wildcard door's
  //     kind, and whether a bonus or omen-streak room shows up at all, and where. Re-rolled every floor.
  function generate(seed = Math.floor(Math.random() * 2 ** 32), pseed = Math.floor(Math.random() * 2 ** 32), opts = {}) {
    const rand = rng(seed), prand = rng(pseed);
    const days = Math.max(3, Math.min(DAYS, opts.days || DAYS)), pairs = days - 1;
    let deck;
    for (let tries = 0; ; tries++) {
      deck = shuffleWith(KINDS.slice(), rand).concat(shuffleWith(KINDS.slice(), rand));
      if (tries > 200 || Array.from({ length: 6 }, (_, i) => deck[2 * i] !== deck[2 * i + 1]).every(Boolean)) break;
    }
    const offers = Array.from({ length: pairs }, (_, i) => [deck[(2 * i) % 12], deck[(2 * i + 1) % 12]]);
    offers.push([KINDS[Math.floor(prand() * KINDS.length)]]);      // the wildcard door: private, per account -- never drawn from the shared deck
    const floor = { v: 11, seed, pseed, days, pairs, rooms: [], start: 0, stairs: -1, lure: -1, kinds: [],
      offers,                                                                  // the kinds offered, wing by wing (shared)
      lureStage: prand() < 0.6 ? 1 + Math.floor(prand() * pairs) : -1,         // which wing hides the locker (?), if any (private)
      sym: Math.floor(prand() * 8),                                // minimap rotate/mirror, stamped once (private, see symTransform)
      streak: opts.streak || null,                                 // "LAW", "CHAOS", or null -- stamped once, at arrival (see rules.js)
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
    const prand = rng((floor.pseed ^ Math.imul(stage + 7, 0x9e3779b1)) >>> 0);   // private: this wing's own content stream
    const R = n => Math.floor(rand() * n), PR = n => Math.floor(prand() * n);
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
      const plan = { layout, links: [], exits: [], falseDoors: { K: [], P: [], X: [] } };
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
      // Sometimes a false door: one more door on a wall that has none (never the 4th door of a space).
      // OFF for now (painted doors are parked until their mechanic is settled): flip PAINTED_DOORS to bring them back.
      if (PAINTED_DOORS && rand() < 0.4) {
        const spaces = Object.keys(pos).filter(s => used[s].size < 3);
        if (spaces.length) {
          const sp = spaces[R(spaces.length)], walls = Object.keys(DIRS).filter(d => !used[sp].has(d));
          if (walls.length) { const d = walls[R(walls.length)]; used[sp].add(d); plan.falseDoors[sp].push(d); }
        }
      }
      plan.pos = pos;
      return plan;
    }
    let plan = null;
    for (let tries = 0; !plan && tries < 600; tries++) plan = attempt(tries % 50 === 49 || tries >= 300 ? "solo" : rand() < 0.5 ? "chain" : "star", tries >= 40);
    if (!plan) { plan = { layout: "solo", links: [], exits: [], falseDoors: { K: [], P: [], X: [] }, pos: { K: floor.pos[k] } }; floor.stuck = (floor.stuck || 0) + 1; }   // never reached in practice

    // Commit the plan: book the spaces and the exits.
    const idx = { K: k };
    if (plan.pos.P) idx.P = book(floor, k, plan.pos.P.r, plan.pos.P.c);
    if (plan.pos.X) idx.X = book(floor, plan.links.find(l => l.b === "X").a === "P" ? idx.P : k, plan.pos.X.r, plan.pos.X.c);
    const doors = { K: {}, P: {}, X: {} };
    if (from) doors.K[back] = from.room;
    for (const l of plan.links) { doors[l.a][l.d] = idx[l.b]; doors[l.b][OPP[l.d]] = idx[l.a]; }
    // Which paired kind lands in which slot is private: the pairing itself ("vault pairs with forge
    // this floor") is shared and safe to say out loud, but which exact door that is would spoil it.
    const offer = shuffleWith(floor.offers[Math.min(stage, floor.pairs)].slice(), prand), exitIdx = [];
    plan.exits.forEach((e, i) => {
      const x = book(floor, idx[e.host], e.p.r, e.p.c);
      floor.kinds[x] = offer[i]; floor.exits[x] = { wing: stage, kind: offer[i], from: idx[e.host], dir: e.d };
      doors[e.host][e.d] = x; exitIdx.push(x);
    });
    const names = Object.keys(idx);
    // Where the special things go.
    const extra = { K: [], P: [], X: [] };
    if (stage === floor.pairs) {                                  // the last wing: the stairs, in the passage or the dead end
      const home = names.includes("P") && names.includes("X") ? (R(2) ? "P" : "X") : names.includes("X") ? "X" : names.includes("P") ? "P" : "K";
      extra[home].push("stairs"); floor.stairs = idx[home];
    }
    if (stage === floor.lureStage) { const home = names.includes("X") ? "X" : "K"; extra[home].push("lure"); floor.lure = idx[home]; }
    const clueKind = exitIdx.length ? floor.kinds[exitIdx[R(exitIdx.length)]] : null;
    floor.wings[stage] = { rooms: names.map(n => idx[n]), exits: exitIdx, clueKind };

    // BONUS ROOM: whether one happens at all is decided once a day, privately, in rules.js's sync() --
    // not here. This just places whatever that daily roll already decided (floor.pendingBonus) into
    // the new wing's PASSAGE as THE ARCHIVE, the first chance it gets. Once per floor. Never swaps a room
    // behind a hinted door, so hints stay true. Since v1.00 it never takes the dead end (every dead end holds
    // the exchange's screen, the same for everyone) and never the stairs wing (the stairs may be in its passage).
    const bonusSlot = names.includes("P") && stage < floor.pairs ? "P" : null;
    const bonusN = !floor.bonusRolled && stage > 0 && bonusSlot && floor.pendingBonus ? bonusSlot : null;
    if (bonusN) { floor.bonusRolled = true; floor.pendingBonus = false; }
    // ANTI-BONUS ROOM (THE VOID): the mirror case, same deal -- rules.js's daily roll only sets this
    // while a CHAOS omen streak holds (see omenStreak). Not a worse version of an ordinary room, it's
    // a room that wasn't there at all until the pattern turned. Never both at once (the streak is
    // stamped once, at arrival, so a floor is never both a LAW streak and a CHAOS streak).
    const antiN = !bonusN && !floor.antiRolled && stage > 0 && bonusSlot && floor.pendingAnti ? bonusSlot : null;
    if (antiN) { floor.antiRolled = true; floor.pendingAnti = false; }
    // Everything above stays in the floor's own raw, shared terms. From here down, each room is
    // finalized for display -- its doors relabeled and its position rotated/mirrored by the floor's
    // one fixed symmetry (see symTransform) -- so what's actually stored and read everywhere else
    // (minimap, door lookups, facing) is already private to this account. floor.pos/.cells (raw) are
    // untouched, so the generation above and any later wing on this floor keep working off real geometry.
    const T = symTransform(floor.sym);
    const remapDoors = raw => { const out = {}; for (const d in raw) out[T.dir(d)] = raw[d]; return out; };
    for (const n of names) {
      const i = idx[n], rr = rng((floor.pseed ^ Math.imul(i + 1, 0x85ebca6b)) >>> 0);
      const RR = m => Math.floor(rr() * m), pickR = a => a[RR(a.length)];
      const kind = n === "K" ? floor.kinds[i] || null : null;
      const pile = extra[n].slice();
      const want = Math.max(extra[n].length, n === "P" ? RR(2) : n === "X" ? RR(3) : 1 + RR(3));
      while (pile.length < want) pile.push(pickR(n === "P" ? ["item", "silver"] : ["demon", "demon", "item", "item", "silver"]));
      if ((n === "X" || (n === "K" && !names.includes("X"))) && clueKind) pile.push("clue");          // the dead end's big clue (it doesn't count toward the pile's size)
      for (let j = pile.length - 1; j > 0; j--) { const m = RR(j + 1); [pile[j], pile[m]] = [pile[m], pile[j]]; }
      // A Recharge Bay is safe: its demons turn into items.
      let hidden = kind === "bay" ? pile.map(h => h === "demon" ? "item" : h) : pile;
      // The bonus room still has to be searched for, but its walls hold better things: a locker, items and coin, no demons.
      if (n === bonusN) {
        hidden = hidden.filter(h => !["demon", "item", "silver"].includes(h)).concat(["lure", "item", "item", "silver"]);
        for (let j = hidden.length - 1; j > 0; j--) { const m = RR(j + 1); [hidden[j], hidden[m]] = [hidden[m], hidden[j]]; }
      }
      // The void still has to be searched for too, but there's less to find, and more of it bites back.
      if (n === antiN) {
        hidden = hidden.filter(h => !["item", "silver"].includes(h)).concat(["demon", "demon"]);
        for (let j = hidden.length - 1; j > 0; j--) { const m = RR(j + 1); [hidden[j], hidden[m]] = [hidden[m], hidden[j]]; }
      }
      const p = T.pos(floor.pos[i].r, floor.pos[i].c);
      const room = { r: p.r, c: p.c, doors: remapDoors(doors[n]), hidden, wing: stage };
      if (kind) room.kind = kind;
      if (n === bonusN) room.kind = BONUS_KIND;
      if (n === antiN) room.kind = ANTI_KIND;
      if (n === "P") room.hall = true;                       // a passage
      if (n === "X") room.dead = true;                       // a dead end
      if (plan.falseDoors[n].length) room.falseDoors = plan.falseDoors[n].map(d => T.dir(d));
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

  // What lies behind a locked door out of room `from`: its kind (the door's own room kind), or null.
  const kindBehind = (floor, from, dir) => {
    const i = floor.rooms[from].doors[dir];
    return i !== undefined && !floor.rooms[i] ? floor.kinds[i] || null : null;
  };

  // Minimap: only rooms KURA has been in are drawn, with door stubs leading out of them.
  // A visited room still holding the locker shows ?; a passage shows :; a locked (or false) door shows #.
  // state: { at: room index, visited: [bool,bool,bool], found: [names found per room], facing }
  // The map is centered on KURA: her room is always in the middle and the floor moves around her.
  // Rooms two steps away up or down fall outside the 5 rows and stay off the map.
  function minimap(floor, state) {
    // One symbol per room: [@] KURA, [^] the way up, [v] stairs down once found, [?] the lure,
    // [ ] a visited room. Open doors are blank gaps.
    const W = 29, H = 5, rows = Array.from({ length: H }, () => Array(W).fill(" "));
    const put = (r, c, s) => [...s].forEach((ch, k) => {
      if (r >= 0 && r < H && c + k >= 0 && c + k < W) rows[r][c + k] = ch;
    });
    const here = floor.rooms[state.at];
    // Every room KURA has been in is outlined in + - | walls (neighbors share a wall), opened wherever there is a door
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
    for (const { room, row, col } of seen) { for (const d of Object.keys(room.doors)) open(row, col, d); for (const d of room.falseDoors || []) open(row, col, d); }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (wall[r][c]) {
      const n = r > 0 ? wall[r - 1][c] : vert[r][c], s = r < H - 1 ? wall[r + 1][c] : vert[r][c], w = c > 0 && wall[r][c - 1], e = c < W - 1 && wall[r][c + 1];
      rows[r][c] = (n || s) && (w || e) ? "+" : n || s ? "|" : "-";
    }
    seen.forEach(({ i, room, row, col }) => {
      const found = state.found[i] || [];
      const lureHere = i === floor.lure && !found.includes("lure");
      const mark = state.at === i ? "@" : i === floor.start ? "v"
        : found.includes("stairs") ? "^" : lureHere ? "?" : " ";
      put(row, col, room.hall ? " " + mark + " " : "[" + mark + "]");   // a passage has no brackets: blank, or just KURA's @ (or a mark)
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
      for (const d of room.falseDoors || []) stub(d, true);
    });
    // KURA's facing: an arrow in the gap on that side of her room. A locked door's # always stays on top of it.
    const f = state.facing, arrow = (r, c, ch) => { if (rows[r][c] !== "#") put(r, c, ch); };
    if (f === "E") arrow(2, 16, ">"); else if (f === "W") arrow(2, 12, "<");
    else if (f === "N") arrow(1, 14, "^"); else if (f === "S") arrow(3, 14, "v");
    return rows.map(r => r.join("").replace(/\s+$/, ""));
  }

  // (v1.12) The heat overlay for the minimap: the same grid, with a character (48 + the room's heat) under each of a
  // drawn room's two brackets, and a blank everywhere else. state: { at, visited, heat: { room index: heat } }.
  function heatMap(floor, state) {
    const W = 29, H = 5, rows = Array.from({ length: H }, () => Array(W).fill(" ")), here = floor.rooms[state.at];
    floor.rooms.forEach((room, i) => {
      if (!room || !state.visited[i] || room.hall || state.heat[i] === undefined) return;
      const row = 2 + (room.r - here.r) * 2, col = 13 + (room.c - here.c) * 4, ch = String.fromCharCode(48 + Math.min(24, Math.max(0, Math.round(state.heat[i]))));
      for (const c of [col, col + 2]) if (row >= 0 && row < H && c >= 0 && c < W) rows[row][c] = ch;
    });
    return rows.map(r => r.join(""));
  }

  // A fresh floor as KURA arrives: only the first wing is known.
  function arrive(floor, facing) {
    const firstDoor = Object.keys(floor.rooms[0].doors)[0];
    return { at: 0, visited: [true], found: [[]], facing: facing || firstDoor };
  }

  const api = { generate, grow, minimap, heatMap, arrive, rng, kindBehind, isSealed, symTransform, DAYS, BONUS_KIND, ANTI_KIND };
  return api;
})();
export default FLOOR;
