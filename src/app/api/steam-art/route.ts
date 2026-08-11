import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "shared.fastly.steamstatic.com",
  "cdn.akamai.steamstatic.com",
]);

const MAX_BYTES = 8 * 1024 * 1024;

/** Same-origin proxy so panorama export can draw Steam CDN art onto canvas. */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url");
  if (!raw) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  if (target.protocol !== "https:" || !ALLOWED_HOSTS.has(target.hostname)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }

  const upstream = await fetch(target.toString(), {
    headers: { Accept: "image/*" },
    redirect: "error",
    next: { revalidate: 60 * 60 * 24 * 7 },
  });

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 415 });
  }

  const length = Number(upstream.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  const buf = Buffer.from(await upstream.arrayBuffer());
  if (buf.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large" }, { status: 413 });
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
