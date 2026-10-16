// Turning and walking, as in 4Dungeon: turning is free, and a step goes through the door you face. Only built rooms
// can be walked into; a locked door stays shut (unlocking needs the day's key, which the server will hand out).
import { LEFT, RIGHT, WORD } from "./screen.js";

export function turn(st, how) {
  if (!st.floor) return st;
  const facing = how === "L" ? LEFT[st.facing] : RIGHT[st.facing];
  return { ...st, facing, log: `> You turn ${how === "L" ? "left" : "right"}, to face ${WORD[facing]}.` };
}

export function step(st) {
  if (!st.floor) return st;
  const room = st.floor.rooms[st.at], j = room.doors[st.facing];
  if (j === undefined) return { ...st, log: "> A wall." };
  const next = st.floor.rooms[j];
  if (!next) return { ...st, log: "> The door is locked." };
  const visited = st.visited.slice(); visited[j] = true;
  return { ...st, at: j, visited, log: `> You walk ${WORD[st.facing]}.` };
}
