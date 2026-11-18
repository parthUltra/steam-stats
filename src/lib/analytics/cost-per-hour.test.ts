import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayedGame } from "../account-data";
import { buildCostPerHourAnalytics } from "./cost-per-hour";
import type { ValuationGame } from "./valuation";

function shelf(title: string, extra: Partial<ValuationGame> = {}): ValuationGame {
  return {
    title,
    paid: null,
    current: null,
    lowest: null,
    steamAppId: null,
    onSale: false,
    resolved: true,
    kind: "purchased",
    isGift: false,
    isUnpaidShelf: false,
    ...extra,
  };
}

function played(appId: number, name: string, hoursForever: number): PlayedGame {
  return {
    appId,
    name,
    hoursForever,
    hours2Weeks: null,
    lastPlayedText: null,
    lastPlayedAt: null,
    minutesForever: Math.round(hoursForever * 60),
  };
}

const row = (a: ReturnType<typeof buildCostPerHourAnalytics>, title: string) =>
  a.games.find((g) => g.title === title);

describe("buildCostPerHourAnalytics — matching hours", () => {
  it("does not borrow a prequel's hours for a sequel with no playtime row", () => {
    const a = buildCostPerHourAnalytics(
      [
        shelf("Slay the Spire 2", { paid: 990 }),
        shelf("Portal 2", { paid: 100, steamAppId: 620 }),
      ],
      [played(646570, "Slay the Spire", 300), played(400, "Portal", 12)],
      "INR",
    );
    const sts2 = row(a, "Slay the Spire 2")!;
    assert.equal(sts2.hours, 0);
    assert.equal(sts2.costPerHour, null);
    assert.notEqual(sts2.steamAppId, 646570);
    const portal2 = row(a, "Portal 2")!;
    assert.equal(portal2.hours, 0);
    assert.equal(portal2.steamAppId, 620);
    assert.equal(a.playedPaid.length, 0);
  });

  it("does not borrow the base game's hours for a 'Base: Subtitle' game", () => {
    const a = buildCostPerHourAnalytics(
      [
        shelf("Hollow Knight", { paid: 345, steamAppId: 367520 }),
        shelf("Hollow Knight: Silksong", { paid: 900, steamAppId: 1030300 }),
      ],
      [played(367520, "Hollow Knight", 10)],
      "INR",
    );
    assert.equal(row(a, "Hollow Knight")!.costPerHour, 34.5);
    assert.equal(row(a, "Hollow Knight: Silksong")!.hours, 0);
    assert.equal(row(a, "Hollow Knight: Silksong")!.costPerHour, null);
  });

  it("still matches an edition / store SKU to the played title", () => {
    const a = buildCostPerHourAnalytics(
      [
        shelf("Titanfall® 2: Ultimate Edition", { paid: 224 }),
        shelf("The Witcher: Enhanced Edition (ROW)", { paid: 49 }),
        shelf("Overcooked! 2 - Gourmet Edition", { paid: 324 }),
      ],
      [
        played(1237970, "Titanfall® 2", 8),
        played(20900, "The Witcher: Enhanced Edition", 7),
        played(728880, "Overcooked! 2", 4),
      ],
      "INR",
    );
    assert.equal(row(a, "Titanfall® 2: Ultimate Edition")!.costPerHour, 28);
    assert.equal(row(a, "The Witcher: Enhanced Edition (ROW)")!.costPerHour, 7);
    assert.equal(row(a, "Overcooked! 2 - Gourmet Edition")!.costPerHour, 81);
  });
});

