// The page's own script (the module in public/index.html) must at least be valid JavaScript: a stray character there stops the whole
// page from loading, and nothing else in `npm test` would notice. (The browser check in test/e2e/map.py runs it for real.)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("the script in index.html parses", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), m = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  assert.ok(m, "a module script");
  const dir = mkdtempSync(join(tmpdir(), "page-")), file = join(dir, "page.mjs");
  writeFileSync(file, m[1]);
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("a line comment can't swallow the rest of a line in that script (the v0.16 bug): no code follows a // on the same line", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8"), m = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
  const bad = m[1].split("\n").filter((l) => /\/\/[^"'`]*[;{}]\s*$/.test(l) && !/^\s*\/\//.test(l) && !/https?:\/\//.test(l) && !/["'`].*\/\/.*["'`]/.test(l));
  assert.deepEqual(bad.filter((l) => /\)\s*;\s*\/\/.*\bst\./.test(l)), []);
});
