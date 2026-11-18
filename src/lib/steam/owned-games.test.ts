import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { redactSecrets } from "@/lib/data/redact";
import {
  fetchFamilyPlayedGames,
  fetchOwnedGamesWithAccessToken,
  mergeOwnedAndFamily,
} from "./owned-games";

const realFetch = globalThis.fetch;
const savedOffline = process.env.STEAM_STATS_OFFLINE;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedOffline === undefined) delete process.env.STEAM_STATS_OFFLINE;
  else process.env.STEAM_STATS_OFFLINE = savedOffline;
});

type Seen = { url: URL; headers: Headers };
function stub(handler: (url: URL) => unknown | Response | Error) {
  delete process.env.STEAM_STATS_OFFLINE;
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    seen.push({ url, headers: new Headers(init?.headers) });
    const out = handler(url);
    if (out instanceof Error) throw out;
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return seen;
}

const STEAM_ID = "76561190000000000";
const TOKEN = "eyJhbGciOiJFZERTQSJ9.c2VjcmV0LXRva2Vu.c2ln";
// 2026-08-02T10:20:30Z
const RTIME = 1785666030;

describe("GetOwnedGames mapping", () => {
  const response = {
    response: {
      game_count: 1,
      games: [
        {
          appid: 111,
          name: "Example Game",
          playtime_forever: 600,
          playtime_2weeks: 30,
          playtime_windows_forever: 400,
          playtime_mac_forever: 0,
          playtime_linux_forever: 50,
          playtime_deck_forever: 150,
          playtime_disconnected: 12,
          rtime_last_played: RTIME,
        },
        { appid: 222, playtime_forever: 0, rtime_last_played: 0 },
      ],
    },
  };

  it("keeps per-platform minutes and rtime_last_played", async () => {
    stub(() => response);
    const [g, never] = await fetchOwnedGamesWithAccessToken(STEAM_ID, TOKEN);
    assert.equal(g.hoursForever, 10);
    assert.equal(g.minutesForever, 600);
    assert.equal(g.minutes2Weeks, 30);
    assert.equal(g.minutesWindows, 400);
    assert.equal(g.minutesMac, 0);
    assert.equal(g.minutesLinux, 50);
    assert.equal(g.minutesDeck, 150);
    assert.equal(g.minutesDisconnected, 12);
    assert.equal(g.rtimeLastPlayed, RTIME);
    // absent in the response → absent in the row, not zero
    assert.equal(never.minutesWindows, undefined);
    assert.equal(never.rtimeLastPlayed, undefined);
    assert.equal(never.lastPlayedAt, null);
    assert.equal(never.lastPlayedText, null);
  });

  it("stores last played as epoch ms plus an ISO date, never a locale string", async () => {
    stub(() => response);
    const [g] = await fetchOwnedGamesWithAccessToken(STEAM_ID, TOKEN);
    assert.equal(g.lastPlayedAt, RTIME * 1000);
    assert.equal(g.lastPlayedText, "2026-08-02");
  });

  it("carries the extra fields through the owned + family merge", () => {
    const merged = mergeOwnedAndFamily(
      [
        {
          appId: 111,
          name: "Example Game",
          hoursForever: 10,
          hours2Weeks: null,
          lastPlayedText: "2026-08-02",
          lastPlayedAt: RTIME * 1000,
          minutesForever: 600,
          minutesDeck: 150,
          rtimeLastPlayed: RTIME,
        },
      ],
      [],
    );
    assert.equal(merged[0].minutesDeck, 150);
    assert.equal(merged[0].rtimeLastPlayed, RTIME);
  });
});

describe("credentials stay out of URLs, logs and errors", () => {
  it("never puts the token in an error message", async () => {
    for (const failure of [
      () => new Response("denied", { status: 403 }),
      // undici-style failure that echoes the request URL
      (url: URL) => new TypeError(`fetch failed: ${url.href}`),
    ]) {
      stub(failure);
      const errors = await Promise.all([
        fetchOwnedGamesWithAccessToken(STEAM_ID, TOKEN).catch((e: Error) => e),
        fetchFamilyPlayedGames(TOKEN).catch((e: Error) => e),
      ]);
      for (const err of errors) {
        assert.ok(err instanceof Error);
        const text = `${err.message} ${String(err.stack)} ${String((err as Error).cause ?? "")}`;
        assert.equal(text.includes(TOKEN), false, text);
      }
    }
  });
});

describe("redactSecrets", () => {
  it("removes credential values and keeps the rest readable", () => {
    assert.equal(
      redactSecrets(
        "GET https://api.example.test/v1/?key=abc123&steamid=7&access_token=tok.en-1 failed",
      ),
      "GET https://api.example.test/v1/?key=[redacted]&steamid=7&access_token=[redacted] failed",
    );
    assert.equal(
      redactSecrets('headers: {"x-webapi-key":"abc123","Authorization":"Bearer tok"}'),
      'headers: {"x-webapi-key":"[redacted]","Authorization":"[redacted]"}',
    );
    assert.equal(redactSecrets("monkey=1&turkey=2"), "monkey=1&turkey=2");
  });
});
