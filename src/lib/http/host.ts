/**
 * Loopback Host allow-list. The app is local-only, so a request whose Host is
 * anything else is either a LAN client or a DNS-rebinding page.
 * Pure (no state, no I/O) so src/proxy.ts can import it.
 */
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i;

export function isLoopbackHost(host: string | null | undefined): boolean {
  return typeof host === "string" && LOOPBACK_HOST.test(host);
}
