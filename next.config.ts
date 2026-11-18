import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Steam CDN hosts the client loads artwork from (see src/components/SteamArt.tsx). */
const STEAM_IMAGE_HOSTS = [
  "https://shared.akamai.steamstatic.com",
  "https://cdn.cloudflare.steamstatic.com",
  "https://steamcdn-a.akamaihd.net",
  "https://shared.fastly.steamstatic.com",
];

/**
 * Static policy (no nonces — see docs "Content Security Policy › Without Nonces").
 * - script-src needs 'unsafe-inline' because the App Router streams its payload
 *   in inline <script> tags; 'unsafe-eval' is dev-only (React debugging).
 * - style-src needs 'unsafe-inline' for style attributes (charts, inline SVG)
 *   and Next's inline <style> tags.
 * - connect-src adds the HMR websocket in dev only.
 * Everything is same-origin except Steam artwork.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${STEAM_IMAGE_HOSTS.join(" ")}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // No `images.remotePatterns`: nothing uses next/image (artwork is plain <img>
  // plus /api/steam-art), so the image optimizer must not fetch remote URLs.
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
