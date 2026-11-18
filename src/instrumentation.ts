/**
 * Server-side backstop for the offline gate. `register` runs once when the
 * Next.js server starts. Only when STEAM_STATS_OFFLINE=1 it replaces the global
 * fetch with a tripwire, so a call site that bypasses `netFetch` fails loudly
 * instead of silently reaching Steam.
 */
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost"]);

function hostOf(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(raw).hostname;
  } catch {
    return "";
  }
}

export function register() {
  if (process.env.STEAM_STATS_OFFLINE !== "1") return;
  const realFetch = globalThis.fetch;
  const tripwire: typeof fetch = (input, init) => {
    const host = hostOf(input);
    if (!LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `offline tripwire: blocked outbound fetch to ${host || "(unparseable url)"}`,
      );
    }
    return realFetch(input, init);
  };
  globalThis.fetch = tripwire;
}
