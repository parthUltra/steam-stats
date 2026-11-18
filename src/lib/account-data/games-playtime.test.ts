import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  augmentPlayedWithOwnedLicenses,
  buildPlaytimeAnalytics,
  mergeFamilyFlag,
  mergePlayedGames,
  parseGamesPlayedHtml,
  type PlayedGame,
} from "./games-playtime";
import { parseSteamDate } from "../dates";

/** The games page's LAST PLAYED label, resolved against the fetch time. */
const parseLastPlayedAt = (text: string, now: Date) =>
  parseSteamDate(text, { now })?.getTime() ?? null;

function played(extra: Partial<PlayedGame>): PlayedGame {
  return {
    appId: 1,
    name: "Game",
    hoursForever: 1,
    hours2Weeks: null,
    lastPlayedText: null,
    lastPlayedAt: null,
    minutesForever: 60,
    ...extra,
  };
}

describe("parseGamesPlayedHtml", () => {
  it("reads playtime_2weeks and rtime_last_played after playtime_forever", () => {
    const html = `
      <a href="https://store.steampowered.com/app/2062430" class="wfG8VGEsVTw-">BALL x PIT</a>
      <span class="bJu5kygBbe4-">LAST TWO WEEKS</span>2.3 hours
      <span class="bJu5kygBbe4-">TOTAL PLAYED</span>2.3 hours
      var x = "{\\"appid\\":2062430,\\"name\\":\\"BALL x PIT\\",\\"playtime_forever\\":140,\\"playtime_2weeks\\":140,\\"playtime_disconnected\\":0,\\"rtime_last_played\\":1786477209}";
    `;
    const games = parseGamesPlayedHtml(html);
    assert.equal(games.length, 1);
    const g = games[0];
    assert.equal(g.appId, 2062430);
    assert.equal(g.hours2Weeks, 140 / 60);
    assert.equal(g.lastPlayedAt, 1786477209 * 1000);
    assert.ok(g.lastPlayedText);
  });

  it("parses LAST TWO WEEKS minutes from cards", () => {
    const html = `
      <a href="https://store.steampowered.com/app/1091500" class="wfG8VGEsVTw-">Cyberpunk 2077</a>
      <span class="bJu5kygBbe4-">LAST TWO WEEKS</span>37 minutes
      <span class="bJu5kygBbe4-">TOTAL PLAYED</span>163.7 hours
    `;
    const games = parseGamesPlayedHtml(html);
    assert.equal(games.length, 1);
    assert.ok(Math.abs((games[0].hours2Weeks ?? 0) - 37 / 60) < 1e-9);
  });
});

describe("mergePlayedGames", () => {
  it("keeps the fuller library while taking newer last-played from HTML", () => {
    const base = [
      {
        appId: 1,
        name: "Old",
        hoursForever: 10,
        hours2Weeks: null,
        lastPlayedText: "1 Jan",
        lastPlayedAt: 1000,
        minutesForever: 600,
      },
      {
        appId: 2,
        name: "OnlyInApi",
        hoursForever: 5,
        hours2Weeks: null,
        lastPlayedText: null,
        lastPlayedAt: null,
        minutesForever: 300,
      },
    ];
    const html = [
      {
        appId: 1,
        name: "Old",
        hoursForever: 12,
        hours2Weeks: 1.5,
        lastPlayedText: "12 Aug",
        lastPlayedAt: 2000,
        minutesForever: 720,
      },
      {
        appId: 3,
        name: "NewFromHtml",
        hoursForever: 2,
        hours2Weeks: 2,
        lastPlayedText: "12 Aug",
        lastPlayedAt: 3000,
        minutesForever: 120,
      },
    ];
    const merged = mergePlayedGames(base, html);
    assert.equal(merged.length, 3);
    const one = merged.find((g) => g.appId === 1)!;
    assert.equal(one.hoursForever, 12);
    assert.equal(one.hours2Weeks, 1.5);
    assert.equal(one.lastPlayedAt, 2000);
    assert.equal(one.lastPlayedText, "12 Aug");
    assert.ok(merged.some((g) => g.appId === 2));
    assert.ok(merged.some((g) => g.appId === 3));
  });

  it("keeps family-only when HTML playtime has no family flag", () => {
    const html = [
      {
        appId: 7,
        name: "007 First Light",
        hoursForever: 2,
        hours2Weeks: null,
        lastPlayedText: "1 Aug",
        lastPlayedAt: 1000,
        minutesForever: 120,
      },
    ];
    const family = [
      {
        appId: 7,
        name: "007 First Light",
        hoursForever: 2,
        hours2Weeks: null,
        lastPlayedText: "1 Aug",
        lastPlayedAt: 1000,
        minutesForever: 120,
        fromFamily: true,
      },
    ];
    const merged = mergePlayedGames(html, family);
    assert.equal(merged[0].fromFamily, true);
  });

  it("lets the incoming (fresh) family flag decide; unknown keeps the stored one", () => {
    // stale stored `false` (wiped by an old merge) must not beat a fresh `true`
    assert.equal(mergeFamilyFlag(false, true), true);
    // bought since the last fetch: fresh `false` replaces a stored `true`
    assert.equal(mergeFamilyFlag(true, false), false);
    // incoming source has no opinion (HTML scrape) → stored value survives
    assert.equal(mergeFamilyFlag(true, undefined), true);
    assert.equal(mergeFamilyFlag(false, undefined), false);
    assert.equal(mergeFamilyFlag(undefined, true), true);
    assert.equal(mergeFamilyFlag(undefined, undefined), undefined);
  });

  it("a fresh family=true fetch corrects a stale stored family=false row", () => {
    const stored = [played({ appId: 7, name: "007 First Light", fromFamily: false })];
    const fresh = [played({ appId: 7, name: "007 First Light", fromFamily: true })];
    assert.equal(mergePlayedGames(stored, fresh)[0].fromFamily, true);
  });

  it("an HTML scrape without family flags does not change a stored flag", () => {
    const stored = [
      played({ appId: 7, fromFamily: true }),
      played({ appId: 8, fromFamily: false }),
    ];
    const html = [played({ appId: 7 }), played({ appId: 8 })];
    const merged = mergePlayedGames(stored, html);
    assert.equal(merged.find((g) => g.appId === 7)!.fromFamily, true);
    assert.equal(merged.find((g) => g.appId === 8)!.fromFamily, false);
  });
});

