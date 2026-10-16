// Passkeys (WebAuthn), tested with a software authenticator built from raw bytes and WebCrypto. Nothing here calls
// the code under test to build its inputs: the CBOR, the authenticator data and the signatures are made by hand,
// so the checks in src/passkeys.js are really being tried.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { makeEnv, browser } from "./helpers.mjs";

const ORIGIN = "https://irl.example", RPID = "irl.example";
const { subtle } = webcrypto;
const sha = (b) => createHash("sha256").update(b).digest();
const b64u = (b) => Buffer.from(b).toString("base64url");
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

// A tiny CBOR writer: unsigned and negative ints, byte strings, text and maps (all WebAuthn needs here).
const cborHead = (major, n) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
function cbor(v) {
  if (typeof v === "number") return v >= 0 ? cborHead(0, v) : cborHead(1, -1 - v);
  if (typeof v === "string") { const b = Buffer.from(v); return Buffer.concat([cborHead(3, b.length), b]); }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([cborHead(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([cborHead(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error("cbor: unsupported");
}

// WebCrypto signs ES256 as raw r||s; WebAuthn sends it DER-encoded.
function rawToDer(raw) {
  const int = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; let v = b.subarray(i); if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0]), v]); return Buffer.concat([Buffer.from([2, v.length]), v]); };
  const body = Buffer.concat([int(raw.subarray(0, 32)), int(raw.subarray(32))]);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

async function authenticator() {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const jwk = await subtle.exportKey("jwk", kp.publicKey);
  const credId = Buffer.from(webcrypto.getRandomValues(new Uint8Array(16)));
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
  const flags = (up) => (up ? 1 : 0) | 4;                                   // user present + user verified
  let counter = 0;
  return {
    id: b64u(credId), privateKey: kp.privateKey,
    register(challenge, { origin = ORIGIN, rpId = RPID, up = true, type = "webauthn.create" } = {}) {
      const authData = Buffer.concat([sha(rpId), Buffer.from([flags(up) | 64]), u32(0), Buffer.alloc(16), u16(credId.length), credId, cbor(cose)]);
      return { id: b64u(credId), response: {
        clientDataJSON: b64u(JSON.stringify({ type, challenge, origin })),
        attestationObject: b64u(cbor(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))) } };
    },
    async login(challenge, { origin = ORIGIN, rpId = RPID, up = true, count, key = kp.privateKey, type = "webauthn.get", id } = {}) {
      const authData = Buffer.concat([sha(rpId), Buffer.from([flags(up)]), u32(count ?? ++counter)]);
      const clientData = Buffer.from(JSON.stringify({ type, challenge, origin }));
      const sig = Buffer.from(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, Buffer.concat([authData, sha(clientData)])));
      return { id: id ?? b64u(credId), response: { clientDataJSON: b64u(clientData), authenticatorData: b64u(authData), signature: b64u(rawToDer(sig)) } };
    },
  };
}

// A player with one registered passkey, plus the authenticator that holds it.
async function registered(env, ip) {
  const auth = await authenticator(), me = browser(env, { ip });
  const opts = (await me("/api/passkey", { action: "register_options" })).data;
  const reg = await me("/api/passkey", { action: "register", label: "test key", credential: auth.register(opts.challenge) });
  return { auth, me, reg };
}
const challengeFor = async (env, ip = "203.0.113.50") => {
  const b = browser(env, { ip });
  return { b, challenge: (await b("/api/passkey", { action: "login_options" })).data.challenge };
};
const attempt = async (env, cred, ip) => { const b = browser(env, { ip }); const r = await b("/api/passkey", { action: "login", credential: cred }); return { ...r, b }; };
const passkeyRows = (env) => env.DB.raw.prepare("SELECT * FROM passkeys").all();

