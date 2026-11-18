import {
  CANARY_COOKIE,
  CANARY_GIFT_URL,
  CANARY_ITAD_KEY,
  CANARY_STEAM_KEY,
  ROOT,
  SAME_ORIGIN,
  plantCanaries,
  request,
} from "./helpers";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import * as dashboard from "../../src/app/api/dashboard/route";
import * as gifts from "../../src/app/api/gifts-received/route";
import * as itadKey from "../../src/app/api/itad-key/route";
import * as refresh from "../../src/app/api/refresh-prices/route";
import { serverError } from "../../src/lib/http/errors";

const SECRETS = [
  CANARY_ITAD_KEY,
  CANARY_STEAM_KEY,
  CANARY_COOKIE,
  decodeURIComponent(CANARY_COOKIE),
  "CANARYcookieTOKEN",
  CANARY_GIFT_URL,
  "ackgift",
];

function assertClean(label: string, text: string) {
  for (const s of SECRETS) {
    assert.equal(text.includes(s), false, `${label} leaks ${s.slice(0, 12)}…`);
  }
  assert.equal(text.includes(ROOT), false, `${label} leaks the data root path`);
  assert.equal(/"pid"\s*:/.test(text), false, `${label} exposes a process id`);
}

before(() => plantCanaries());

test("no API response contains a canary secret, a gift URL or a pid", async () => {
  const responses: [string, Response][] = [
    ["GET /api/dashboard", await dashboard.GET()],
    ["GET /api/itad-key", await itadKey.GET()],
    ["GET /api/gifts-received", await gifts.GET()],
    ["GET /api/refresh-prices", await refresh.GET()],
    [
      "POST /api/refresh-prices",
      await refresh.POST(
        request("POST", "/api/refresh-prices", SAME_ORIGIN, { force: true }),
      ),
    ],
    [
      "POST /api/gifts-received",
      await gifts.POST(request("POST", "/api/gifts-received", SAME_ORIGIN)),
    ],
    [
      "POST /api/itad-key (rejected key)",
      await itadKey.POST(
        request("POST", "/api/itad-key", SAME_ORIGIN, {
          apiKey: `${CANARY_ITAD_KEY}\nX=1`,
        }),
      ),
    ],
    [
      "POST /api/itad-key (forbidden)",
      await itadKey.POST(
        request("POST", "/api/itad-key", {}, { apiKey: CANARY_ITAD_KEY }),
      ),
    ],
  ];
  for (const [label, res] of responses) {
    const text = await res.text();
    assert.ok(text.length > 0, label);
    assertClean(label, text);
    for (const [k, v] of res.headers) assertClean(`${label} header ${k}`, v);
  }
});

test("GET /api/dashboard and /api/itad-key answer 200 on the fixture", async () => {
  assert.equal((await dashboard.GET()).status, 200);
  const res = await itadKey.GET();
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(await res.json()).sort(), ["appsUrl", "connected"]);
});

test("GET /api/gifts-received returns only display fields", async () => {
  const json = await (await gifts.GET()).json();
  assert.ok(Array.isArray(json.gifts) && json.gifts.length > 0);
  const allowed = new Set(["title", "fromPersona", "receivedAt", "source", "importedAt"]);
  for (const g of json.gifts) {
    for (const k of Object.keys(g)) assert.ok(allowed.has(k), `unexpected gift field ${k}`);
  }
  assert.equal("pid" in json.sync, false);
});

test("500 bodies carry a fixed message, never the underlying error", async () => {
  const realError = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    logged.push(args);
  };
  try {
    const res = serverError(
      "Failed to build dashboard",
      new Error(`ENOENT: no such file, open '${ROOT}/data/x.json' key=${CANARY_ITAD_KEY}`),
      { ok: false },
    );
    assert.equal(res.status, 500);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false, error: "Failed to build dashboard" });
    assertClean("serverError", text);
    assert.equal(logged.length, 1, "detail is logged server-side");
  } finally {
    console.error = realError;
  }
});
