import {
  CANARY_ITAD_KEY,
  REPO_ROOT,
  ROOT,
  SAME_ORIGIN,
  changedFiles,
  plantCanaries,
  request,
  snapshot,
  statStamp,
} from "./helpers";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";
import { GET, POST } from "../../src/app/api/itad-key/route";
import {
  InvalidItadKeyError,
  isValidItadApiKey,
  resolveItadApiKey,
  saveItadCredentials,
} from "../../src/lib/pricing/itad-credentials";
import { childEnv } from "../../src/lib/process/spawn-script";

const CRED = path.join(ROOT, "data", "itad-credentials.json");
const ENV_LOCAL = path.join(ROOT, ".env.local");
const VALID = "0123456789abcdef0123456789abcdef01234567";

const INJECTIONS = [
  `${VALID}\nNODE_OPTIONS=--import=data:text/javascript,process.exit(7)`,
  `${VALID}\r\nSTEAM_API_KEY=attacker`,
  `${VALID}\n`,
  `\n${VALID}`,
  `${VALID}\tX`,
  `${VALID} NODE_OPTIONS=--require=/tmp/x`,
  `${VALID}=x`,
  `${VALID}$&`,
  `${VALID}$(id)`,
  `${VALID}\`id\``,
  `${VALID}"`,
  `${VALID}#`,
  `${VALID}\u0000`,
  `${VALID} NODE_OPTIONS=x`,
  "short",
  "A".repeat(129),
  "",
];

before(() => plantCanaries());

test("isValidItadApiKey accepts opaque tokens only", () => {
  assert.equal(isValidItadApiKey(VALID), true);
  assert.equal(isValidItadApiKey("Abc_123-xyz_4567"), true);
  for (const bad of INJECTIONS) assert.equal(isValidItadApiKey(bad), false);
  for (const bad of [null, undefined, 42, {}, [VALID]]) {
    assert.equal(isValidItadApiKey(bad), false);
  }
});

test("POST /api/itad-key rejects every injection payload and writes nothing", async () => {
  const beforeRoot = snapshot(ROOT);
  for (const apiKey of INJECTIONS) {
    const res = await POST(request("POST", "/api/itad-key", SAME_ORIGIN, { apiKey }));
    assert.equal(res.status, 400, JSON.stringify(apiKey));
    const json = await res.json();
    assert.equal(json.ok, false);
  }
  for (const body of [{ apiKey: 123 }, { apiKey: [VALID] }, { apiKey: { a: 1 } }, {}, null, "x"]) {
    const res = await POST(request("POST", "/api/itad-key", SAME_ORIGIN, body));
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.deepEqual(changedFiles(beforeRoot, snapshot(ROOT)), []);
  assert.equal(fs.existsSync(ENV_LOCAL), false, ".env.local must not be created");
});

test("saveItadCredentials refuses a malformed key even when called directly", async () => {
  const beforeRoot = snapshot(ROOT);
  await assert.rejects(
    saveItadCredentials(`${VALID}\nNODE_OPTIONS=x`),
    InvalidItadKeyError,
  );
  assert.deepEqual(changedFiles(beforeRoot, snapshot(ROOT)), []);
});

test("a valid key is written only to data/itad-credentials.json, mode 0600", async () => {
  // Start from a deliberately world-readable file to prove it gets tightened.
  fs.chmodSync(CRED, 0o644);
  fs.chmodSync(path.join(ROOT, "data"), 0o755);
  const realEnv = statStamp(path.join(REPO_ROOT, ".env.local"));
  const realCred = statStamp(path.join(REPO_ROOT, "data", "itad-credentials.json"));
  const envBefore = { ...process.env };
  const beforeRoot = snapshot(ROOT);

  const res = await POST(
    request("POST", "/api/itad-key", SAME_ORIGIN, { apiKey: `  ${VALID}  ` }),
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes(VALID), false, "response must not echo the key");
  assert.deepEqual(JSON.parse(text), { ok: true, connected: true, message: "Key saved." });

  assert.deepEqual(changedFiles(beforeRoot, snapshot(ROOT)), [
    path.join("data", "itad-credentials.json"),
  ]);
  assert.equal(fs.existsSync(ENV_LOCAL), false, ".env.local must not be created");
  assert.equal(fs.statSync(CRED).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(ROOT, "data")).mode & 0o777, 0o700);
  assert.equal(JSON.parse(fs.readFileSync(CRED, "utf8")).apiKey, VALID);

  // Nothing outside the temp root: the real files are untouched (stat only)…
  assert.equal(statStamp(path.join(REPO_ROOT, ".env.local")), realEnv);
  assert.equal(
    statStamp(path.join(REPO_ROOT, "data", "itad-credentials.json")),
    realCred,
  );
  // …and the handler did not mutate the process environment.
  assert.deepEqual({ ...process.env }, envBefore);
});

test("the stored key wins over the environment; env is still read as a fallback", async () => {
  assert.equal(await resolveItadApiKey(), VALID);
  fs.rmSync(CRED);
  assert.equal(await resolveItadApiKey(), CANARY_ITAD_KEY);
  const saved = process.env.ISTHEREANYDEAL_API_KEY;
  process.env.ISTHEREANYDEAL_API_KEY = "bad key\nNODE_OPTIONS=x";
  try {
    assert.equal(await resolveItadApiKey(), null);
    const res = await GET();
    assert.deepEqual(await res.json(), {
      connected: false,
      appsUrl: "https://isthereanydeal.com/apps/",
    });
  } finally {
    process.env.ISTHEREANYDEAL_API_KEY = saved;
  }
});

test("child processes get an explicit minimal environment", () => {
  const env = childEnv({
    PATH: "/usr/bin",
    HOME: "/home/u",
    STEAM_STATS_ROOT: "/tmp/root",
    STEAM_STATS_OFFLINE: "1",
    ISTHEREANYDEAL_API_KEY: VALID,
    NODE_OPTIONS: "--import=data:text/javascript,process.exit(7)",
    NODE_PATH: "/tmp/evil",
    NODE_EXTRA_CA_CERTS: "/tmp/ca.pem",
    LD_PRELOAD: "/tmp/evil.so",
    DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib",
    npm_config_script_shell: "/tmp/sh",
    SOMETHING_ELSE: "x",
  });
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    HOME: "/home/u",
    STEAM_STATS_ROOT: "/tmp/root",
    STEAM_STATS_OFFLINE: "1",
    ISTHEREANYDEAL_API_KEY: VALID,
    // Allowed since the pre-merge review: a private CA / proxy has to keep
    // working in the child. It adds trusted CAs; unlike NODE_OPTIONS and
    // NODE_PATH (still dropped above) it cannot make Node load code.
    NODE_EXTRA_CA_CERTS: "/tmp/ca.pem",
  });
});
