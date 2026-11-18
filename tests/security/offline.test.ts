import { ROOT, SAME_ORIGIN, plantCanaries, request } from "./helpers";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { before, mock, test } from "node:test";
import * as gifts from "../../src/app/api/gifts-received/route";
import * as refresh from "../../src/app/api/refresh-prices/route";
import { spawnDetachedScript } from "../../src/lib/process/spawn-script";
import { OfflineError } from "../../src/lib/runtime";

before(() => plantCanaries());

function spies() {
  const fake = () => {
    throw new Error("a child process was started in offline mode");
  };
  return [
    mock.method(childProcess, "spawn", fake),
    mock.method(childProcess, "exec", fake),
    mock.method(childProcess, "execFile", fake),
    mock.method(childProcess, "fork", fake),
  ];
}

test("the gate itself runs offline", () => {
  assert.equal(process.env.STEAM_STATS_OFFLINE, "1");
});

test("spawnDetachedScript refuses to spawn when offline", (t) => {
  const s = spies();
  t.after(() => mock.restoreAll());
  assert.throws(() => spawnDetachedScript("scripts/refresh-prices.ts"), OfflineError);
  assert.throws(() => spawnDetachedScript("scripts/sync-gifts-gmail.ts"), OfflineError);
  for (const spy of s) assert.equal(spy.mock.callCount(), 0);
});

test("spawnDetachedScript only starts allow-listed scripts", (t) => {
  const s = spies();
  t.after(() => {
    mock.restoreAll();
    process.env.STEAM_STATS_OFFLINE = "1";
  });
  // Even "online", an arbitrary path is refused before anything is spawned.
  process.env.STEAM_STATS_OFFLINE = "0";
  for (const p of ["scripts/launch.sh", "../evil.ts", "/tmp/evil.ts", ""]) {
    assert.throws(() => spawnDetachedScript(p), /allow-list/);
  }
  for (const spy of s) assert.equal(spy.mock.callCount(), 0);
});

test("POST /api/refresh-prices {force:true} starts nothing offline", async (t) => {
  const s = spies();
  t.after(() => mock.restoreAll());
  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network used in offline mode");
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
  });

  for (const body of [{ force: true }, { restart: true }, {}]) {
    const res = await refresh.POST(
      request("POST", "/api/refresh-prices", SAME_ORIGIN, body),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.started, false);
    assert.equal(json.offline, true);
  }
  for (const spy of s) assert.equal(spy.mock.callCount(), 0);
  assert.equal(fetches, 0);
  assert.equal(fs.existsSync(path.join(ROOT, ".price-refresh", "refresh.pid")), false);
});

test("POST /api/gifts-received starts no browser offline", async (t) => {
  const s = spies();
  t.after(() => mock.restoreAll());
  const res = await gifts.POST(request("POST", "/api/gifts-received", SAME_ORIGIN));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { ok: false, error: "offline" });
  for (const spy of s) assert.equal(spy.mock.callCount(), 0);
  assert.equal(fs.existsSync(path.join(ROOT, ".gmail-session", "sync.pid")), false);
  assert.equal(
    fs.existsSync(path.join(ROOT, ".gmail-session", "browser-profile")),
    false,
  );
});
