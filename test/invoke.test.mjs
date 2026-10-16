import test from "node:test";
import assert from "node:assert/strict";
import { invokeLines } from "../public/invoke.js";
import { foundLines } from "../public/found.js";
import { renderScreen } from "../public/screen.js";
import { arrive } from "../public/play.js";

const strip = (s) => s.split("\n");
test("the bottom menu: TURN [A] [D], [I]NVOKE, [L]OCATE, [S]AVE; no ARROWS and no WALK", () => {
  const rows = strip(renderScreen({ ...arrive("8a464b96ab2ffff"), loaded: true }, new Date(Date.UTC(2026, 9, 16, 22))));
  const menu = rows[rows.length - 2];
  assert.equal(menu.length, 80);
  assert.equal(menu.replace(/\s+/g, " "), "| TURN: [A] [D] [I]NVOKE [L]OCATE [S]AVE |");
  assert.doesNotMatch(menu, /ARROWS|WALK|OR UP/);
});
test("with no cell yet the menu is only the buttons that work", () => {
  const rows = strip(renderScreen({}, new Date(Date.UTC(2026, 9, 16, 22))));
  assert.equal(rows[rows.length - 2].replace(/\s+/g, " "), "| [L]OCATE [S]AVE |");
});
test("INVOKE lists finds with rarity, type and copy number; with none it says how to find something", () => {
  assert.deepEqual(invokeLines([]), ["Nothing yet.", "Press into a wall to search it."]);
  assert.deepEqual(invokeLines([{ copy: 3, item: { name: "a spent battery", rarity: "common", type: null } }, { copy: 1, item: { name: "Bodacious", rarity: "common", type: "neon" } }]),
    ["a spent battery   COMMON  #3", "Bodacious   COMMON NEON  #1"]);
});
test("a find still waiting for its number lists without one (never '#null')", () => {
  assert.deepEqual(invokeLines([{ copy: null, item: { name: "a spent battery", rarity: "common", type: null } }]), ["a spent battery   COMMON"]);
});
test("the find window says You found <name>! with rarity, copy and note", () => {
  assert.deepEqual(foundLines({ name: "a spent battery", rarity: "common", copy: 2, note: "Still faintly warm." }), ["You found a spent battery!", "", "COMMON   COPY #2", "", "Still faintly warm."]);
  assert.deepEqual(foundLines({ name: "Bodacious", rarity: "uncommon", type: "neon", copy: null, note: null }), ["You found Bodacious!", "", "UNCOMMON NEON"]);
});
