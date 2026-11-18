/**
 * `.env.local` for scripts run from a terminal.
 *
 * The Next.js server loads `.env*` itself, and scripts it spawns inherit the
 * result. A script started with `npm run …` does not — so a key kept in
 * `.env.local` was invisible to it. This reads the same files with Next's own
 * loader (`@next/env`, the parser the server uses) instead of a second,
 * hand-written parser.
 */
import { loadEnvConfig } from "@next/env";

/**
 * The only settings taken from the file — the app's own. Everything else in
 * it (NODE_OPTIONS, …) is ignored, as it is for scripts the server spawns.
 */
const APP_SETTINGS = [
  "ISTHEREANYDEAL_API_KEY",
  "ITAD_API_KEY",
  "STEAM_STATS_ROOT",
  "STEAM_STATS_OFFLINE",
  "STEAM_STATS_DEBUG_SCRAPE",
  "STEAM_STATS_SKIP_PRICES",
] as const;

/**
 * Load the app's settings from `<dir>/.env.local` (and the other `.env*`
 * files Next reads) into `process.env`. A variable that is already set is
 * never overridden. Returns the names that were set.
 */
export function loadLocalEnv(dir: string): string[] {
  const before = { ...process.env };
  const quiet = { info: () => undefined, error: () => undefined };
  let parsed: Record<string, string | undefined> = {};
  try {
    // forceReload: the loader caches per process; `dir` may differ per call.
    parsed = loadEnvConfig(dir, false, quiet, true).parsedEnv ?? {};
  } catch {
    parsed = {};
  }
  // The loader writes every parsed variable into process.env. Put the
  // environment back exactly as it was, then apply only the allow-list.
  for (const key of Object.keys(process.env)) {
    if (!(key in before)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(before)) process.env[key] = value;

  const set: string[] = [];
  for (const name of APP_SETTINGS) {
    const value = parsed[name];
    if (typeof value !== "string" || value === "") continue;
    if (process.env[name] !== undefined) continue;
    process.env[name] = value;
    set.push(name);
  }
  return set;
}
