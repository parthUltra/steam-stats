/**
 * Runtime seam. The only module in src/lib and src/app/api allowed to call
 * `process.cwd()` or bare `fetch` (enforced in eslint.config.mjs; the one other
 * exception is src/lib/process/spawn-script.ts, which needs the code root).
 *
 * Environment is read lazily (call time, not module load) so a test setup file
 * can set it before the test body runs.
 */
import path from "node:path";

/** Data root: holds samples/, data/, .steam-session/, .gmail-session/, .price-refresh/, .env.local */
export function appRoot(): string {
  const r = process.env.STEAM_STATS_ROOT?.trim();
  return r ? path.resolve(r) : process.cwd();
}

export function rootPath(...parts: string[]): string {
  return path.join(appRoot(), ...parts);
}

/** Offline = no outbound request, no child process, no cache write recording a failed fetch. */
export function isOffline(): boolean {
  return process.env.STEAM_STATS_OFFLINE === "1";
}

/**
 * Tests that stub the network set STEAM_STATS_NO_PACING=1 so the request
 * limiters (3 s between ITAD calls, 110 ms between Steam calls) do not turn a
 * handful of fake requests into minutes of waiting. Never set it for real runs.
 */
export function isPacingDisabled(): boolean {
  return process.env.STEAM_STATS_NO_PACING === "1";
}

/**
 * STEAM_STATS_SKIP_PRICES=1 (`npm run launch:fast`): the dashboard does not
 * start the automatic weekly price refresh. An explicit "refresh now" (force)
 * still runs.
 */
export function skipAutoPriceRefresh(): boolean {
  return process.env.STEAM_STATS_SKIP_PRICES === "1";
}

export class OfflineError extends Error {}

/** Drop-in for fetch on the server. Rejects before any socket is opened when offline. */
export const netFetch: typeof fetch = (input, init) =>
  isOffline()
    ? Promise.reject(new OfflineError("offline: " + String(input).split("?")[0]))
    : fetch(input, init);
