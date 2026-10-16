// The shared item table (okayline/dungeon-items), read only. The D1 database `items-db` is bound as ITEMS; this game
// never writes to it (items are added from the dungeon-items repo). A find refers to an item by its id, which never
// changes or is reused. Retired items are not offered (listItems) but still resolve (getItem).
const COLS = "id, source, source_key, rarity, name, note, alignment, nature, type, image, extra, retired";
const shape = (r) => ({ id: r.id, source: r.source, source_key: r.source_key, rarity: r.rarity, name: r.name, note: r.note, alignment: r.alignment, nature: r.nature, type: r.type, image: r.image, extra: JSON.parse(r.extra || "{}"), retired: !!r.retired });
const table = (env) => { if (!env.ITEMS) throw new Error("The item table isn't bound (ITEMS)."); return env.ITEMS; };

// Items that can be offered now, in id order. Optional { rarity, source }.
export async function listItems(env, { rarity, source } = {}) {
  const where = ["retired = 0"], args = [];
  if (rarity) { where.push("rarity = ?"); args.push(rarity); }
  if (source) { where.push("source = ?"); args.push(source); }
  const { results } = await table(env).prepare(`SELECT ${COLS} FROM items WHERE ${where.join(" AND ")} ORDER BY id`).bind(...args).all();
  return results.map(shape);
}

// One item by id (retired ones too), or null.
export async function getItem(env, id) {
  const row = await table(env).prepare(`SELECT ${COLS} FROM items WHERE id = ?`).bind(id).first();
  return row ? shape(row) : null;
}
