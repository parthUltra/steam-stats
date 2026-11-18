import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  CorruptJsonFileError,
  readJsonFile,
  updateJsonFile,
  withFileLock,
  writeJsonAtomic,
} from "./json-store";

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "json-store-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("readJsonFile", () => {
  it("returns undefined when the file is missing", async () => {
    assert.equal(await readJsonFile(path.join(dir, "nope.json")), undefined);
  });

  it("throws a typed error for a truncated file", async () => {
    const file = path.join(dir, "c.json");
    await fs.writeFile(file, '{"quotes":{"a":{"title":"A"');
    await assert.rejects(readJsonFile(file), (err: unknown) => {
      assert.ok(err instanceof CorruptJsonFileError);
      assert.equal(err.filePath, file);
      assert.equal(err.backupPath, `${file}.bak`);
      return true;
    });
  });

  it("throws a typed error for an empty file", async () => {
    const file = path.join(dir, "c.json");
    await fs.writeFile(file, "");
    await assert.rejects(readJsonFile(file), CorruptJsonFileError);
  });
});

describe("writeJsonAtomic", () => {
  it("leaves no temp file behind and keeps the last good copy as .bak", async () => {
    const file = path.join(dir, "c.json");
    await writeJsonAtomic(file, { n: 1 });
    await writeJsonAtomic(file, { n: 2 }, { backup: true });
    assert.deepEqual(await readJsonFile(file), { n: 2 });
    assert.deepEqual(await readJsonFile(`${file}.bak`), { n: 1 });
    assert.deepEqual((await fs.readdir(dir)).sort(), ["c.json", "c.json.bak"]);
  });

  it("does not replace a good .bak with a corrupt current file", async () => {
    const file = path.join(dir, "c.json");
    await writeJsonAtomic(file, { n: 1 });
    await writeJsonAtomic(file, { n: 2 }, { backup: true });
    await fs.writeFile(file, '{"n":');
    await writeJsonAtomic(file, { n: 3 }, { backup: true });
    assert.deepEqual(await readJsonFile(`${file}.bak`), { n: 1 });
  });
});

describe("updateJsonFile", () => {
  it("refuses to write over a corrupt file", async () => {
    const file = path.join(dir, "c.json");
    const truncated = '{"quotes":{"a":';
    await fs.writeFile(file, truncated);
    await assert.rejects(
      updateJsonFile(file, () => ({ quotes: {} })),
      CorruptJsonFileError,
    );
    assert.equal(await fs.readFile(file, "utf8"), truncated);
    // the lock is released even though the update failed
    assert.deepEqual((await fs.readdir(dir)).sort(), ["c.json"]);
  });

  it("serialises interleaved writers so no update is lost", async () => {
    const file = path.join(dir, "c.json");
    const writers = Array.from({ length: 25 }, (_, i) =>
      updateJsonFile<Record<string, number>>(file, async (cur) => {
        // yield so the writers really interleave
        await new Promise((r) => setTimeout(r, i % 3));
        return { ...(cur ?? {}), [`k${i}`]: i };
      }),
    );
    await Promise.all(writers);
    const out = (await readJsonFile<Record<string, number>>(file))!;
    assert.equal(Object.keys(out).length, 25);
  });
});

describe("withFileLock", () => {
  it("recovers a lock left by a dead process", async () => {
    const file = path.join(dir, "c.json");
    // pid 2^31-1 is never a live process
    await fs.writeFile(
      `${file}.lock`,
      JSON.stringify({ pid: 2147483647, at: Date.now() }),
    );
    assert.equal(await withFileLock(file, async () => "ran"), "ran");
  });

  it("recovers a lock older than the stale threshold", async () => {
    const file = path.join(dir, "c.json");
    await fs.writeFile(
      `${file}.lock`,
      JSON.stringify({ pid: process.pid, at: Date.now() - 120_000 }),
    );
    assert.equal(
      await withFileLock(file, async () => "ran", { staleMs: 60_000 }),
      "ran",
    );
  });

  it("waits for a live holder instead of barging in", async () => {
    const file = path.join(dir, "c.json");
    const order: string[] = [];
    const first = withFileLock(file, async () => {
      await new Promise((r) => setTimeout(r, 60));
      order.push("first");
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = withFileLock(file, async () => {
      order.push("second");
    });
    await Promise.all([first, second]);
    assert.deepEqual(order, ["first", "second"]);
  });
});

describe("file modes", { skip: process.platform === "win32" }, () => {
  const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;

  it("writes the file, its backup and the lock owner-only (0600)", async () => {
    const file = path.join(dir, "c.json");
    await writeJsonAtomic(file, { n: 1 });
    await writeJsonAtomic(file, { n: 2 }, { backup: true });
    assert.equal(await mode(file), 0o600);
    assert.equal(await mode(`${file}.bak`), 0o600);
    await withFileLock(file, async () => {
      assert.equal(await mode(`${file}.lock`), 0o600);
    });
  });

  it("tightens a file that was world-readable before", async () => {
    const file = path.join(dir, "c.json");
    await fs.writeFile(file, '{"n":1}', { mode: 0o644 });
    await fs.chmod(file, 0o644);
    await updateJsonFile(file, () => ({ n: 2 }), { backup: true });
    assert.equal(await mode(file), 0o600);
    assert.equal(await mode(`${file}.bak`), 0o600);
  });

  it("is not loosened by a permissive umask", async () => {
    const previous = process.umask(0);
    try {
      const file = path.join(dir, "sub", "c.json");
      await writeJsonAtomic(file, { n: 1 });
      assert.equal(await mode(file), 0o600);
      assert.equal(await mode(path.dirname(file)), 0o700);
    } finally {
      process.umask(previous);
    }
  });
});