describe("parseGamesPlayedHtml edge cases", () => {
  const card = (id: number, name: string, body: string) =>
    `<a href="https://store.steampowered.com/app/${id}" class="wfG8VGEsVTw-">${name}</a>${body}`;

  it("does not read the next card's hours for a card without TOTAL PLAYED", () => {
    const html =
      card(10, "Never Played", `<span>LAST PLAYED</span>2 Aug`) +
      card(20, "Big One", `<span>TOTAL PLAYED</span>1,234.5 hours`);
    const games = parseGamesPlayedHtml(html);
    assert.equal(games.find((g) => g.appId === 10)!.hoursForever, 0);
    assert.equal(games.find((g) => g.appId === 20)!.hoursForever, 1234.5);
  });

  it("reads a decimal comma as a decimal, a 3-digit group as thousands", () => {
    const html =
      card(10, "Comma", `<span>TOTAL PLAYED</span>2,3 hours`) +
      card(20, "Thousands", `<span>TOTAL PLAYED</span>1,234 hours`);
    const games = parseGamesPlayedHtml(html);
    assert.equal(games.find((g) => g.appId === 10)!.hoursForever, 2.3);
    assert.equal(games.find((g) => g.appId === 20)!.hoursForever, 1234);
  });
});

describe("parseGamesPlayedHtml — fetch time, not the wall clock", () => {
  const card = (id: number, name: string, last: string) =>
    `<a href="https://store.steampowered.com/app/${id}" class="wfG8VGEsVTw-">${name}</a>` +
    `<span>TOTAL PLAYED</span>3 hours<span>LAST PLAYED</span>${last}`;
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
  const html = card(1, "Yearless", "14 Dec") + card(2, "Todays", "Today") + card(3, "Dated", "26 May 2025");

  it("resolves year-less and relative labels against the fetch time", () => {
    const games = parseGamesPlayedHtml(html, "2026-08-17T12:00:00");
    const by = (id: number) => games.find((g) => g.appId === id)!;
    assert.equal(by(1).lastPlayedAt, at(2025, 12, 14));
    assert.equal(by(2).lastPlayedAt, at(2026, 8, 17));
    assert.equal(by(3).lastPlayedAt, at(2025, 5, 26));
  });

  it("leaves them undated when the fetch time is unknown", () => {
    const games = parseGamesPlayedHtml(html);
    const by = (id: number) => games.find((g) => g.appId === id)!;
    assert.equal(by(1).lastPlayedAt, null);
    assert.equal(by(1).lastPlayedText, "14 Dec");
    assert.equal(by(2).lastPlayedAt, null);
    assert.equal(by(3).lastPlayedAt, at(2025, 5, 26));
  });

  it("labels JSON rows with an ISO date and keeps Steam's exact fields", () => {
    const rtime = 1786477209;
    const json =
      `x = "{\\"appid\\":77,\\"name\\":\\"Json Only\\",\\"playtime_forever\\":140,` +
      `\\"playtime_2weeks\\":35,\\"playtime_windows_forever\\":100,\\"playtime_deck_forever\\":40,` +
      `\\"playtime_disconnected\\":3,\\"rtime_last_played\\":${rtime}}";`;
    const [g] = parseGamesPlayedHtml(json);
    assert.equal(g.appId, 77);
    assert.equal(g.lastPlayedAt, rtime * 1000);
    assert.equal(g.lastPlayedText, new Date(rtime * 1000).toISOString().slice(0, 10));
    assert.equal(g.rtimeLastPlayed, rtime);
    assert.equal(g.minutes2Weeks, 35);
    assert.equal(g.minutesWindows, 100);
    assert.equal(g.minutesDeck, 40);
    assert.equal(g.minutesDisconnected, 3);
    assert.equal(g.minutesMac, undefined);
  });
});

