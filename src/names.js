// Player names: two words from lists, copied from dawn-baton (engine/baton.js). A name is two word ids ("adj:3",
// "noun:7"); the pair is unique. Ids point into these lists, so only ever append new words at the END.
// The ledger never holds a name: it holds player ids in its own private column, and names are looked up when shown.
export const NAME_ADJECTIVES = [
  "Quiet", "Amber", "Early", "Gentle", "Bright", "Sleepy", "Golden", "Misty", "Rosy", "Brisk",
  "Hushed", "Warm", "Pale", "Slow", "Steady", "Wandering", "Soft", "Silver", "Crisp", "Drowsy",
  "Humble", "Eager", "Lucky", "Patient", "Little", "Cheerful", "Faint", "Glowing", "Distant", "Tender",
  "Rested", "Windy", "Dewy", "Calm", "Merry", "Shy", "Nimble", "Sunny", "Mellow", "Dappled",
];
export const NAME_NOUNS = [
  "Heron", "Lantern", "Sparrow", "Kettle", "Meadow", "Thistle", "Harbor", "Wren", "Compass", "Fern",
  "Moth", "Orchard", "Ferry", "Pebble", "Robin", "Willow", "Teapot", "Comet", "Lark", "Cedar",
  "Beacon", "Marmot", "Otter", "Clover", "Ember", "Finch", "Tide", "Bramble", "Lamp", "Poppy",
  "Swallow", "Sundial", "Quill", "Hedgehog", "Trellis", "Rooster", "Weathervane", "Kingfisher", "Pigeon", "Lighthouse",
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
