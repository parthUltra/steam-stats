import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { resolveItadApiKey } from "@/lib/pricing/itad-credentials";
import { loadLocalEnv } from "./load-env";

const NAMES = [
  "STEAM_STATS_ROOT",
  "ISTHEREANYDEAL_API_KEY",
  "ITAD_API_KEY",
  "STEAM_STATS_OFFLINE",
  "NODE_OPTIONS",
  "SOME_OTHER_SETTING",
] as const;
const saved = Object.fromEntries(NAMES.map((k) => [k, process.env[k]]));
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "load-env-test-"));
  for (const k of NAMES) delete process.env[k];
  // data root with no stored key, so only the environment can supply one
  process.env.STEAM_STATS_ROOT = dir;
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});
after(() => {
  for (const k of NAMES) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const KEY = "synthetic-test-key-0123456789";

describe("loadLocalEnv", () => {
  it("makes an ITAD key in .env.local visible to a terminal script", async () => {
    assert.equal(await resolveItadApiKey(), null);
    await fs.writeFile(
      path.join(dir, ".env.local"),
      `# comment\nISTHEREANYDEAL_API_KEY=${KEY}\nSTEAM_STATS_OFFLINE="1"\n`,
    );
    const loaded = loadLocalEnv(dir);
    assert.deepEqual(loaded.sort(), ["ISTHEREANYDEAL_API_KEY", "STEAM_STATS_OFFLINE"]);
    assert.equal(process.env.STEAM_STATS_OFFLINE, "1");
    assert.equal(await resolveItadApiKey(), KEY);
  });

  it("a key saved in the app still wins over the file", async () => {
    await fs.writeFile(path.join(dir, ".env.local"), `ISTHEREANYDEAL_API_KEY=${KEY}\n`);
    await fs.mkdir(path.join(dir, "data"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "data", "itad-credentials.json"),
      JSON.stringify({ apiKey: "stored-key-0123456789abcdef", updatedAt: "x" }),
    );
    loadLocalEnv(dir);
    assert.equal(await resolveItadApiKey(), "stored-key-0123456789abcdef");
  });

  it("never overrides a variable that is already set", async () => {
    process.env.ISTHEREANYDEAL_API_KEY = "from-the-shell-0123456789";
    await fs.writeFile(path.join(dir, ".env.local"), `ISTHEREANYDEAL_API_KEY=${KEY}\n`);
    assert.deepEqual(loadLocalEnv(dir), []);
    assert.equal(process.env.ISTHEREANYDEAL_API_KEY, "from-the-shell-0123456789");
  });

  it("takes only this app's settings: nothing that makes Node load code", async () => {
    await fs.writeFile(
      path.join(dir, ".env.local"),
      `NODE_OPTIONS=--require /tmp/evil.js\nSOME_OTHER_SETTING=x\nITAD_API_KEY=${KEY}\n`,
    );
    assert.deepEqual(loadLocalEnv(dir), ["ITAD_API_KEY"]);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    assert.equal(process.env.SOME_OTHER_SETTING, undefined);
  });

  it("does nothing when there is no env file", () => {
    assert.deepEqual(loadLocalEnv(dir), []);
  });
});