test("a passkey registers, and then logs a fresh browser in as the same player", async () => {
  const env = makeEnv(); const { auth, me, reg } = await registered(env);
  assert.equal(reg.status, 200); assert.deepEqual(reg.data, { ok: true });
  assert.equal((await me("/api/account")).data.passkeys.length, 1);
  const { b, challenge } = await challengeFor(env);
  const r = await b("/api/passkey", { action: "login", credential: await auth.login(challenge) });
  assert.equal(r.status, 200);
  const acct = (await b("/api/account")).data;
  assert.equal(acct.player, true); assert.equal(acct.passkeys.length, 1); assert.equal(acct.devices, 2);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM players").get().n, 1);
});

test("a random or missing challenge is refused", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  for (const challenge of [b64u(webcrypto.getRandomValues(new Uint8Array(32))), "", "x"]) {
    const r = await attempt(env, await auth.login(challenge));
    assert.equal(r.status, 400); assert.equal(r.headers.get("set-cookie"), null);
  }
});

test("a challenge works once: replaying a good login is refused, even when the counter is 0", async () => {
  // Synced passkeys (iCloud, Google, password managers) always send a counter of 0, so the counter check is off for
  // them and the single-use challenge is the only thing stopping a replay. This test isolates it.
  const env = makeEnv(); const { auth } = await registered(env);
  const { challenge } = await challengeFor(env), cred = await auth.login(challenge, { count: 0 });
  assert.equal((await attempt(env, cred)).status, 200);
  const replay = await attempt(env, cred);
  assert.equal(replay.status, 400); assert.equal(replay.headers.get("set-cookie"), null);
});

test("a challenge past its time is refused", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  const { challenge } = await challengeFor(env);
  env.DB.raw.prepare("UPDATE passkey_challenges SET expires_at = 1").run();
  assert.equal((await attempt(env, await auth.login(challenge))).status, 400);
});

test("someone else's key can't sign in as the player, even naming the right passkey", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  const attacker = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  const { challenge } = await challengeFor(env);
  const r = await attempt(env, await auth.login(challenge, { key: attacker.privateKey }));
  assert.equal(r.status, 400); assert.equal(r.headers.get("set-cookie"), null);
});

test("an answer made for another site or another page is refused", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  for (const opts of [{ origin: "https://evil.example" }, { rpId: "evil.example" }, { origin: "http://irl.example" }]) {
    const { challenge } = await challengeFor(env);
    assert.equal((await attempt(env, await auth.login(challenge, opts))).status, 400, JSON.stringify(opts));
  }
});

test("the wrong kind of ceremony is refused (a create answer can't log in)", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  const { challenge } = await challengeFor(env);
  assert.equal((await attempt(env, await auth.login(challenge, { type: "webauthn.create" }))).status, 400);
});

test("a login without the user being present is refused", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  const { challenge } = await challengeFor(env);
  assert.equal((await attempt(env, await auth.login(challenge, { up: false }))).status, 400);
});

test("a passkey that was never registered is refused", async () => {
  const env = makeEnv(); await registered(env);
  const stranger = await authenticator(), { challenge } = await challengeFor(env);
  assert.equal((await attempt(env, await stranger.login(challenge))).status, 400);
});

test("a counter that doesn't move forward (a copied key) is refused; one that does is fine", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  const go = async (count) => attempt(env, await auth.login((await challengeFor(env)).challenge, { count }));
  assert.equal((await go(5)).status, 200);
  assert.equal((await go(5)).status, 400);
  assert.equal((await go(3)).status, 400);
  assert.equal((await go(6)).status, 200);
  assert.equal(passkeyRows(env)[0].sign_count, 6);
});

test("a challenge handed out for one purpose can't be used for the other", async () => {
  const env = makeEnv(); const { auth } = await registered(env);
  // a login challenge used to register another key
  const { challenge: loginChallenge } = await challengeFor(env);
  const other = await authenticator(), me = browser(env, { ip: "203.0.113.77" });
  await me("/api/passkey", { action: "register_options" });
  assert.equal((await me("/api/passkey", { action: "register", credential: other.register(loginChallenge) })).status, 400);
  // a register challenge used to log in
  const regChallenge = (await browser(env, { ip: "203.0.113.78" })("/api/passkey", { action: "register_options" })).data.challenge;
  assert.equal((await attempt(env, await auth.login(regChallenge))).status, 400);
  assert.equal(passkeyRows(env).length, 1);
});

