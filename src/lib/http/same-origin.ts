import { NextResponse } from "next/server";
import { isLoopbackHost } from "@/lib/http/host";

const SAME_SITE_VALUES = new Set(["same-origin", "none"]);

/**
 * Gate for mutating local APIs (POST / DELETE).
 *
 * A request is trusted only when all of these hold:
 *  - Host is loopback (also enforced for every route in src/proxy.ts);
 *  - Sec-Fetch-Site, when sent, is `same-origin` or `none`;
 *  - Origin, when sent, is http(s)://<the same loopback host:port as Host>;
 *  - at least one of the two headers is present.
 *
 * So a browser page on this origin passes, while a cross-site page, a
 * DNS-rebinding page (non-loopback Host) and a header-less client do not.
 * A command-line caller must send `Origin: http://127.0.0.1:<port>` explicitly.
 */
export function isTrustedLocalMutation(req: Request): boolean {
  const host = req.headers.get("host");
  if (!isLoopbackHost(host)) return false;

  const site = req.headers.get("sec-fetch-site");
  if (site !== null && !SAME_SITE_VALUES.has(site)) return false;

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    // `URL.host` drops a default port; Host keeps what the client sent.
    const hostNoDefaultPort = host!.replace(
      parsed.protocol === "https:" ? /:443$/ : /:80$/,
      "",
    );
    return parsed.host.toLowerCase() === hostNoDefaultPort.toLowerCase();
  }

  return site !== null;
}

export function rejectCrossOrigin(req: Request): NextResponse | null {
  if (isTrustedLocalMutation(req)) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
