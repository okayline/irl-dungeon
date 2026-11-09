// Player names: two words from lists, copied from the master list, dungeon-items src/name-words.js (Nov 8, 2026;
// change them there first). A name is two word ids ("adj:3", "noun:7"); the pair is unique. Ids point into these lists,
// so only ever append new words at the END. (Nov 8, 2026: every word was replaced in place on purpose, so every
// player's name changed with it.)
// The ledger never holds a name: it holds player ids in its own private column, and names are looked up when shown.
export const NAME_ADJECTIVES = [
  "Quiet", "Sleepy", "Misty", "Golden", "Silver", "Glowing", "Lucky", "Little", "Mellow", "Sunny",
  "Drowsy", "Faint", "Distant", "Midnight", "Neon", "Pixel", "Static", "Chrome", "Analog", "Turbo",
  "Hyper", "Mega", "Blinking", "Spinning", "Glitchy", "Fuzzy", "Cosmic", "Lunar", "Electric", "Velvet",
  "Bubble", "Plastic", "Candy", "Laser", "Retro", "Wired", "Offline", "Lagging", "Secret", "Shiny",
];
export const NAME_NOUNS = [
  "Modem", "Cursor", "Floppy", "Pager", "Sprite", "Cassette", "Arcade", "Byte", "Beeper", "Satellite",
  "Antenna", "Jukebox", "Robot", "Rocket", "Respawn", "Emoticon", "Cartridge", "Banner", "Marquee", "Joystick",
  "Mixtape", "Webring", "Guestbook", "Keyboard", "Boombox", "Popup", "Inbox", "Desktop", "Bookmark", "Mouse",
  "Icon", "Chip", "Signal", "Radio", "Screen", "Widget", "Cable", "Button", "Gadget", "Console",
];
const LISTS = { adj: NAME_ADJECTIVES, noun: NAME_NOUNS };

// "adj:3" -> "Gentle", or null if it isn't a word we know.
export function nameWord(id) {
  const m = /^(adj|noun):(\d{1,3})$/.exec(String(id || ""));
  return (m && LISTS[m[1]][Number(m[2])]) || null;
}
export function nameText(a, b) {
  const x = nameWord(a), y = nameWord(b);
  return /^adj:/.test(a) && /^noun:/.test(b) && x && y ? `${x} ${y}` : null;
}

// A random pair nobody has, or null if a few dozen tries all hit taken names. `except` is a pair to avoid (a reroll
// never gives back the same name).
export async function freeName(db, except = null, rand = Math.random) {
  for (let i = 0; i < 40; i++) {
    const a = "adj:" + Math.floor(rand() * NAME_ADJECTIVES.length), b = "noun:" + Math.floor(rand() * NAME_NOUNS.length);
    if (except && except.a === a && except.b === b) continue;
    if (!(await db.prepare("SELECT 1 AS x FROM players WHERE name_a = ? AND name_b = ?").bind(a, b).first())) return { a, b };
  }
  return null;
}
