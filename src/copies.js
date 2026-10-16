// Numbering a find. Every find is a numbered copy ("#4821"), and the numbers come from the shared registry (the
// `Registry` entrypoint of the dungeon-items Worker, bound here as REGISTRY), so a number is never used twice by any
// game. This game never writes to the item database itself.
//
// A find is saved first, with no number, and numbered a moment later. The registry's key for the copy is the find's own
// row id ("irl-find:<id>"): it holds no cell, room or day, and asking twice for the same find gives the same copy, so a
// retry can never make a second one. If the registry can't answer (down, busy, refusing, not bound) the find stays saved
// and unnumbered; numberPending() numbers it the next time the player searches that room again or lists their finds.
//
// Nothing here throws on a registry failure. A number the database refuses (it is already on another find of that item)
// also leaves the find unnumbered rather than failing the player's request: that would be a bug worth seeing, and an
// unnumbered find shows.
import { isUnique } from "./ledger.js";

export const GAME = "irl-dungeon";
export const findKey = (id) => `irl-find:${id}`;

// Number one find ({ id, player_id, item_id }). Returns its copy number, or null if it has none yet.
export async function numberFind(env, db, find) {
  if (!env.REGISTRY) return null;
  let r;
  try { r = await env.REGISTRY.birth({ itemId: find.item_id, game: GAME, playerId: find.player_id, key: findKey(find.id) }); }
  catch { return null; }
  if (!r || r.error || !Number.isInteger(r.copy)) return null;
  try { await db.prepare("UPDATE finds SET copy = ? WHERE id = ? AND copy IS NULL").bind(r.copy, find.id).run(); }
  catch (e) { if (isUnique(e)) return null; throw e; }
  const row = await db.prepare("SELECT copy FROM finds WHERE id = ?").bind(find.id).first();
  return row ? row.copy : null;
}

// Number this player's finds that are still waiting (oldest first, at most `limit`). Returns how many were waiting.
export async function numberPending(env, db, playerId, limit = 20) {
  const { results } = await db.prepare("SELECT id, player_id, item_id FROM finds WHERE player_id = ? AND copy IS NULL ORDER BY id LIMIT ?").bind(playerId, limit).all();
  for (const f of results) await numberFind(env, db, f);
  return results.length;
}
