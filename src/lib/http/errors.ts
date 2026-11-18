import { NextResponse } from "next/server";

/**
 * 500 with a fixed, caller-chosen message. The real error (which can contain
 * absolute paths or upstream URLs) goes to the server log only.
 */
export function serverError(
  publicMessage: string,
  err: unknown,
  extra: Record<string, unknown> = {},
): NextResponse {
  console.error(`[api] ${publicMessage}:`, err);
  return NextResponse.json(
    { ...extra, error: publicMessage },
    { status: 500 },
  );
}
