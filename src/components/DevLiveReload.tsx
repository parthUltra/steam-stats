"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Dev-only: keep the open localhost tab in sync with file edits.
 * Next Fast Refresh covers most client edits; this listens to the HMR
 * socket for CSS / server-component / full-reload signals and refreshes.
 */
export function DevLiveReload() {
  const router = useRouter();

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    let ws: WebSocket | null = null;
    let closed = false;
    let attempts = 0;
    let refreshTimer: number | null = null;

    const bump = (hard = false) => {
      if (hard) {
        window.location.reload();
        return;
      }
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      // Debounce rapid HMR bursts from multi-file edits
      refreshTimer = window.setTimeout(() => {
        router.refresh();
        window.dispatchEvent(new Event("steam-stats:dev-refresh"));
      }, 120);
    };

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      // Next.js (webpack + turbopack) serves HMR on this path
      const url = `${proto}://${window.location.host}/_next/webpack-hmr`;
      try {
        ws = new WebSocket(url);
      } catch {
        return;
      }

      ws.onopen = () => {
        attempts = 0;
      };

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        let data: { action?: string; type?: string } | null = null;
        try {
          data = JSON.parse(event.data) as {
            action?: string;
            type?: string;
          };
        } catch {
          return;
        }
        const action = data.action ?? data.type;
        if (!action) return;

        if (action === "reload" || action === "full-reload") {
          bump(true);
          return;
        }

        if (
          action === "serverComponentChanges" ||
          action === "serverComponentsChanged" ||
          action === "middlewareChanges" ||
          action === "built" ||
          action === "sync" ||
          action === "success"
        ) {
          bump(false);
        }
      };

      ws.onclose = () => {
        ws = null;
        if (closed) return;
        attempts += 1;
        window.setTimeout(connect, Math.min(8_000, 400 * attempts));
      };
    };

    connect();
    return () => {
      closed = true;
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      ws?.close();
    };
  }, [router]);

  return null;
}
