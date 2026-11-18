import { NextResponse, type NextRequest } from "next/server";
import { isLoopbackHost } from "@/lib/http/host";

/**
 * Host allow-list for every route (pages, API, Next internals).
 * Only localhost / 127.0.0.1 / [::1] (any port) may address this server, which
 * stops DNS rebinding and any client that reaches it by LAN address.
 * Pure header check: no shared state with render code.
 */
export function proxy(request: NextRequest) {
  if (!isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse("Forbidden host\n", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.next();
}