describe("buildCostPerHourAnalytics — hours thresholds", () => {
  it("treats under 30 minutes as unplayed and floors the divisor at 1 hour", () => {
    const a = buildCostPerHourAnalytics(
      [
        shelf("Zero", { paid: 100, steamAppId: 1 }),
        shelf("Barely", { paid: 100, steamAppId: 2 }),
        shelf("Half", { paid: 100, steamAppId: 3 }),
        shelf("Ten", { paid: 100, steamAppId: 4 }),
        shelf("Broken", { paid: 100, steamAppId: 5 }),
      ],
      [
        played(1, "Zero", 0),
        played(2, "Barely", 0.4),
        played(3, "Half", 0.5),
        played(4, "Ten", 10),
        played(5, "Broken", Number.NaN),
      ],
      "INR",
    );
    assert.equal(row(a, "Zero")!.costPerHour, null);
    assert.equal(row(a, "Barely")!.costPerHour, null);
    assert.equal(row(a, "Half")!.costPerHour, 100);
    assert.equal(row(a, "Ten")!.costPerHour, 10);
    assert.equal(row(a, "Broken")!.hours, 0);
    assert.equal(row(a, "Broken")!.costPerHour, null);
    // blended: (100 + 100) / (1 + 10)
    assert.equal(a.blendedCostPerHour, 200 / 11);
    assert.equal(a.totalHoursMatched, 11);
    // The divisor floors "Half" at 1 h; the hours actually played are 0.5 + 10
    assert.equal(a.totalHoursRateDivisor, 11);
    assert.equal(a.totalHoursPlayed, 10.5);
  });
});

describe("buildCostPerHourAnalytics — collections and packs", () => {
  it("rates a single-app 'Collection' like any other game", () => {
    const a = buildCostPerHourAnalytics(
      [shelf("Halo: The Master Chief Collection", { paid: 224, steamAppId: 976730 })],
      [played(976730, "Halo: The Master Chief Collection", 20)],
      "INR",
    );
    assert.equal(row(a, "Halo: The Master Chief Collection")!.costPerHour, 11.2);
  });

  const members = [
    shelf("BioShock Remastered", { kind: "bundle", paid: 0, current: 600, steamAppId: 409710 }),
    shelf("BioShock 2 Remastered", { kind: "bundle", paid: 0, current: 600, steamAppId: 409720 }),
    shelf("BioShock Infinite", { kind: "bundle", paid: 0, current: 800, steamAppId: 8870 }),
  ];
  const hours = [
    played(409710, "BioShock Remastered", 10),
    played(8870, "BioShock Infinite", 20),
  ];

  it("splits a pack's price across the games it covers, by shelf price", () => {
    const a = buildCostPerHourAnalytics(
      [shelf("BioShock The Collection", { paid: 500 }), ...members],
      hours,
      "INR",
    );
    // 500 × 600/2000, 600/2000, 800/2000
    assert.equal(row(a, "BioShock The Collection"), undefined);
    assert.equal(row(a, "BioShock Remastered")!.paid, 150);
    assert.equal(row(a, "BioShock Remastered")!.costPerHour, 15);
    assert.equal(row(a, "BioShock 2 Remastered")!.paid, 150);
    assert.equal(row(a, "BioShock 2 Remastered")!.costPerHour, null);
    assert.equal(row(a, "BioShock Infinite")!.paid, 200);
    assert.equal(row(a, "BioShock Infinite")!.costPerHour, 10);
    assert.equal(a.totalPaidMatched, 350);
  });

  it("splits evenly when the covered games have no shelf price", () => {
    const a = buildCostPerHourAnalytics(
      [
        shelf("BioShock The Collection", { paid: 600 }),
        ...members.map((m) => ({ ...m, current: null })),
      ],
      hours,
      "INR",
    );
    assert.deepEqual(
      a.games.map((g) => g.paid),
      [200, 200, 200],
    );
  });

  it("adds the pack share to what was paid for a game bought on its own too", () => {
    const a = buildCostPerHourAnalytics(
      [
        shelf("METAL SLUG Bundle", { paid: 300 }),
        shelf("METAL SLUG", { paid: 50, current: 100, steamAppId: 1 }),
        shelf("METAL SLUG 3", { kind: "bundle", paid: 0, current: 100, steamAppId: 2 }),
      ],
      [played(1, "METAL SLUG", 5)],
      "INR",
    );
    assert.equal(row(a, "METAL SLUG")!.paid, 200);
    assert.equal(row(a, "METAL SLUG")!.costPerHour, 40);
    assert.equal(row(a, "METAL SLUG 3")!.paid, 150);
  });
});
