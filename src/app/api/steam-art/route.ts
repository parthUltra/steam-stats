import { NextRequest, NextResponse } from "next/server";
import { netFetch } from "@/lib/runtime";

const ALLOWED_HOSTS = new Set([
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "shared.fastly.steamstatic.com",
  "cdn.akamai.steamstatic.com",
]);

/**
 * Store artwork only:
 *   /store_item_assets/steam/apps/<id>/[<hash>/]<file>.jpg
 *   /steam/apps/<id>/[<hash>/]<file>.jpg          (legacy CDN layout)
 * and the same under subs/ and bundles/.
 */
const ART_PATH =
  /^\/(?:store_item_assets\/)?steam\/(?:apps|subs|bundles)\/\d{1,10}\/(?:[0-9a-f]{8,64}\/)?[A-Za-z0-9_.-]{1,120}\.(?:jpe?g|png|webp|gif)$/;

/** Raster types only. SVG is excluded: it can carry script and would run in this origin. */
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_BYTES = 8 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 10_000;

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** Read at most MAX_BYTES; null when the body is larger. */
async function readCapped(res: Response): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Same-origin proxy so panorama export can draw Steam CDN art onto canvas. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) return deny(400, "Missing url");

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return deny(400, "Invalid url");
  }

  if (
    target.protocol !== "https:" ||
    target.port !== "" ||
    target.username !== "" ||
    target.password !== "" ||
    !ALLOWED_HOSTS.has(target.hostname)
  ) {
    return deny(403, "Host not allowed");
  }
  if (!ART_PATH.test(target.pathname)) {
    return deny(403, "Path not allowed");
  }

  // Rebuilt from validated parts: no query string, fragment or credentials.
  const upstreamUrl = `https://${target.hostname}${target.pathname}`;

  let upstream: Response;
  try {
    upstream = await netFetch(upstreamUrl, {
      headers: { Accept: "image/jpeg,image/png,image/webp,image/gif" },
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      next: { revalidate: 60 * 60 * 24 * 7 },
    });
  } catch {
    // Offline, DNS/connect failure, timeout, or a refused redirect.
    return deny(502, "Upstream unavailable");
  }

  if (upstream.status === 404) return deny(404, "Not found");
  if (!upstream.ok) return deny(502, "Upstream error");

  const contentType = (upstream.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!ALLOWED_TYPES.has(contentType)) {
    return deny(415, "Not an allowed image type");
  }

  const declared = Number(upstream.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return deny(413, "Image too large");
  }

  let body: Uint8Array | null;
  try {
    body = await readCapped(upstream);
  } catch {
    return deny(502, "Upstream unavailable");
  }
  if (!body) return deny(413, "Image too large");

  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
      // Bytes from another host: never let them act as a document here.
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  });
}
