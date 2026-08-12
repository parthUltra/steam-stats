import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  augmentPlayedWithOwnedLicenses,
  mergePlayedGames,
  parseGamesPlayedHtml,
} from "./games-playtime";

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
