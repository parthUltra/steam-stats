import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { CorruptJsonFileError } from "@/lib/data/json-store";
import {
  clearReceivedGifts,
  importReceivedGiftsFromText,
  loadReceivedGifts,
  markMailSynced,
} from "./received-store";

const savedRoot = process.env.STEAM_STATS_ROOT;
let root: string;
let file: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "gifts-test-"));
  file = path.join(root, "data", "gifts-received.json");
  process.env.STEAM_STATS_ROOT = root;
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
after(() => {
  if (savedRoot === undefined) delete process.env.STEAM_STATS_ROOT;
  else process.env.STEAM_STATS_ROOT = savedRoot;
});

const mail = (title: string, friend: string) =>
  [
    `Subject: You've received a gift copy of the game ${title} on Steam`,
    "",
    `Your friend ${friend} has given you ${title} on Steam.`,
  ].join("\n");

describe("received gifts store", () => {
  it("is empty when the file does not exist", async () => {
    assert.deepEqual((await loadReceivedGifts()).gifts, []);
  });

  it("throws on a truncated file and never writes over it", async () => {
    const truncated = '{"updatedAt":"2026-01-01T00:00:00.000Z","gifts":[{"title":"Alpha Quest"';
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, truncated);

    await assert.rejects(loadReceivedGifts(), CorruptJsonFileError);
    await assert.rejects(
      importReceivedGiftsFromText(mail("Beta Racer", "friendB")),
      CorruptJsonFileError,
    );
    await assert.rejects(markMailSynced(), CorruptJsonFileError);
    await assert.rejects(clearReceivedGifts(), CorruptJsonFileError);
    assert.equal(await fs.readFile(file, "utf8"), truncated);
  });

  it(
    "creates data/ 0700 and writes the store 0600",
    { skip: process.platform === "win32" },
    async () => {
      await importReceivedGiftsFromText(mail("Alpha Quest", "friendA"));
      await markMailSynced();
      const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;
      assert.equal(await mode(path.dirname(file)), 0o700);
      assert.equal(await mode(file), 0o600);
      assert.equal(await mode(`${file}.bak`), 0o600);
    },
  );

  it("keeps every gift when imports and a sync stamp interleave", async () => {
    const titles = ["Alpha Quest", "Beta Racer", "Gamma Tactics", "Delta Farm"];
    await Promise.all([
      ...titles.map((t, i) => importReceivedGiftsFromText(mail(t, `friend${i}`))),
      markMailSynced("2026-03-01T00:00:00.000Z"),
    ]);
    const store = await loadReceivedGifts();
    assert.deepEqual(store.gifts.map((g) => g.title).sort(), [...titles].sort());
    assert.equal(store.lastMailSyncedAt, "2026-03-01T00:00:00.000Z");
    // atomic writes leave only the file and its backup behind
    assert.deepEqual((await fs.readdir(path.dirname(file))).sort(), [
      "gifts-received.json",
      "gifts-received.json.bak",
    ]);
  });
});
