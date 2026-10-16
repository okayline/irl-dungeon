# Browser check of the map against the real Worker: the page loads without errors, + and - switch between the room map and the AREA map
# without moving the title, and walking out of a cell plays the dots before arriving. Run by hand (not part of `npm test`):
#   python3 test/e2e/map.py        needs python3 playwright and a Chromium (set CHROMIUM=/path if not at /opt/pw-browsers/chromium)
import re, subprocess, os, sys, time
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); S = os.environ.get("SHOTS", "/tmp/")
srv = subprocess.Popen(["node", "--no-warnings", os.path.join(HERE, "serve.mjs")], stdout=subprocess.PIPE, text=True); srv.stdout.readline()
U = "http://localhost:8790/?cell=8a464b96ab2ffff"; fails = []
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name, extra)
    if not cond: fails.append(name)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium"))
    pg = b.new_context(viewport={"width": 1100, "height": 900}).new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.goto(U); pg.wait_for_timeout(700)
    check("the page loads with no script errors", not errs, str(errs))
    t = pg.inner_text("#screen"); check("the room map title is there", "MAP  [-]" in t)
    col = lambda t, pat: next(l for l in t.split("\n") if pat in l).index("[")
    c1 = col(t, "MAP  [-]"); pg.keyboard.press("+"); pg.wait_for_timeout(500)
    t = pg.inner_text("#screen"); check("+ shows the AREA map", "AREA [+]" in t and "[@]" in t)
    check("the button doesn't move", col(t, "AREA [+]") == c1)
    pg.screenshot(path=S + "area.png"); print("\n".join(l[49:] for l in t.split("\n")[6:23]))
    pg.keyboard.press("-"); pg.wait_for_timeout(300); check("- brings back the room map", "MAP  [-]" in pg.inner_text("#screen"))
    # walk out: face a wall of the first room (the way out) and step
    for _ in range(4):
        if "the way out" in pg.inner_text("#screen"): break
        pg.keyboard.press("d"); pg.wait_for_timeout(120)
    check("facing the way out", "the way out" in pg.inner_text("#screen"), pg.inner_text("#screen").split("\n")[26])
    first = [l for l in pg.inner_text("#screen").split("\n") if "THIS CELL" in l or re.search(r"[0-9a-f]{15}", l)]
    cell0 = re.search(r"[0-9a-f]{15}", pg.inner_text("#screen")).group(0)
    pg.keyboard.press("w"); seen = []; t0 = time.time()
    while time.time() - t0 < 4:
        line = pg.inner_text("#screen").split("\n")[25].strip("| ").strip()
        if not seen or seen[-1][1] != line: seen.append((round(time.time() - t0, 2), line))
        pg.wait_for_timeout(40)
    for s in seen: print(s)
    texts = [s[1] for s in seen]
    check("the dots come one at a time", any(x.endswith("hallway.") for x in texts) and any(x.endswith("hallway..") for x in texts) and any(x.endswith("hallway...") for x in texts))
    check("then you arrive in another cell", re.search(r"[0-9a-f]{15}", pg.inner_text("#screen")).group(0) != cell0)
    pg.screenshot(path=S + "arrived.png")
    check("no script errors the whole time", not errs, str(errs))
finally:
  srv.terminate()
print("FAILS:", fails); sys.exit(1 if fails else 0)
