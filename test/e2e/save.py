# Browser check of the SAVE screen against the real Worker: save codes, passkeys (a virtual authenticator), logout rules,
# keyboard handling. Run by hand (it is not part of `npm test`, which has no dependencies):
#   python3 test/e2e/save.py        needs python3 playwright and a Chromium (set CHROMIUM=/path if not at /opt/pw-browsers/chromium)
import re, subprocess, time, sys
from playwright.sync_api import sync_playwright
import os
HERE=os.path.dirname(os.path.abspath(__file__)); S=os.environ.get("SHOTS","/tmp/")
srv=subprocess.Popen(["node","--no-warnings",os.path.join(HERE,"serve.mjs")],stdout=subprocess.PIPE,text=True); srv.stdout.readline()
U="http://localhost:8790/?cell=8a464b96ab2ffff"; fails=[]
def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ")+name, extra); 
    if not cond: fails.append(name)
try:
  with sync_playwright() as p:
    b=p.chromium.launch(executable_path=os.environ.get("CHROMIUM","/opt/pw-browsers/chromium"))
    # device 1
    c1=b.new_context(viewport={"width":1100,"height":900}); pg=c1.new_page(); errs=[]; pg.on("pageerror",lambda e: errs.append(str(e)))
    cdp=c1.new_cdp_session(pg); cdp.send("WebAuthn.enable"); cdp.send("WebAuthn.addVirtualAuthenticator",{"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True}})
    pg.goto(U); pg.wait_for_timeout(500)
    check("menu shows [S]AVE", "[S]AVE" in pg.inner_text("#screen"))
    pg.click("[data-act=S]"); pg.wait_for_selector("#save:not([hidden])")
    t=pg.inner_text("#save"); check("panel opens, no player yet", "No player yet" in t and "SAVE CODES (0/5)" in t)
    pg.click("text=[MAKE A SAVE CODE]"); pg.wait_for_selector(".code")
    code=pg.inner_text(".code").strip(); check("a save code is shown", re.fullmatch(r"[0-9A-Z]{4}(-[0-9A-Z]{4}){4}",code) is not None, code)
    pg.click("text=[DONE]"); pg.wait_for_timeout(300)
    t=pg.inner_text("#save"); check("code listed (count 1), code no longer shown", "SAVE CODES (1/5)" in t and code not in t)
    pg.screenshot(path=S+"save1.png")
    # passkey
    pg.click("text=[ADD A PASSKEY]"); pg.wait_for_timeout(1200)
    t=pg.inner_text("#save"); check("passkey added", "PASSKEYS (1)" in t and "Passkey added." in t, t.split("PASSKEYS")[1][:60].replace("\n"," "))
    # device 2: save code
    c2=b.new_context(viewport={"width":1100,"height":900}); p2=c2.new_page(); p2.goto(U); p2.wait_for_timeout(400)
    p2.click("[data-act=S]"); p2.wait_for_selector("#save:not([hidden])")
    p2.fill(".codebox", code.lower()); p2.click("text=[USE CODE]"); p2.wait_for_timeout(600)
    t=p2.inner_text("#save"); check("second browser logs in with the code", "Logged in." in t and "PASSKEYS (1)" in t and "2 devices" in t, t[-120:].replace("\n"," "))
    p2.fill(".codebox", "AAAA-BBBB-CCCC-DDDD-EEEE"); p2.click("text=[USE CODE]"); p2.wait_for_timeout(500)
    check("a wrong code is refused", "didn't work" in p2.inner_text("#save"))
    # logout on device 2, then it has no player
    p2.click("text=[LOG OUT OF THIS BROWSER]"); p2.wait_for_timeout(500); check("logout works when a way back exists", "Logged out." in p2.inner_text("#save"))
    # device 1: forget the code (a passkey remains so logout rule not tested here), then passkey login after clearing cookies
    pg.click("text=[FORGET] >> nth=0"); pg.wait_for_timeout(500); t=pg.inner_text("#save"); check("a code can be forgotten", "SAVE CODES (0/5)" in t, "")
    c1.clear_cookies(); pg.click("text=[CLOSE]"); pg.click("[data-act=S]"); pg.wait_for_selector("#save:not([hidden])"); pg.wait_for_timeout(400)
    check("cleared cookies = no player", "No player yet" in pg.inner_text("#save"))
    pg.click("text=[LOG IN WITH A PASSKEY]"); pg.wait_for_timeout(1200)
    t=pg.inner_text("#save"); check("log in with the passkey", "Logged in." in t and "PASSKEYS (1)" in t, t[-100:].replace("\n"," "))
    # a fresh player cannot log out without a way back
    c3=b.new_context(); p3=c3.new_page(); p3.goto(U); p3.wait_for_timeout(300); p3.click("[data-act=S]"); p3.wait_for_selector("#save:not([hidden])")
    check("no logout button without a way back", "[LOG OUT" not in p3.inner_text("#save"))
    p3.keyboard.press("Escape"); p3.wait_for_timeout(200); check("Escape closes the panel", p3.is_hidden("#save"))
    # keys while open do not walk
    p3.click("[data-act=S]"); p3.wait_for_selector("#save:not([hidden])"); before=p3.inner_text("#screen"); p3.keyboard.press("w"); p3.keyboard.press("d"); p3.keyboard.press("Escape"); p3.wait_for_timeout(200)
    check("game keys are ignored while the panel is open", p3.inner_text("#screen")==before)
    check("no page errors", not errs, str(errs))
    pg.screenshot(path=S+"save2.png")
    b.close()
finally:
  srv.terminate()
print("FAILED:",fails) if fails else print("ALL PASSED")
