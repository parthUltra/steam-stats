import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { writeJsonAtomic } from "@/lib/data/json-store";
import { ensurePrivateDir } from "@/lib/process/private-files";
import { isOffline, rootPath } from "@/lib/runtime";

// Functions, not constants: the data root is resolved at call time.
export const priceRefreshStatusDir = () => rootPath(".price-refresh");
export const priceRefreshStatusFile = () =>
  rootPath(".price-refresh", "status.json");
export const priceRefreshPidFile = () =>
  rootPath(".price-refresh", "refresh.pid");

export type PriceRefreshStatus = {
  phase: "idle" | "running" | "done" | "error";
  updatedAt: string;
  message?: string;
  error?: string;
  startedAt?: string;
  pid?: number;
  /** Titles finished in the current batch (optional) */
  done?: number;
  /** Titles queued in the current batch (optional) */
  total?: number;
  /** Library titles with a fresh (≤7 day) ITAD check */
  latest?: number;
  /** Library titles considered for lows */
  libraryTotal?: number;
};

export async function readPriceRefreshStatus(): Promise<PriceRefreshStatus> {
  try {
    const raw = await fs.readFile(priceRefreshStatusFile(), "utf8");
    return JSON.parse(raw) as PriceRefreshStatus;
  } catch {
    return { phase: "idle", updatedAt: "" };
  }
}

export async function writePriceRefreshStatus(
  partial: Partial<PriceRefreshStatus> & { phase: PriceRefreshStatus["phase"] },
): Promise<PriceRefreshStatus> {
  // Owner-only: the status carries the library size and a process id.
  await ensurePrivateDir(priceRefreshStatusDir());
  const prev = await readPriceRefreshStatus();
  const next: PriceRefreshStatus = {
    ...prev,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  // Atomic: the server polls this file while the script rewrites it.
  await writeJsonAtomic(priceRefreshStatusFile(), next);
  return next;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** What the OS says about a pid right now. */
export type ProcessInfo = {
  /** Start time exactly as `ps -o lstart=` prints it. */
  startedAt: string;
  /** Full command line. */
  command: string;
};

export type ProcessProbe = (pid: number) => Promise<ProcessInfo | null>;

/** The script the pid file is supposed to point at. */
const REFRESH_SCRIPT = "refresh-prices";

/**
 * `ps -o lstart=,command= -p <pid>` (macOS / Linux). Null when the process is
 * gone, on Windows, or offline (offline mode starts no child process) — the
 * caller then treats the pid as unverified.
 */
export const probeProcess: ProcessProbe = (pid) => {
  if (process.platform === "win32" || isOffline()) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "ps",
      ["-o", "lstart=,command=", "-p", String(pid)],
      {
        timeout: 5_000,
        // C locale: `lstart` must print the same on every call.
        env: { ...process.env, LC_ALL: "C" },
      },
      (err, stdout) => {
        const line = err ? "" : String(stdout).trim().split("\n")[0] ?? "";
        // lstart is five fields: "Tue Nov 17 20:12:03 2026"
        const m = line.match(/^(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.+)$/);
        resolve(
          m ? { startedAt: m[1].replace(/\s+/g, " "), command: m[2] } : null,
        );
      },
    );
  });
};

type PidRecord = {
  pid: number;
  /** `ps` start time recorded when the pid file was written, if it was. */
  startedAt?: string;
};

/** The pid file is either a bare number (legacy) or a JSON `PidRecord`. */
async function readPidRecord(): Promise<PidRecord | null> {
  let raw: string;
  try {
    raw = (await fs.readFile(priceRefreshPidFile(), "utf8")).trim();
  } catch {
    return null;
  }
  let rec: PidRecord | null = null;
  if (/^\d+$/.test(raw)) {
    rec = { pid: Number(raw) };
  } else {
    try {
      const parsed = JSON.parse(raw) as Partial<PidRecord>;
      if (typeof parsed.pid === "number") {
        rec = {
          pid: parsed.pid,
          ...(typeof parsed.startedAt === "string"
            ? { startedAt: parsed.startedAt }
            : {}),
        };
      }
    } catch {
      // unreadable pid file → no record
    }
  }
  return rec && Number.isInteger(rec.pid) && rec.pid > 1 ? rec : null;
}

