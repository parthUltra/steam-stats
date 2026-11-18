import "./helpers";
import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { isLoopbackHost } from "../../src/lib/http/host";
import { proxy } from "../../src/proxy";

const ALLOWED = [
  "localhost",
  "localhost:3000",
  "LOCALHOST:3210",
  "127.0.0.1",
  "127.0.0.1:3000",
  "[::1]",
  "[::1]:3000",
];

const DENIED = [
  "evil.example",
  "evil.example:3000",
  "192.168.1.10:3000",
  "0.0.0.0:3000",
  "127.0.0.1.evil.example:3000",
  "localhost.evil.example",
  "evil.example#localhost",
  "localhost@evil.example",
  "127.0.0.2:3000",
  "localhost:abc",
  "localhost:3000:3000",
  " localhost",
  "",
];

test("isLoopbackHost accepts only localhost, 127.0.0.1 and [::1] on any port", () => {
  for (const h of ALLOWED) assert.equal(isLoopbackHost(h), true, h);
  for (const h of DENIED) assert.equal(isLoopbackHost(h), false, h);
  assert.equal(isLoopbackHost(null), false);
  assert.equal(isLoopbackHost(undefined), false);
});

function viaProxy(host: string, pathname: string) {
  const req = new NextRequest(`http://127.0.0.1:3000${pathname}`, {
    headers: { host },
  });
  return proxy(req);
}

test("proxy lets loopback hosts through on pages, API and Next internals", () => {
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    for (const p of ["/", "/api/dashboard", "/_next/static/chunks/x.js"]) {
      const res = viaProxy(host, p);
      assert.notEqual(res.status, 403, `${host} ${p}`);
      assert.equal(res.headers.get("x-middleware-next"), "1", `${host} ${p}`);
    }
  }
});

test("proxy answers 403 for a rebinding or LAN Host on every kind of route", async () => {
  for (const host of ["evil.example:3000", "192.168.1.10:3000"]) {
    for (const p of [
      "/",
      "/api/dashboard",
      "/api/gifts-received",
      "/api/itad-key",
      "/api/refresh-prices",
      "/api/steam-art",
      "/_next/image",
    ]) {
      const res = viaProxy(host, p);
      assert.equal(res.status, 403, `${host} ${p}`);
      assert.equal(res.headers.get("x-middleware-next"), null);
      assert.equal(await res.text(), "Forbidden host\n");
    }
  }
});
