import { LOCAL, ROOT, SAME_ORIGIN, changedFiles, plantCanaries, request, snapshot } from "./helpers";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { isTrustedLocalMutation } from "../../src/lib/http/same-origin";
import * as gifts from "../../src/app/api/gifts-received/route";
import * as itadKey from "../../src/app/api/itad-key/route";
import * as refresh from "../../src/app/api/refresh-prices/route";

before(() => plantCanaries());

type Case = { name: string; headers: Record<string, string> };

/** Every one of these must be refused. */
const REJECTED: Case[] = [
  { name: "no Origin and no Sec-Fetch-Site (curl, LAN script)", headers: {} },
  {
    name: "cross-site page",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  },
  { name: "cross-site Origin only", headers: { origin: "https://evil.example" } },
  { name: "Sec-Fetch-Site cross-site only", headers: { "sec-fetch-site": "cross-site" } },
  {
    name: "same-site but different origin (another localhost port)",
    headers: { origin: "http://localhost:8080", "sec-fetch-site": "same-site" },
  },
  {
    name: "loopback Origin on a different port",
    headers: { origin: "http://127.0.0.1:9999" },
  },
  {
    name: "loopback Origin with a different loopback name",
    headers: { origin: "http://localhost:3000" },
  },
  { name: "opaque Origin", headers: { origin: "null" } },
  { name: "malformed Origin", headers: { origin: "not a url" } },
  {
    name: "non-http Origin",
    headers: { origin: `chrome-extension://${LOCAL}` },
  },
  {
    name: "matching Origin but Sec-Fetch-Site cross-site",
    headers: { origin: `http://${LOCAL}`, "sec-fetch-site": "cross-site" },
  },
  {
    name: "DNS rebinding: Origin equals a non-loopback Host",
    headers: {
      host: "evil.example:3000",
      origin: "http://evil.example:3000",
      "sec-fetch-site": "same-origin",
    },
  },
  {
    name: "LAN address as Host with matching Origin",
    headers: {
      host: "192.168.1.10:3000",
      origin: "http://192.168.1.10:3000",
      "sec-fetch-site": "same-origin",
    },
  },
  {
    name: "non-loopback Host with Sec-Fetch-Site none",
    headers: { host: "evil.example:3000", "sec-fetch-site": "none" },
  },
];

const ACCEPTED: Case[] = [
  { name: "same-origin page (Origin + Sec-Fetch-Site)", headers: SAME_ORIGIN },
  { name: "same-origin Origin only", headers: { origin: `http://${LOCAL}` } },
  { name: "Sec-Fetch-Site same-origin only", headers: { "sec-fetch-site": "same-origin" } },
  { name: "Sec-Fetch-Site none (user-initiated)", headers: { "sec-fetch-site": "none" } },
  {
    name: "localhost on another port, self-consistent",
    headers: {
      host: "localhost:3210",
      origin: "http://localhost:3210",
      "sec-fetch-site": "same-origin",
    },
  },
  {
    name: "IPv6 loopback",
    headers: { host: "[::1]:3000", origin: "http://[::1]:3000" },
  },
  {
    name: "default port omitted by Origin",
    headers: { host: "localhost:80", origin: "http://localhost" },
  },
];

test("isTrustedLocalMutation: rejected matrix", () => {
  for (const c of REJECTED) {
    assert.equal(
      isTrustedLocalMutation(request("POST", "/api/x", c.headers)),
      false,
      c.name,
    );
  }
});

test("isTrustedLocalMutation: accepted matrix", () => {
  for (const c of ACCEPTED) {
    assert.equal(
      isTrustedLocalMutation(request("POST", "/api/x", c.headers)),
      true,
      c.name,
    );
  }
});

test("isTrustedLocalMutation: a request with no Host header is refused", () => {
  const req = new Request("http://127.0.0.1:3000/api/x", {
    method: "POST",
    headers: SAME_ORIGIN,
  });
  assert.equal(isTrustedLocalMutation(req), false);
});

type Handler = (req: Request) => Promise<Response>;

const MUTATING: {
  name: string;
  method: string;
  path: string;
  handler: Handler;
  body?: unknown;
}[] = [
  {
    name: "POST /api/itad-key",
    method: "POST",
    path: "/api/itad-key",
    handler: itadKey.POST,
    body: { apiKey: "A".repeat(40) },
  },
  {
    name: "POST /api/refresh-prices",
    method: "POST",
    path: "/api/refresh-prices",
    handler: refresh.POST,
    body: { force: true },
  },
  {
    name: "POST /api/gifts-received",
    method: "POST",
    path: "/api/gifts-received",
    handler: gifts.POST,
  },
  {
    name: "DELETE /api/gifts-received",
    method: "DELETE",
    path: "/api/gifts-received",
    handler: gifts.DELETE,
  },
];

for (const route of MUTATING) {
  test(`${route.name}: every untrusted request is 403 and changes nothing`, async () => {
    const before = snapshot(ROOT);
    for (const c of REJECTED) {
      const res = await route.handler(
        request(route.method, route.path, c.headers, route.body),
      );
      assert.equal(res.status, 403, c.name);
      assert.deepEqual(await res.json(), { error: "Forbidden" }, c.name);
    }
    assert.deepEqual(changedFiles(before, snapshot(ROOT)), []);
  });

  test(`${route.name}: a same-origin request gets past the guard`, async () => {
    // itad-key is sent a malformed key so "past the guard" (400) is observable
    // without writing; the valid-key path is covered in itad-key.test.ts.
    const body =
      route.path === "/api/itad-key" ? { apiKey: "too short" } : route.body;
    const res = await route.handler(
      request(route.method, route.path, SAME_ORIGIN, body),
    );
    assert.notEqual(res.status, 403);
  });
}

test("exactly the expected mutating handlers exist", () => {
  const methods = ["POST", "PUT", "PATCH", "DELETE"] as const;
  const found: string[] = [];
  for (const [name, mod] of Object.entries({ gifts, itadKey, refresh })) {
    for (const m of methods) {
      if (m in (mod as Record<string, unknown>)) found.push(`${name}.${m}`);
    }
  }
  assert.deepEqual(found.sort(), [
    "gifts.DELETE",
    "gifts.POST",
    "itadKey.POST",
    "refresh.POST",
  ]);
});
