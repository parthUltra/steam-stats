/**
 * A cache file that exists but cannot be parsed must never produce a 500 and
 * must never be overwritten: every route answers with a typed condition.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { GET as getDashboard } from "@/app/api/dashboard/route";
import {
  DELETE as deleteGifts,
  GET as getGifts,
  POST as postGifts,
} from "@/app/api/gifts-received/route";
import {
  GET as getRefresh,
  POST as postRefresh,
} from "@/app/api/refresh-prices/route";

const saved = {
  root: process.env.STEAM_STATS_ROOT,
  offline: process.env.STEAM_STATS_OFFLINE,
};
let root: string;
const GARBAGE = '{"updatedAt":"2026-08-17","quotes":{"cel';
const dataFile = (name: string) => path.join(root, "data", name);

const mutation = (method: string, pathname: string, body?: unknown) =>
  new Request(`http://127.0.0.1:3000${pathname}`, {
    method,
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "corrupt-cache-test-"));
  process.env.STEAM_STATS_ROOT = root;
  process.env.STEAM_STATS_OFFLINE = "1";
  await fs.mkdir(path.join(root, "samples", "parsed"), { recursive: true });
  await fs.writeFile(
    path.join(root, "samples", "parsed", "purchase-history.json"),
    JSON.stringify({ kind: "purchase-history", status: "ok", rows: [] }),
  );
});
beforeEach(async () => {
  await fs.rm(path.join(root, "data"), { recursive: true, force: true });
  await fs.mkdir(path.join(root, "data"), { recursive: true });
});
after(async () => {
  for (const [key, value] of [
    ["STEAM_STATS_ROOT", saved.root],
    ["STEAM_STATS_OFFLINE", saved.offline],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe("corrupt price-cache.json", () => {
  beforeEach(async () => {
    await fs.writeFile(dataFile("price-cache.json"), GARBAGE);
    await fs.writeFile(dataFile("price-cache.json.bak"), "{}");
  });
  const untouched = async () => {
    assert.equal(await fs.readFile(dataFile("price-cache.json"), "utf8"), GARBAGE);
    assert.equal(await fs.readFile(dataFile("price-cache.json.bak"), "utf8"), "{}");
  };

  it("GET /api/dashboard → 200 with the issue in meta.dataIssues", async () => {
    const res = await getDashboard();
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      meta: { dataIssues: { code: string; file: string; backup: string | null }[] };
    };
    assert.deepEqual(
      body.meta.dataIssues.map((i) => [i.code, i.file, i.backup]),
      [
        [
          "price-cache-unreadable",
          path.join("data", "price-cache.json"),
          path.join("data", "price-cache.json.bak"),
        ],
      ],
    );
    assert.equal(text.includes(root), false, "absolute path leaked");
    await untouched();
  });

  it("GET /api/refresh-prices → 200, says the cache is unreadable", async () => {
    const res = await getRefresh();
    assert.equal(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      running: boolean;
      cacheUnreadable?: boolean;
      dataIssue?: { code: string };
      priceCacheUpdatedAt: string | null;
    };
    assert.equal(body.cacheUnreadable, true);
    assert.equal(body.dataIssue?.code, "price-cache-unreadable");
    assert.equal(body.priceCacheUpdatedAt, null);
    assert.equal(body.running, false);
    assert.equal(text.includes(root), false, "absolute path leaked");
    await untouched();
  });

  it("POST /api/refresh-prices → 200, starts nothing, writes nothing", async () => {
    const res = await postRefresh(mutation("POST", "/api/refresh-prices", { force: true }));
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      ok: boolean;
      started: boolean;
      cacheUnreadable?: boolean;
      dataIssue?: { code: string };
    };
    assert.equal(body.ok, false);
    assert.equal(body.started, false);
    assert.equal(body.cacheUnreadable, true);
    assert.equal(body.dataIssue?.code, "price-cache-unreadable");
    await untouched();
    await assert.rejects(fs.access(path.join(root, ".price-refresh")));
  });
});

describe("corrupt gifts-received.json", () => {
  beforeEach(async () => {
    await fs.writeFile(dataFile("gifts-received.json"), GARBAGE);
  });

  it("GET /api/gifts-received → 200 with no gifts and the issue", async () => {
    const res = await getGifts();
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      gifts: unknown[];
      dataIssue?: { code: string; backup: string | null };
    };
    assert.deepEqual(body.gifts, []);
    assert.equal(body.dataIssue?.code, "received-gifts-unreadable");
    assert.equal(body.dataIssue?.backup, null);
  });

  it("DELETE /api/gifts-received → 409, the file is not replaced", async () => {
    const res = await deleteGifts(mutation("DELETE", "/api/gifts-received"));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; dataIssue?: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.dataIssue?.code, "received-gifts-unreadable");
    assert.equal(await fs.readFile(dataFile("gifts-received.json"), "utf8"), GARBAGE);
  });

  it("POST /api/gifts-received → 409 before any sync is started", async () => {
    const res = await postGifts(mutation("POST", "/api/gifts-received"));
    assert.equal(res.status, 409);
    const body = (await res.json()) as { ok: boolean; dataIssue?: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.dataIssue?.code, "received-gifts-unreadable");
    assert.equal(await fs.readFile(dataFile("gifts-received.json"), "utf8"), GARBAGE);
  });

  it("does not stop the price-refresh status route from answering", async () => {
    const res = await postRefresh(mutation("POST", "/api/refresh-prices"));
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { ok: boolean }).ok, true);
  });
});

describe("healthy files", () => {
  it("report no issue", async () => {
    const dash = (await (await getDashboard()).json()) as { meta: { dataIssues: unknown[] } };
    assert.deepEqual(dash.meta.dataIssues, []);
    const refresh = (await (await getRefresh()).json()) as { cacheUnreadable?: boolean };
    assert.equal(refresh.cacheUnreadable, undefined);
    const gifts = (await (await getGifts()).json()) as { dataIssue?: unknown };
    assert.equal(gifts.dataIssue, undefined);
  });
});
