import { NextResponse } from "next/server";

/**
 * Local mutating APIs: allow same-origin browser calls and Origin-less
 * clients (curl / scripts). Reject cross-site POSTs.
 */
export function isTrustedLocalMutation(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site === "cross-site") return false;
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("host") ?? "");
  } catch {
    return false;
  }
}

export function rejectCrossOrigin(req: Request): NextResponse | null {
  if (isTrustedLocalMutation(req)) return null;
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}