test("a registration challenge belongs to the player it was issued to", async () => {
  const env = makeEnv(); const a = browser(env, { ip: "203.0.113.31" }), b = browser(env, { ip: "203.0.113.32" });
  const aOpts = (await a("/api/passkey", { action: "register_options" })).data;
  await b("/api/passkey", { action: "register_options" });                   // b is a player too
  const thief = await authenticator();
  const r = await b("/api/passkey", { action: "register", credential: thief.register(aOpts.challenge) });
  assert.equal(r.status, 400);
  assert.equal(passkeyRows(env).length, 0);
});

test("registering needs a real challenge, the right origin and a finished passkey", async () => {
  const env = makeEnv(), me = browser(env), auth = await authenticator();
  const challenge = async () => (await me("/api/passkey", { action: "register_options" })).data.challenge;
  const post = async (cred) => (await me("/api/passkey", { action: "register", credential: cred })).status;
  assert.equal(await post(auth.register("made-up-challenge")), 400);
  assert.equal(await post(auth.register(await challenge(), { origin: "https://evil.example" })), 400);
  assert.equal(await post(auth.register(await challenge(), { rpId: "evil.example" })), 400);
  assert.equal(await post(auth.register(await challenge(), { up: false })), 400);
  assert.equal(await post(auth.register(await challenge(), { type: "webauthn.get" })), 400);
  assert.equal(await post(undefined), 400);
  assert.equal(await post({ id: "x", response: {} }), 400);
  assert.equal(passkeyRows(env).length, 0);
  assert.equal(await post(auth.register(await challenge())), 200);          // and the honest one still works
});

test("the same passkey can't be saved twice", async () => {
  const env = makeEnv(); const { auth, me } = await registered(env);
  const opts = (await me("/api/passkey", { action: "register_options" })).data;
  assert.equal((await me("/api/passkey", { action: "register", credential: auth.register(opts.challenge) })).status, 400);
  assert.equal(passkeyRows(env).length, 1);
});

test("you can only remove your own passkeys", async () => {
  const env = makeEnv(); const { me } = await registered(env, "203.0.113.41");
  const id = passkeyRows(env)[0].id;
  const other = browser(env, { ip: "203.0.113.42" }); await other("/api/codes", { action: "new" });
  assert.equal((await other("/api/passkey", { action: "remove", id })).status, 404);
  assert.equal((await browser(env, { ip: "203.0.113.43" })("/api/passkey", { action: "remove", id })).status, 401);
  assert.equal(passkeyRows(env).length, 1);
  assert.equal((await me("/api/passkey", { action: "remove", id })).status, 200);
  assert.equal(passkeyRows(env).length, 0);
});

test("trying passkey logins is rate limited per address", async () => {
  const env = makeEnv(), me = browser(env, { ip: "198.51.100.90" });
  for (let i = 0; i < 20; i++) assert.equal((await me("/api/passkey", { action: "login_options" })).status, 200);
  assert.equal((await me("/api/passkey", { action: "login_options" })).status, 429);
});

test("only ten passkeys per player", async () => {
  const env = makeEnv(), me = browser(env);
  for (let i = 0; i < 10; i++) {
    const a = await authenticator(), o = (await me("/api/passkey", { action: "register_options" })).data;
    assert.equal((await me("/api/passkey", { action: "register", credential: a.register(o.challenge) })).status, 200);
  }
  const a = await authenticator(), o = (await me("/api/passkey", { action: "register_options" })).data;
  assert.equal((await me("/api/passkey", { action: "register", credential: a.register(o.challenge) })).status, 400);
  assert.equal(passkeyRows(env).length, 10);
});
