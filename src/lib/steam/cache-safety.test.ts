import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { CorruptJsonFileError } from "@/lib/data/json-store";
import { loadArtworkCache, resolveArtworkForAppIds } from "./artwork-resolve";
import { readDlcParents, resolveDlcParents } from "./dlc-parents";

const realFetch = globalThis.fetch;
const realWarn = console.warn;
const savedRoot = process.env.STEAM_STATS_ROOT;
let root: string;
const dataFile = (name: string) => path.join(root, "data", name);

function stubJson(handler: (url: URL) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL) =>
    new Response(JSON.stringify(handler(new URL(String(input)))), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "steam-cache-test-"));
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  process.env.STEAM_STATS_ROOT = root;
  delete process.env.STEAM_STATS_OFFLINE;
  console.warn = () => undefined;
});
afterEach(async () => {
  globalThis.fetch = realFetch;
  console.warn = realWarn;
  await fs.rm(root, { recursive: true, force: true });
});
after(() => {
  if (savedRoot === undefined) delete process.env.STEAM_STATS_ROOT;
  else process.env.STEAM_STATS_ROOT = savedRoot;
});

describe("artwork cache", () => {
  const storeItems = (url: URL) => {
    const input = JSON.parse(url.searchParams.get("input_json")!) as {
      ids: { appid: number }[];
    };
    return {
      response: {
        store_items: input.ids.map(({ appid }) => ({
          appid,
          assets: {
            asset_url_format: `steam/apps/${appid}/\${FILENAME}`,
            header: "header.jpg",
          },
        })),
      },
    };
  };

  it("does not save over a truncated file; the read path degrades", async () => {
    const truncated = '{"version":2,"updatedAt":"x","byAppId":{"10":{"library":';
    await fs.writeFile(dataFile("artwork-cache.json"), truncated);
    stubJson(storeItems);

    assert.deepEqual((await loadArtworkCache()).byAppId, {});
    await assert.rejects(resolveArtworkForAppIds([10]), CorruptJsonFileError);
    assert.equal(
      await fs.readFile(dataFile("artwork-cache.json"), "utf8"),
      truncated,
    );
  });

  it("keeps entries written by another process during a resolve", async () => {
    stubJson((url) => {
      // another writer lands while this resolve is waiting on the network
      const other = {
        version: 2,
        updatedAt: "2026-01-01T00:00:00.000Z",
        byAppId: {
          "999": {
            library: "l",
            header: "h",
            capsule: "c",
            hashed: true,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      };
      writeFileSync(dataFile("artwork-cache.json"), JSON.stringify(other));
      return storeItems(url);
    });
    await resolveArtworkForAppIds([10]);
    const disk = await loadArtworkCache();
    assert.deepEqual(Object.keys(disk.byAppId).sort(), ["10", "999"]);
  });
});

describe("dlc-parents cache", () => {
  it("does not save over a truncated file; the read path degrades", async () => {
    const truncated = '{"updatedAt":"2026-01-01T00:00:00.000Z","parents":{"20":';
    await fs.writeFile(dataFile("dlc-parents.json"), truncated);
    stubJson(() => ({ "20": { success: true, data: { type: "game" } } }));

    assert.equal((await readDlcParents([20])).size, 0);
    await assert.rejects(resolveDlcParents([20]), CorruptJsonFileError);
    assert.equal(
      await fs.readFile(dataFile("dlc-parents.json"), "utf8"),
      truncated,
    );
  });

  it("merges with answers another process stored meanwhile", async () => {
    stubJson((url) => {
      writeFileSync(
        dataFile("dlc-parents.json"),
        JSON.stringify({
          updatedAt: "2026-01-01T00:00:00.000Z",
          parents: { "31": 30 },
          notDlc: ["40"],
        }),
      );
      const id = url.searchParams.get("appids")!;
      return {
        [id]: { success: true, data: { type: "dlc", fullgame: { appid: "50" } } },
      };
    });
    const parents = await resolveDlcParents([51]);
    assert.equal(parents.get(51), 50);
    const disk = JSON.parse(
      await fs.readFile(dataFile("dlc-parents.json"), "utf8"),
    ) as { parents: Record<string, number>; notDlc: string[] };
    assert.deepEqual(disk.parents, { "31": 30, "51": 50 });
    assert.deepEqual(disk.notDlc, ["40"]);
  });
});
