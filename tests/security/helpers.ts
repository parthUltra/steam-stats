/**
 * Shared setup for the security gate. Import this FIRST in every test file.
 *
 * Runs standalone and under `--import ./tests/setup.ts`: a temp data root with
 * a tiny synthetic fixture is created only when STEAM_STATS_ROOT is not already
 * set. Nothing here reads or writes the real data/, .env.local or session dirs.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const REPO_ROOT = process.cwd();

/** Valid-shaped secrets that must never appear in any HTTP response. */
export const CANARY_ITAD_KEY = "CANARYitad0123456789abcdef0123456789";
export const CANARY_STEAM_KEY = "CANARYsteam0123456789ABCDEF012345";
export const CANARY_COOKIE = "76561190000000000%7C%7CCANARYcookieTOKEN0123456789";
export const CANARY_GIFT_URL =
  "https://store.steampowered.com/account/ackgift/CA0A51C0FFEE0001";

function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function createOwnRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "steam-stats-sec-"));
  const parsed = path.join(root, "samples", "parsed");
  writeJson(path.join(parsed, "purchase-history.json"), {
    kind: "purchase-history",
    rows: [],
  });
  writeJson(path.join(parsed, "licenses.json"), { rows: [] });
  writeJson(path.join(parsed, "account-spend.json"), { rows: [] });
  writeJson(path.join(parsed, "login-history.json"), { rows: [] });
  writeJson(path.join(parsed, "games-played.json"), {
    steamId: "76561190000000000",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    games: [
      {
        appId: 620,
        name: "Synthetic Game",
        hoursForever: 3,
        hours2Weeks: null,
        lastPlayedText: null,
        lastPlayedAt: null,
        minutesForever: 180,
      },
    ],
  });
  process.on("exit", () => {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });
  return root;
}

if (!process.env.STEAM_STATS_ROOT?.trim()) {
  process.env.STEAM_STATS_ROOT = createOwnRoot();
}
if (process.env.STEAM_STATS_OFFLINE === undefined) {
  process.env.STEAM_STATS_OFFLINE = "1";
}

export const ROOT = path.resolve(process.env.STEAM_STATS_ROOT!);

// Hard stop: these tests write credentials, so the root must not be the repo.
if (ROOT === path.resolve(REPO_ROOT)) {
  throw new Error("security tests refuse to run against the real data root");
}

/** Plant canary secrets everywhere a real secret lives (temp root + env). */
export function plantCanaries() {
  process.env.ISTHEREANYDEAL_API_KEY = CANARY_ITAD_KEY;
  process.env.STEAM_API_KEY = CANARY_STEAM_KEY;
  writeJson(path.join(ROOT, "data", "itad-credentials.json"), {
    apiKey: CANARY_ITAD_KEY,
    appName: "steam-stats",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  writeJson(path.join(ROOT, ".steam-session", "storage-state.json"), {
    cookies: [
      {
        name: "steamLoginSecure",
        value: CANARY_COOKIE,
        domain: "store.steampowered.com",
      },
    ],
  });
  writeJson(path.join(ROOT, "data", "gifts-received.json"), {
    updatedAt: "2026-01-01T00:00:00.000Z",
    gifts: [
      {
        title: "Synthetic Gift",
        fromPersona: "tester",
        subject: "You've received a gift copy of the game Synthetic Gift on Steam",
        giftUrl: CANARY_GIFT_URL,
        source: "gmail",
        importedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  writeJson(path.join(ROOT, ".price-refresh", "status.json"), {
    phase: "done",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pid: 424242,
  });
  writeJson(path.join(ROOT, ".gmail-session", "status.json"), {
    phase: "done",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pid: 434343,
  });
}

export const LOCAL = "127.0.0.1:3000";

/** A request as the server would see it: Host is always present. */
export function request(
  method: string,
  pathname: string,
  headers: Record<string, string> = {},
  body?: unknown,
): Request {
  const h: Record<string, string> = { host: LOCAL, ...headers };
  if (body !== undefined) h["content-type"] = "application/json";
  return new Request(`http://${h.host}${pathname}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Headers a same-origin page sends on fetch(). */
export const SAME_ORIGIN = {
  origin: `http://${LOCAL}`,
  "sec-fetch-site": "same-origin",
};

/** relative path -> "size:mtimeMs:mode" for every file under dir. */
export function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        const st = fs.statSync(full);
        out.set(
          path.relative(dir, full),
          `${st.size}:${st.mtimeMs}:${(st.mode & 0o777).toString(8)}`,
        );
      }
    }
  };
  walk(dir);
  return out;
}

export function changedFiles(
  before: Map<string, string>,
  after: Map<string, string>,
): string[] {
  const names = new Set([...before.keys(), ...after.keys()]);
  return [...names].filter((n) => before.get(n) !== after.get(n)).sort();
}

/** stat-only fingerprint of a real file (never reads contents). */
export function statStamp(file: string): string {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "absent";
  }
}
