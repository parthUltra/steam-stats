import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import {
  isPriceRefreshRunning,
  priceRefreshPidFile,
  priceRefreshStatusDir,
  priceRefreshStatusFile,
  readPriceRefreshStatus,
  stopPriceRefresh,
  writePriceRefreshPid,
  writePriceRefreshStatus,
  type ProcessInfo,
  type ProcessProbe,
} from "./price-refresh-status";

const savedRoot = process.env.STEAM_STATS_ROOT;
let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "refresh-status-test-"));
  process.env.STEAM_STATS_ROOT = root;
  delete process.env.STEAM_STATS_OFFLINE;
  await fs.mkdir(priceRefreshStatusDir(), { recursive: true });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
after(() => {
  if (savedRoot === undefined) delete process.env.STEAM_STATS_ROOT;
  else process.env.STEAM_STATS_ROOT = savedRoot;
});

const LSTART = "Tue Nov 17 20:12:03 2026";
const refreshCmd = "/usr/local/bin/node /app/node_modules/tsx/dist/cli.mjs /app/scripts/refresh-prices.ts";
/** A fake process table. */
const table =
  (rows: Record<number, ProcessInfo>): ProcessProbe =>
  async (pid) =>
    rows[pid] ?? null;
const ours = table({ 4242: { startedAt: LSTART, command: refreshCmd } });
const someoneElse = table({
  4242: { startedAt: LSTART, command: "/usr/bin/some-editor notes.txt" },
});

describe("isPriceRefreshRunning", () => {
  it("is true for our live refresh process", async () => {
    await fs.writeFile(priceRefreshPidFile(), "4242");
    await writePriceRefreshStatus({ phase: "running" });
    assert.equal(await isPriceRefreshRunning({ probe: ours }), true);
  });

  it("is false when the pid is gone, and removes the pid file", async () => {
    await fs.writeFile(priceRefreshPidFile(), "4242");
    assert.equal(await isPriceRefreshRunning({ probe: table({}) }), false);
    await assert.rejects(fs.access(priceRefreshPidFile()));
  });

  it("is false when the pid now belongs to another program", async () => {
    await fs.writeFile(priceRefreshPidFile(), "4242");
    assert.equal(await isPriceRefreshRunning({ probe: someoneElse }), false);
    await assert.rejects(fs.access(priceRefreshPidFile()));
  });

  it("is false once the script reported done after the pid was written", async () => {
    await fs.writeFile(priceRefreshPidFile(), "4242");
    const past = new Date(Date.now() - 60_000);
    await fs.utimes(priceRefreshPidFile(), past, past);
    await writePriceRefreshStatus({ phase: "done" });
    assert.equal(await isPriceRefreshRunning({ probe: ours }), false);
    await assert.rejects(fs.access(priceRefreshPidFile()));
  });

  it("is false when the pid file is implausibly old", async () => {
    await fs.writeFile(priceRefreshPidFile(), "4242");
    await writePriceRefreshStatus({ phase: "running" });
    const later = Date.now() + 7 * 60 * 60 * 1000;
    assert.equal(await isPriceRefreshRunning({ probe: ours, now: later }), false);
  });
});

