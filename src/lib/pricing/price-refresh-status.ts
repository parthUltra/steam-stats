import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
export const PRICE_REFRESH_STATUS_DIR = path.join(ROOT, ".price-refresh");
export const PRICE_REFRESH_STATUS_FILE = path.join(
  PRICE_REFRESH_STATUS_DIR,
  "status.json",
);
export const PRICE_REFRESH_PID_FILE = path.join(
  PRICE_REFRESH_STATUS_DIR,
  "refresh.pid",
);

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
    const raw = await fs.readFile(PRICE_REFRESH_STATUS_FILE, "utf8");
    return JSON.parse(raw) as PriceRefreshStatus;
  } catch {
    return { phase: "idle", updatedAt: "" };
  }
}

export async function writePriceRefreshStatus(
  partial: Partial<PriceRefreshStatus> & { phase: PriceRefreshStatus["phase"] },
): Promise<PriceRefreshStatus> {
  await fs.mkdir(PRICE_REFRESH_STATUS_DIR, { recursive: true });
  const prev = await readPriceRefreshStatus();
  const next: PriceRefreshStatus = {
    ...prev,
    ...partial,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(
    PRICE_REFRESH_STATUS_FILE,
    JSON.stringify(next, null, 2),
  );
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

export async function isPriceRefreshRunning(): Promise<boolean> {
  try {
    const raw = await fs.readFile(PRICE_REFRESH_PID_FILE, "utf8");
    const pid = Number(raw.trim());
    if (!Number.isFinite(pid) || pid <= 0) return false;
    if (!isPidAlive(pid)) {
      await fs.unlink(PRICE_REFRESH_PID_FILE).catch(() => undefined);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Stop the detached refresh loop (best-effort). */
export async function stopPriceRefresh(): Promise<void> {
  try {
    const raw = await fs.readFile(PRICE_REFRESH_PID_FILE, "utf8");
    const pid = Number(raw.trim());
    if (Number.isFinite(pid) && pid > 0) {
      try {
        // Kill the process group when spawned detached
        process.kill(-pid, "SIGTERM");
      } catch {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // no pid file
  }
  await fs.unlink(PRICE_REFRESH_PID_FILE).catch(() => undefined);
}
