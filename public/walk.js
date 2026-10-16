// Turning and walking, as in 4Dungeon. Turning is free. A step goes through the door you face. Stepping into a LOCKED
// door unlocks it with the day's key (the server decides: `step` only says which door); you stay where you are, and
// walking through the open door is a separate, free step. A wall or a sealed door only says so.
import { LEFT, RIGHT, WORD } from "./screen.js";

const SEALED = ["The door is jammed shut. It won't open now.", "Something settled behind this door. It will not move.", "The frame has seized. This way is closed for good."];

export function turn(st, how) {
  if (!st.floor) return st;
  const facing = how === "L" ? LEFT[st.facing] : RIGHT[st.facing];
  return { ...st, facing, log: `> You turn ${how === "L" ? "left" : "right"}, to face ${WORD[facing]}.` };
}

// What is in front of you: "wall", "open", "sealed" or "locked", and the door's room number if there is one.
export function facing(st) {
  const room = st.floor.rooms[st.at], j = room.doors[st.facing];
  if (j === undefined) return { kind: "wall" };
  if (st.floor.rooms[j]) return { kind: "open", door: j };
  return { kind: st.floor.sealed && st.floor.sealed[j] ? "sealed" : "locked", door: j };
}

// A step. For a locked door the result carries `unlock: <door number>`: the caller asks the server and, if it says yes,
// opens that door and logs it. Nothing else moves.
export function step(st, pick = (a) => a[Math.floor(Math.random() * a.length)]) {
  if (!st.floor) return st;
  const f = facing(st);
  if (f.kind === "wall") return { ...st, log: "> A wall." };
  if (f.kind === "sealed") return { ...st, log: "> " + pick(SEALED) };
  if (f.kind === "locked") return { ...st, unlock: f.door };
  const visited = st.visited.slice(); visited[f.door] = true;
  return { ...st, at: f.door, visited, log: `> You walk ${WORD[st.facing]}.` };
}