describe("stopPriceRefresh", () => {
  const recorder = () => {
    const sent: [number, string][] = [];
    return { sent, kill: (pid: number, sig: NodeJS.Signals) => void sent.push([pid, sig]) };
  };

  it("signals the process group of a verified refresh process", async () => {
    await writePriceRefreshPid(4242, ours);
    const { sent, kill } = recorder();
    assert.deepEqual(await stopPriceRefresh({ probe: ours, kill }), { stopped: true });
    assert.deepEqual(sent, [[-4242, "SIGTERM"]]);
    await assert.rejects(fs.access(priceRefreshPidFile()));
  });

  it("does not signal a pid that now belongs to another program", async () => {
    await fs.writeFile(priceRefreshPidFile(), "4242");
    const { sent, kill } = recorder();
    assert.deepEqual(await stopPriceRefresh({ probe: someoneElse, kill }), {
      stopped: false,
    });
    assert.deepEqual(sent, []);
    await assert.rejects(fs.access(priceRefreshPidFile()));
  });

  it("does not signal a same-named process that started at another time", async () => {
    await writePriceRefreshPid(4242, ours);
    const restarted = table({
      4242: { startedAt: "Wed Nov 18 09:00:00 2026", command: refreshCmd },
    });
    const { sent, kill } = recorder();
    await stopPriceRefresh({ probe: restarted, kill });
    assert.deepEqual(sent, []);
  });

  it("does not signal a dead pid, pid 1, a negative pid or garbage", async () => {
    for (const content of ["4242", "1", "-4242", "0", "not a pid", '{"pid":"4242"}']) {
      await fs.writeFile(priceRefreshPidFile(), content);
      const { sent, kill } = recorder();
      // a probe that would vouch for anything: the pid itself must be sane
      const probe = content === "4242" ? table({}) : async () => ({ startedAt: LSTART, command: refreshCmd });
      await stopPriceRefresh({ probe, kill });
      assert.deepEqual(sent, [], content);
      await assert.rejects(fs.access(priceRefreshPidFile()));
    }
  });

  it("verifies real processes with ps", { skip: process.platform === "win32" }, async () => {
    const spawnIdle = (...extraArgs: string[]) =>
      spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", ...extraArgs], {
        stdio: "ignore",
        detached: true,
      });
    const exited = (child: ReturnType<typeof spawn>) =>
      new Promise<void>((resolve) => child.once("exit", () => resolve()));

    // An unrelated live process whose pid sits in the pid file: must survive.
    const bystander = spawnIdle("unrelated-job");
    try {
      await fs.writeFile(priceRefreshPidFile(), String(bystander.pid));
      assert.equal(await isPriceRefreshRunning(), false);
      await fs.writeFile(priceRefreshPidFile(), String(bystander.pid));
      assert.deepEqual(await stopPriceRefresh(), { stopped: false });
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(bystander.exitCode, null);
      assert.equal(bystander.signalCode, null);
    } finally {
      const gone = exited(bystander);
      bystander.kill("SIGKILL");
      await gone;
    }

    // A process whose command line names the refresh script: stopped.
    const refresh = spawnIdle("scripts/refresh-prices.ts");
    const gone = exited(refresh);
    try {
      await writePriceRefreshPid(refresh.pid!);
      const rec = JSON.parse(await fs.readFile(priceRefreshPidFile(), "utf8")) as {
        pid: number;
        startedAt?: string;
      };
      assert.equal(rec.pid, refresh.pid);
      assert.match(rec.startedAt ?? "", /\d{2}:\d{2}:\d{2} \d{4}$/);
      assert.equal(await isPriceRefreshRunning(), true);
      assert.deepEqual(await stopPriceRefresh(), { stopped: true });
      await gone;
      assert.equal(refresh.signalCode, "SIGTERM");
    } finally {
      refresh.kill("SIGKILL");
    }
  });
});

describe("file modes", { skip: process.platform === "win32" }, () => {
  it("keeps .price-refresh 0700 and its files 0600", async () => {
    await fs.chmod(priceRefreshStatusDir(), 0o755);
    await writePriceRefreshStatus({ phase: "running" });
    await writePriceRefreshPid(4242, ours);
    const mode = async (p: string) => (await fs.stat(p)).mode & 0o777;
    assert.equal(await mode(priceRefreshStatusDir()), 0o700);
    assert.equal(await mode(priceRefreshStatusFile()), 0o600);
    assert.equal(await mode(priceRefreshPidFile()), 0o600);
  });
});

describe("writePriceRefreshStatus", () => {
  it("writes atomically and merges with the previous status", async () => {
    await writePriceRefreshStatus({ phase: "running", latest: 3 });
    await writePriceRefreshStatus({ phase: "done" });
    const status = await readPriceRefreshStatus();
    assert.equal(status.phase, "done");
    assert.equal(status.latest, 3);
    assert.deepEqual(await fs.readdir(priceRefreshStatusDir()), ["status.json"]);
  });
});
