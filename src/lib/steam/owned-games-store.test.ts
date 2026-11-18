import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import type { PlayedGame } from "@/lib/account-data";
import { saveOwnedGamesSnapshot } from "./owned-games-store";

const savedRoot = process.env.STEAM_STATS_ROOT;
let root: string;
let file: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "owned-store-test-"));
  process.env.STEAM_STATS_ROOT = root;
  file = path.join(root, "samples", "parsed", "games-played.json");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
after(() => {
  if (savedRoot === undefined) delete process.env.STEAM_STATS_ROOT;
  else process.env.STEAM_STATS_ROOT = savedRoot;
});

const game = (appId: number): PlayedGame => ({
  appId,
  name: `Game ${appId}`,
  hoursForever: 1,
  hours2Weeks: null,
  lastPlayedText: null,
  lastPlayedAt: null,
  minutesForever: 60,
});
const read = async () => JSON.parse(await fs.readFile(file, "utf8"));
const NOW = "2026-11-18T10:00:00.000Z";

describe("saveOwnedGamesSnapshot", () => {
  it("writes the library with its source and fetch time", async () => {
    const out = await saveOwnedGamesSnapshot(
      { steamId: "76561197960265728", games: [game(1), game(2)] },
      NOW,
    );
    assert.deepEqual(out, { written: true, games: 2, path: file });
    assert.deepEqual(await read(), {
      steamId: "76561197960265728",
      source: "steam-session-api",
      fetchedAt: NOW,
      games: [game(1), game(2)],
    });
    // owner-only, and no temp file left behind
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await fs.readdir(path.dirname(file)), ["games-played.json"]);
  });

  it("keeps a saved non-empty library when Steam answers with no games", async () => {
    await saveOwnedGamesSnapshot({ steamId: "1", games: [game(1)] }, "2026-08-17T00:00:00.000Z");
    const before = await fs.readFile(file, "utf8");
    const out = await saveOwnedGamesSnapshot({ steamId: "1", games: [] }, NOW);
    assert.equal(out.written, false);
    assert.match(out.reason ?? "", /empty/i);
    assert.equal(await fs.readFile(file, "utf8"), before);
  });

  it("writes an empty library when there is nothing saved to protect", async () => {
    const out = await saveOwnedGamesSnapshot({ steamId: "1", games: [] }, NOW);
    assert.equal(out.written, true);
    assert.deepEqual((await read()).games, []);
  });

  it("replaces an unreadable or empty saved file", async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{ not json");
    const out = await saveOwnedGamesSnapshot({ steamId: "1", games: [game(3)] }, NOW);
    assert.equal(out.written, true);
    assert.equal((await read()).games.length, 1);
  });
});