describe("mergePlayedGames — Steam API detail fields", () => {
  it("keeps stored detail when the incoming row has none, and takes fresher detail", () => {
    const stored = [
      played({ appId: 1, minutesWindows: 400, minutesDeck: 150, minutes2Weeks: 30, rtimeLastPlayed: 100 }),
    ];
    const fromHtml = mergePlayedGames(stored, [played({ appId: 1 })])[0];
    assert.equal(fromHtml.minutesWindows, 400);
    assert.equal(fromHtml.minutesDeck, 150);
    assert.equal(fromHtml.minutes2Weeks, 30);
    assert.equal(fromHtml.rtimeLastPlayed, 100);

    const fresh = mergePlayedGames(stored, [
      played({ appId: 1, minutesWindows: 460, minutes2Weeks: 0, rtimeLastPlayed: 200, minutesLinux: 5 }),
    ])[0];
    assert.equal(fresh.minutesWindows, 460);
    assert.equal(fresh.minutes2Weeks, 0);
    assert.equal(fresh.rtimeLastPlayed, 200);
    assert.equal(fresh.minutesLinux, 5);
    assert.equal(fresh.minutesDeck, 150);
  });
});

describe("parseLastPlayedAt", () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d).getTime();
  const now = new Date(2026, 10, 17, 12); // 17 Nov 2026

  it("parses the labels Steam shows today", () => {
    assert.equal(parseLastPlayedAt("2 Aug", now), at(2026, 8, 2));
    assert.equal(parseLastPlayedAt("26 May 2025", now), at(2025, 5, 26));
  });

  it("rolls a year-less date that would be in the future back a year", () => {
    assert.equal(parseLastPlayedAt("14 Dec", now), at(2025, 12, 14));
  });

  it("parses month-first labels, with and without a year", () => {
    assert.equal(parseLastPlayedAt("Aug 2", now), at(2026, 8, 2));
    assert.equal(parseLastPlayedAt("Aug 2, 2025", now), at(2025, 8, 2));
  });

  it("parses 29 Feb in a non-leap year as the last leap day", () => {
    assert.equal(parseLastPlayedAt("29 Feb", now), at(2024, 2, 29));
  });

  it("parses Today / Yesterday relative to now", () => {
    assert.equal(parseLastPlayedAt("Today", now), at(2026, 11, 17));
    assert.equal(parseLastPlayedAt("Yesterday", now), at(2026, 11, 16));
  });
});

describe("buildPlaytimeAnalytics", () => {
  it("ignores non-finite hours in totals", () => {
    const a = buildPlaytimeAnalytics([
      played({ appId: 1, hoursForever: 10 }),
      played({ appId: 2, hoursForever: Number.NaN }),
    ]);
    assert.equal(a.totalHours, 10);
    assert.equal(a.gamesPlayed, 1);
  });
});

describe("augmentPlayedWithOwnedLicenses", () => {
  it("adds unplayed owned titles and stamps addedAt on matches", () => {
    const games = [
      {
        appId: 2062430,
        name: "BALL x PIT",
        hoursForever: 2.3,
        hours2Weeks: 2.3,
        lastPlayedText: "11 Aug",
        lastPlayedAt: 1000,
        minutesForever: 140,
      },
    ];
    const licenses = [
      { item: "BALL x PIT", dateText: "11 Aug, 2026", addedAt: 5000 },
      { item: "CloverPit", dateText: "11 Aug, 2026", addedAt: 5000 },
      { item: "Unknown Soft", dateText: "1 Jan, 2026", addedAt: 1 },
    ];
    const ids: Record<string, number> = {
      cloverpit: 3314790,
    };
    const out = augmentPlayedWithOwnedLicenses(
      games,
      licenses,
      (title) => ids[title.toLowerCase().replace(/[^a-z0-9]+/g, "")] ?? null,
    );
    assert.equal(out.length, 2);
    const ball = out.find((g) => g.appId === 2062430)!;
    assert.equal(ball.addedAt, 5000);
    assert.equal(ball.addedText, "11 Aug, 2026");
    const clover = out.find((g) => g.appId === 3314790)!;
    assert.equal(clover.name, "CloverPit");
    assert.equal(clover.hoursForever, 0);
    assert.equal(clover.addedAt, 5000);
  });
});