/**
 * Record the refresh process: pid plus its OS start time, so a later
 * `stopPriceRefresh` can prove the pid still belongs to the same process.
 * Owner-only file, written atomically.
 */
export async function writePriceRefreshPid(
  pid: number,
  probe: ProcessProbe = probeProcess,
): Promise<void> {
  await ensurePrivateDir(priceRefreshStatusDir());
  const info = await probe(pid);
  const rec: PidRecord = { pid, ...(info ? { startedAt: info.startedAt } : {}) };
  await writeJsonAtomic(priceRefreshPidFile(), rec);
}

/**
 * Is `rec.pid` still the refresh script we started? It must be alive, its
 * command line must name the refresh script, and — when the pid file recorded
 * a start time — it must be the same process instance, not a later one that
 * was handed the same pid.
 */
async function isOurRefreshProcess(
  rec: PidRecord,
  probe: ProcessProbe,
): Promise<boolean> {
  const info = await probe(rec.pid);
  if (!info) return false;
  if (!info.command.includes(REFRESH_SCRIPT)) return false;
  if (rec.startedAt && rec.startedAt !== info.startedAt) return false;
  return true;
}

/** A refresh run is minutes long; a pid file older than this is not ours any more. */
const PID_FILE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * True while the detached refresh script is alive.
 *
 * "The pid in the file is alive" is not enough: once the script exits, the OS
 * can hand its pid to an unrelated process and the refresh would look
 * "running" forever. The pid must verify as our script (see
 * `isOurRefreshProcess`), the script must not have reported `done` / `error`
 * since the pid file was written, and the pid file must not be implausibly
 * old. Anything else is a stale pid file, which is removed.
 */
export async function isPriceRefreshRunning(opts?: {
  now?: number;
  probe?: ProcessProbe;
}): Promise<boolean> {
  const rec = await readPidRecord();
  if (!rec) return false;
  const pidFile = priceRefreshPidFile();
  try {
    let running = await isOurRefreshProcess(rec, opts?.probe ?? probeProcess);
    if (running) {
      const writtenAt = (await fs.stat(pidFile)).mtimeMs;
      const status = await readPriceRefreshStatus();
      const reportedAt = Date.parse(status.updatedAt);
      const finished =
        (status.phase === "done" || status.phase === "error") &&
        Number.isFinite(reportedAt) &&
        reportedAt > writtenAt;
      if (finished || (opts?.now ?? Date.now()) - writtenAt > PID_FILE_MAX_AGE_MS) {
        running = false;
      }
    }
    if (!running) await fs.unlink(pidFile).catch(() => undefined);
    return running;
  } catch {
    return false;
  }
}

/**
 * Stop the detached refresh loop (best-effort).
 *
 * A signal is sent only to a pid that verifies as our refresh script. A dead,
 * reused or unverifiable pid is treated as stale: the pid file is removed and
 * nothing is killed — a pid file is never authority to signal an arbitrary
 * process (or, with `-pid`, a whole process group).
 */
export async function stopPriceRefresh(opts?: {
  probe?: ProcessProbe;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
}): Promise<{ stopped: boolean }> {
  const rec = await readPidRecord();
  let stopped = false;
  if (rec && (await isOurRefreshProcess(rec, opts?.probe ?? probeProcess))) {
    const kill = opts?.kill ?? ((pid, signal) => void process.kill(pid, signal));
    try {
      // Kill the process group when spawned detached
      kill(-rec.pid, "SIGTERM");
      stopped = true;
    } catch {
      try {
        kill(rec.pid, "SIGTERM");
        stopped = true;
      } catch {
        // already gone
      }
    }
  }
  await fs.unlink(priceRefreshPidFile()).catch(() => undefined);
  return { stopped };
}
