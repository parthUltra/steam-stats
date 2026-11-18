import "./helpers";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../../src/app/api/steam-art/route";

const GOOD =
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg";

const realFetch = globalThis.fetch;
let calls: string[] = [];
let savedOffline: string | undefined;

function stubFetch(make: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    return make(url);
  }) as typeof fetch;
}

function art(url: string | null) {
  const qs = url === null ? "" : `?url=${encodeURIComponent(url)}`;
  return GET(
    new NextRequest(`http://127.0.0.1:3000/api/steam-art${qs}`, {
      headers: { host: "127.0.0.1:3000" },
    }),
  );
}

function image(type: string, bytes = 16, extra: Record<string, string> = {}) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "content-type": type, ...extra },
  });
}

beforeEach(() => {
  calls = [];
  savedOffline = process.env.STEAM_STATS_OFFLINE;
  // "Online", but every outbound request lands on the stub below.
  process.env.STEAM_STATS_OFFLINE = "0";
  stubFetch(() => image("image/jpeg"));
});

afterEach(() => {
  globalThis.fetch = realFetch;
  process.env.STEAM_STATS_OFFLINE = savedOffline;
});

const FORBIDDEN_TARGETS = [
  "https://evil.example/store_item_assets/steam/apps/620/header.jpg",
  "http://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
  "https://shared.akamai.steamstatic.com@evil.example/store_item_assets/steam/apps/620/header.jpg",
  "https://user:pw@shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
  "https://evil.example#@shared.akamai.steamstatic.com/steam/apps/620/header.jpg",
  "https://evil.example\\@shared.akamai.steamstatic.com/steam/apps/620/header.jpg",
  "https://shared.akamai.steamstatic.com.evil.example/steam/apps/620/header.jpg",
  "https://shared.akamai.steamstatic.com./store_item_assets/steam/apps/620/header.jpg",
  "https://shared.akamai.steamstatic.com:8443/store_item_assets/steam/apps/620/header.jpg",
  "https://shared.akamai.steamstatic.com:80/store_item_assets/steam/apps/620/header.jpg",
  "file:///etc/passwd",
  "https://169.254.169.254/latest/meta-data/",
  "https://127.0.0.1:3000/api/dashboard",
  "https://localhost/api/dashboard",
  "https://[::1]/x.jpg",
  "ftp://shared.akamai.steamstatic.com/steam/apps/620/header.jpg",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "javascript:alert(1)",
  // allowed host, path outside the artwork shape
  "https://shared.akamai.steamstatic.com/",
  "https://cdn.akamai.steamstatic.com/store/about/logo_steam.svg",
  "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/fe/x_full.jpg",
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/logo.svg",
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/../../../../etc/passwd",
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/%2e%2e/%2e%2e/x.jpg",
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/abc/header.jpg",
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/a/b/c/header.jpg",
  "https://shared.akamai.steamstatic.com//evil.example/steam/apps/620/header.jpg",
];

test("SSRF: forbidden targets are 403 before any fetch", async () => {
  for (const url of FORBIDDEN_TARGETS) {
    const res = await art(url);
    assert.equal(res.status, 403, url);
  }
  assert.deepEqual(calls, []);
});

test("missing or unparseable url is 400 before any fetch", async () => {
  assert.equal((await art(null)).status, 400);
  assert.equal((await art("not a url")).status, 400);
  assert.equal((await art("//shared.akamai.steamstatic.com/x.jpg")).status, 400);
  assert.deepEqual(calls, []);
});

test("an allowed raster image is proxied with hardening headers", async () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "IMAGE/JPEG; charset=binary"]) {
    stubFetch(() => image(type, 32));
    const res = await art(GOOD);
    assert.equal(res.status, 200, type);
    assert.equal(res.headers.get("content-type"), type.split(";")[0].toLowerCase());
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      res.headers.get("content-security-policy"),
      "default-src 'none'; sandbox",
    );
    assert.equal((await res.arrayBuffer()).byteLength, 32);
  }
});

test("accepted path shapes, and the upstream URL carries no query or fragment", async () => {
  const ok = [
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1/0123456789abcdef0123456789abcdef01234567/library_600x900_2x.jpg",
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/subs/12345/capsule_231x87.jpg",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/620/portrait.png",
    "https://steamcdn-a.akamaihd.net/steam/apps/620/header.jpg",
    "https://SHARED.AKAMAI.STEAMSTATIC.COM/store_item_assets/steam/apps/620/header.jpg",
  ];
  for (const url of ok) assert.equal((await art(url)).status, 200, url);

  calls = [];
  const res = await art(`${GOOD}?t=1&redirect=https://evil.example#frag`);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [GOOD]);
});

test("SVG and non-image content types are 415", async () => {
  for (const type of [
    "image/svg+xml",
    "image/svg+xml; charset=utf-8",
    "text/html",
    "application/json",
    "text/xml",
    "application/octet-stream",
    "image/x-icon",
    "",
  ]) {
    stubFetch(() =>
      type
        ? image(type)
        : new Response(new Uint8Array(4), { status: 200 }),
    );
    const res = await art(GOOD);
    assert.equal(res.status, 415, JSON.stringify(type));
    assert.equal(res.headers.get("content-type")?.startsWith("application/json"), true);
  }
});

test("size cap: declared and undeclared oversize bodies are 413", async () => {
  stubFetch(() => image("image/jpeg", 8, { "content-length": String(9 * 1024 * 1024) }));
  assert.equal((await art(GOOD)).status, 413);

  // No Content-Length: a stream that would exceed the cap is cut off.
  let pulled = 0;
  stubFetch(() => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (pulled > 64) controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  });
  assert.equal((await art(GOOD)).status, 413);
  assert.ok(pulled <= 12, `read ${pulled} MiB before stopping`);
});

test("upstream failure is 502, never 500", async () => {
  stubFetch(() => {
    throw new TypeError("fetch failed: ECONNREFUSED /secret/path");
  });
  let res = await art(GOOD);
  assert.equal(res.status, 502);
  assert.equal((await res.text()).includes("secret"), false);

  for (const status of [500, 503, 403, 302, 301]) {
    stubFetch(() => new Response("x", { status }));
    res = await art(GOOD);
    assert.equal(res.status, 502, String(status));
  }

  stubFetch(() => new Response("x", { status: 404 }));
  assert.equal((await art(GOOD)).status, 404);
});

test("redirects are not followed and a timeout signal is attached", async () => {
  let init: RequestInit | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, i?: RequestInit) => {
    init = i;
    return image("image/png");
  }) as typeof fetch;
  assert.equal((await art(GOOD)).status, 200);
  assert.equal(init?.redirect, "error");
  assert.ok(init?.signal instanceof AbortSignal);
});

test("offline: 502 and no fetch at all", async () => {
  process.env.STEAM_STATS_OFFLINE = "1";
  const res = await art(GOOD);
  assert.equal(res.status, 502);
  assert.deepEqual(calls, []);
});
