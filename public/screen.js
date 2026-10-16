// The irl-dungeon screen: 4Dungeon's 80-column frame (daily-dungeon/screen.js, commit 43cebc2), trimmed to what
// this game has. Kept as 4Dungeon has them: the moon-and-date header, the 3D view (renderView), the right-hand panel
// with the map, the three log lines, the menu bar, and the width check. Removed: party, HP/MP, silver, ichor,
// breath, the title screen, the sky, fights, the bag and every menu item the game doesn't have. Every line on this
// screen shows something real; nothing is filler.
// An ES module so the page and the tests share it.

// The build number: bumped with every release, so the page, CHANGELOG.md and the git history always match.
const VERSION = "v0.02";
const HOME = "Pacific/Honolulu";
  const W = 80, VW = 47, VH = 17, OFF = [0, 3, 6];
  const L_ = o => 2 + o, R_ = o => 44 - o;
  const ljust = (s, n) => s.length >= n ? s : s + " ".repeat(n - s.length);
  const rjust = (s, n) => s.length >= n ? s : " ".repeat(n - s.length) + s;
  const center = (s, n) => {           // matches Python str.center
    if (s.length >= n) return s;
    const total = n - s.length;
    let left = Math.floor(total / 2);
    if (total % 2 === 1 && n % 2 === 1) left += 1;
    return " ".repeat(left) + s + " ".repeat(total - left);
  };

  function renderView(left, right, end, depth, lock) {
    const c = Array.from({ length: VH }, () => Array(VW).fill(" "));
    const put = (x, y, ch) => { if (x >= 0 && x < VW && y >= 0 && y < VH) c[y][x] = ch; };
    for (let k = 0; k < depth; k++) {
      const a = OFF[k], b = OFF[k + 1];
      for (const [side, closed] of [["L", left[k]], ["R", right[k]]]) {
        if (closed) {
          for (let i = 0; i < b - a; i++) {
            if (side === "L") { put(L_(a) + i, a + i, "\\"); put(L_(a) + i, 16 - a - i, "/"); }
            else { put(R_(a) - i, a + i, "/"); put(R_(a) - i, 16 - a - i, "\\"); }
          }
        } else {
          const [xa, xb] = side === "L" ? [L_(a), L_(b)] : [R_(b), R_(a)];
          if (!(end === "door" && !lock)) {                  // (the big arch stands clear of the side openings)
            for (let x = xa; x <= xb; x++) { put(x, b - 1, "_"); put(x, 16 - b, "_"); }
            for (let y = b; y < 17 - b; y++) put(side === "L" ? xa : xb, y, "|");
          }
        }
        const x = side === "L" ? L_(b) : R_(b);
        for (let y = b; y < 17 - b; y++) put(x, y, "|");
      }
    }
    const o = OFF[depth], l = L_(o), r = R_(o), t = o, bm = 16 - o;
    if (end === "dark") {
      for (let x = l + 1; x < r; x++) for (let y = t; y <= bm; y++) if ((x + y) % 3 === 0) put(x, y, ".");
    } else {
      for (let x = l; x <= r; x++) { put(x, t - 1, "_"); put(x, bm, "_"); }
      const cx = Math.floor((l + r) / 2);
      if (end === "door" && !lock) {       // an open door: a big double-line arch, with the room beyond left empty
        const arch = (x0, y0, w) => {
          const T = w - 20, b0 = Math.floor((w - T) / 2), top = (x, y, ch) => { if (y >= t && y < bm) put(x, y, ch); };
          for (let i = 0; i < T; i++) top(x0 + b0 + i, y0, "_");
          for (const [col, r] of [[7, 1], [4, 2]]) {
            [..."__/"].forEach((ch, k) => top(x0 + col + k, y0 + r, ch));
            [..."\\__"].forEach((ch, k) => top(x0 + w - col - 3 + k, y0 + r, ch));
          }
          for (let r = 3; r < 10; r++) { top(x0 + 3, y0 + r, "|"); top(x0 + w - 4, y0 + r, "|"); }
        };
        arch(cx - 16, t, 33); arch(cx - 13, t + 1, 27);
      } else if (end === "door") {
        const dl = cx - 4, dr = cx + 4, dt = depth === 2 ? t + 1 : t + 2;
        for (let x = dl; x <= dr; x++) { put(x, dt - 1, "_"); put(x, bm, "_"); }
        for (let y = dt; y <= bm; y++) { put(dl, y, "|"); put(dr, y, "|"); }
        put(cx + 2, Math.floor((dt + bm) / 2), lock);   // a locked (or false) door shows a + knob; a sealed one an x
      }
      if (end === "terminal") {            // a small screen set into the wall
        const T = [".---------.", "| > _     |", "|  :: ::  |", "'---------'", "   [===]"], y0 = Math.max(t + 1, bm - 8);
        T.forEach((ln, j) => [...ln].forEach((ch, k) => { if (ch !== " ") put(cx - 5 + k, y0 + j, ch); }));
      }
      if (end === "exchange") {            // the exchange's screen (v1.00): a size up from the altar's. Its five inner rows are
        // drawn as U+2800 (a blank that is never typed anywhere else); the page swaps them for the moving market.
        const W = 25, x0 = cx - 13, B = "\u2800".repeat(W);
        const E = ["." + "-".repeat(W) + ".", "|" + B + "|", "|" + B + "|", "|" + B + "|", "|" + B + "|", "|" + B + "|", "'" + "-".repeat(W) + "'", "       [===]   [===]"];
        E.forEach((ln, j) => [...ln].forEach((ch, k) => { if (ch !== " ") put(x0 + k, t + j, ch); }));
      }
      if (end === "stairs") {
        for (let j = 0; j < 4; j++) {
          const y = bm - 4 + j, w = 2 + j * 2;
          for (let x = cx - w; x <= cx + w; x++) put(x, y, "_");
          put(cx - w - 1, y, "|"); put(cx + w + 1, y, "|");
        }
      }
    }
    return c.map(row => row.join(""));
  }

  // TIME (the page's own clock; the server is not asked)
  const fmts = {};
  // How far the timezone is from UTC at that moment, in ms (follows daylight saving).
  function offsetMs(tz, date) {
    try {
      const f = fmts[tz] = fmts[tz] || new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
        year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
      const p = {}; for (const x of f.formatToParts(date)) p[x.type] = x.value;
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(date.getTime() / 1000) * 1000;
    } catch (e) { return -10 * 3600 * 1000; }
  }
  // The date and time on the wall clock in that timezone, as a Date read with getUTC*.
  const wall = (date, tz) => new Date(date.getTime() + offsetMs(tz || HOME, date));
  // A day number (days since 1970) counted in that timezone.
  const localDay = (date, tz) => Math.floor(wall(date, tz).getTime() / 86400000);
  const localISO = tz => wall(now(), tz).toISOString().slice(0, 10);

  const zoneName = (date, tz) => {
    try {
      const p = new Intl.DateTimeFormat("en-US", { timeZone: tz || HOME, timeZoneName: "short" }).formatToParts(date);
      return (p.find(x => x.type === "timeZoneName") || {}).value.replace(/^GMT$/, "UTC").slice(0, 9);
    } catch (e) { return "HST"; }
  };
  function hst(date, tz) {               // the run's local date and time
    const d = wall(date, tz);
    const DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const p2 = n => String(n).padStart(2, "0");
    return {
      date: `${DAYS[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${d.getUTCFullYear()}`,
      kanji: "日月火水木金土"[d.getUTCDay()],                // the Japanese weekday
      time: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`,
      zone: zoneName(date, tz),                              // HST, EDT, or GMT+9 where there's no short name
    };
  }

  function moonIndex(date) {
    const ref = Date.UTC(2000, 0, 6, 18, 14), syn = 29.530588853;
    let age = ((date.getTime() - ref) / 86400000) % syn;
    if (age < 0) age += syn;
    return Math.floor(age / syn * 8 + 0.5) % 8;
  }

  function epochIndex(date) {
    const ref = Date.UTC(2000, 0, 6, 18, 14), syn = 29.530588853;
    return Math.floor((date.getTime() - ref) / 86400000 / syn);
  }

  function epochDay(now) {
    const ref = Date.UTC(2000, 0, 6, 18, 14), syn = 29.530588853;
    const idx = epochIndex(now), into = (now.getTime() - ref) / 86400000 - idx * syn;
    const total = Math.floor(syn);
    return { idx, total, day: Math.min(total, Math.floor(into) + 1) };
  }

  function headerLines(omenText, tz, now) {
    now = now || new Date();
    const idx = moonIndex(now), when = hst(now, tz);
    const moons = ["(     )", "(    ))", "(  ))))", "())))))", "(((O)))", "((((())", "((((  )", "((    )"];
    const names = ["NEW", "CRESC", "HALF", "GIBB", "FULL", "GIBB", "HALF", "CRESC"];
    const long = ["NEW", "WAX CRESC", "1ST QTR", "WAX GIBB", "FULL", "WANE GIBB", "LAST QTR", "WANE CRESC"];
    // The block moon at the far left: 4 rows. Lit columns fill in from the right as it waxes and empty toward the left as it wanes (northern sky: waxing is lit on the right, waning on the left).
    const LIT = ["    ", "   ░", "  ▓▓", " ███", "████", "███ ", "▓▓  ", "░   "][idx];
    const box = [" ╭────╮ ", ` │${LIT}│ `, ` │${LIT}│ `, " ╰────╯ "];
    const BW = W - 2 - box[0].length;      // 70 columns to the right of the moon
    const bar = s => box[0] && center(s, BW);
    // Today's phase of the moon in Japanese (new, crescent, first quarter, waxing gibbous, full, waning gibbous, last quarter, waning crescent), left of its English name.
    const PKANJI = ["新月", "三日月", "上弦", "十三夜", "満月", "十六夜", "下弦", "二十六夜"], kj = PKANJI[idx];
    const ed = epochDay(now), head = ` LUNAR DAY ${ed.day}/${ed.total}  ${kj} ${long[idx]}`;     // (the day of the lunar month, as the title says; the strip below shows the phase)
    // The Japanese weekday kanji sits left of the date. A kanji is two columns wide on screen.
    const tail = `${when.kanji} ${when.date}   ${when.time} ${when.zone}  `;
    const S = ["+" + "=".repeat(78) + "+", "|" + box[0] + head + " ".repeat(BW - head.length - tail.length - 1 - kj.length) + tail + "|"];
    S.push("|" + box[1] + bar(moons.map(m => center(m, 8)).join("")) + "|");
    S.push("|" + box[2] + bar(names.map(n => center(n, 8)).join("")) + "|");
    // The marker row also carries a short moon update ("The moon is day 25, waning crescent."),
    // placed on whichever side of the row the ^^^ marker isn't, so the two never touch.
    const marks = bar(moons.map((_, i) => center(i === idx ? "^^^" : "", 8)).join(""));
    // The marker row holds only the ^^^ (the moon's day and phase are a line 1 status report).
    // The day's omen, in quotes and left-justified: at the left edge when it clears the ^^^, otherwise just after it.
    const omenT = omenText ? '"' + omenText.replace(/^> "?/, "").replace(/"$/, "").slice(0, 30) + '"' : "";
    let row = marks.split("");
    if (omenT) {
      const at = marks.indexOf("^^^");
      const start = 1 + omenT.length <= at - 2 ? 1 : at + 5;
      row.splice(start, omenT.length, ...omenT);
    }
    S.push("|" + box[3] + row.join("") + "|");
    S.push("+" + "=".repeat(78) + "+");
    return S;
  }

  function finishFrame(S, strict) {
    const cols = t => [...t].reduce((n, ch) => n + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0);
    for (let n = 0; n < S.length; n++) {
      const w = cols(S[n]);
      if (w === W) continue;
      if (strict) throw new Error(`bad width ${w}: ${S[n]}`);
      const line = S[n], inner = line.slice(1, -1);
      S[n] = line[0] + (w > W ? inner.slice(0, Math.max(0, inner.length - (w - W))) : inner + " ".repeat(W - w)) + line.slice(-1);
    }
    return S.join("\n");
  }


const LEFT = { N: "W", E: "N", S: "E", W: "S" }, RIGHT = { N: "E", E: "S", S: "W", W: "N" };
const WORD = { N: "north", E: "east", S: "south", W: "west" };

// What the player sees right now. `st`: { floor, at, facing, cell, tz, log, map } (floor is null before a cell is chosen;
// `map` is the minimap rows from FLOOR.minimap, made by the caller).
function describe(st) {
  const f = st.floor, room = f && f.rooms[st.at];
  if (!room) return null;
  const built = j => !!f.rooms[j], dirs = Object.keys(room.doors);
  const open = dirs.filter(d => built(room.doors[d])), locked = dirs.filter(d => !built(room.doors[d]));
  const ahead = room.doors[st.facing];
  const aheadWord = ahead === undefined ? "a wall" : built(ahead) ? "an open doorway" : f.sealed && f.sealed[ahead] ? "a sealed door" : "a locked door";
  return { room, open, locked, aheadWord, ahead };
}

function renderScreen(st, now) {
  now = now || new Date();
  const S = headerLines("", st.tz, now), f = st.floor, d = describe(st);
  const W_ = 80, PW = 29, rule = " " + "-".repeat(PW - 1);
  // ---- the 3D view
  let view;
  if (!d) view = renderView([true, true], [true, true], "dark", 2, null);
  else {
    const wallAt = dir => !(dir in d.room.doors);
    const sealed = d.ahead !== undefined && !f.rooms[d.ahead] && f.sealed && f.sealed[d.ahead];
    const lock = d.ahead !== undefined && !f.rooms[d.ahead] ? (sealed ? "x" : "+") : null;
    view = renderView([wallAt(LEFT[st.facing]), true], [wallAt(RIGHT[st.facing]), true],
      d.ahead !== undefined ? "door" : "wall", (d.ahead !== undefined && lock) ? 2 : 1, lock);
  }
  const overlay = (row, col, t) => { view[row] = view[row].slice(0, col) + t + view[row].slice(col + t.length); };
  if (d) { overlay(16, 16, `[ < ]  ${st.facing}  [ > ]`); overlay(15, 20, "[  ^  ]"); }
  // ---- the right-hand panel
  const map = (st.map || []).slice(0, 5); while (map.length < 5) map.push("");
  const title = " MAP ", dash = PW - 1 - title.length;
  const mapHead = " " + "-".repeat(Math.floor(dash / 2)) + title + "-".repeat(Math.ceil(dash / 2));
  const here = d ? (d.room.hall ? "PASSAGE" : d.room.dead ? "DEAD END" : "ROOM") : "";
  const stat = [
    " THIS CELL", rule,
    " " + (st.cell || "NONE").slice(0, PW - 2),
    d ? ` WING ${d.room.wing + 1}   ${here}` : "",
    d ? ` ${f.wings.length} WING${f.wings.length === 1 ? "" : "S"} BUILT` : "",
    "", rule, "", mapHead, ...map, "", rule, d ? ` ROOM ${st.at + 1}` : "",
  ];
  for (let i = 0; i < 17; i++) S.push("|" + ljust(view[i], 47) + "|" + ljust(stat[i] || "", 30) + "|");
  S.push("+" + "=".repeat(78) + "+");
  // ---- the three log lines: what is here, what you just did, what is ahead
  const r = s => "|" + ljust(s.slice(0, W_ - 2), W_ - 2) + "|";
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  const flavor = !d ? "> No cell yet. Press L to find where you are." : `> ${here === "ROOM" ? "A bare room" : here === "PASSAGE" ? "A passage" : "A dead end"}. ${plural(d.open.length, "open doorway", "open doorways")}, ${d.locked.length} locked.`;
  const doing = st.log || "";
  const ahead = !d ? "" : `> You face ${WORD[st.facing]}: ${d.aheadWord}.`;
  for (const m of [" " + flavor, " " + doing, " " + ahead]) S.push(r(m));
  S.push("+" + "-".repeat(78) + "+");
  const menu = (d ? " TURN: [A] [D] OR ARROWS    WALK: [W] OR UP    " : " ") + "[L]OCATE   [S]AVE";
  S.push("|" + menu + " ".repeat(78 - menu.length) + "|");
  S.push("+" + "=".repeat(78) + "+");
  return finishFrame(S, st.strict);
}

export { VERSION, renderScreen, describe, renderView, headerLines, moonIndex, epochDay, finishFrame, LEFT, RIGHT, WORD };
