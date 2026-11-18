/**
 * Golden totals: buildDashboard() over the synthetic library must equal the
 * hand-derived numbers in tests/fixtures/library-a/expected.json.
 *
 * A tag like [A9] in a test name is the finding id in the correctness audit
 * that the fixture row exercises. When such a test fails, the expectation is
 * right and the code is wrong — do not edit expected.json to match.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildDashboard } from "@/lib/analytics/dashboard";
import type { DashboardPayload } from "@/lib/analytics/contracts";
import type { ValuationGame } from "@/lib/analytics/valuation";
import { assertNear, near, readExpected } from "../helpers";

type ExpectedApp = {
  title: string;
  kind: string;
  paid: number;
  now: number;
  lowest: number;
};
type Expected = {
  meta: Record<string, string | number>;
  playtime: {
    steamId: string;
    source: string;
    gamesInSnapshot: number;
    gameCount: number;
    gamesPlayed: number;
    totalHours: number;
    recentHours2Weeks: number;
    topGameAppId: number;
    familyAppIds: number[];
  };
  spending: {
    currency: string;
    netSpent: number;
    purchaseCount: number;
    refundedTotal: number;
    giftSpend: number;
    walletTopUps: number;
    marketSpendAccepted: number[];
    marketSpendBuggy: number;
    pctBoughtOnSale: number;
    avgDiscountWhenOnSale: number;
    saleSavings: number;
    yearly: Record<string, { spent: number; count: number }>;
    paymentMethods: Record<string, number>;
    valveSpendUsd: Record<string, number>;
  };
  valuation: {
    librarySpent: number;
    shelfNow: number;
    shelfLowest: number;
    giftsReceived: { appIds: number[]; current: number; lowest: number };
    giftsSent: { title: string; paid: number; giftedTo: string }[];
    notOnShelfAppIds: number[];
    unresolved: { appId: number; title: string; paid: number };
    pack: { title: string; paid: number };
    apps: Record<string, ExpectedApp>;
  };
  costPerHour: {
    played: Record<string, { paid: number; hours: number; costPerHour: number }>;
    unplayed: Record<string, { paid: number; hours: number }>;
    bestValueAppId: number;
    worstValueAppId: number;
    biggestUnplayedAppId: number;
  };
};

/** Which audit finding a shelf row exercises (shown in the test name). */
const SHELF_TAGS: Record<string, string> = {
  "9000001": "real DLC folds into its base",
  "9000003": "A2: a 'Base: Subtitle' game is not DLC of the base",
  "9000007": "A5: 100%-off promo must not wipe the cost basis",
  "9000009": "A14: sequel keeps its own app id / row",
  "9000010": "A1: edition purchase counted once",
  "9000011": "A3: 'Gourmet Edition' SKU is the owned game",
  "9000020": "A13: partial refund keeps the other game",
  "9000021": "A12: mixed checkout keeps the game",
  "9000022": "A2: a 'Base: Subtitle' game is not DLC of the base",
  "9000023": "single-app 'Collection' is a normal game",
  "9000024": "pack member",
  "9000025": "pack member",
  "9000026": "A17: unrelated base must not absorb another game",
  "9000027": "A17: unrelated base must not absorb another game",
  "9000039": "A3: free-to-keep promo licence is owned",
  "9000043": "gift known only from the e-mail record",
  "9000044": "A3: free-to-keep promo licence is owned",
};

const COST_TAGS: Record<string, string> = {
  "9000001": "base + DLC cost",
  "9000003": "A2",
  "9000008": "A14",
  "9000009": "A14: no playtime row, must not borrow Ironroot's 120 h",
  "9000010": "A1",
  "9000011": "A3",
  "9000014": "split payment still one ₹1,500 purchase",
  "9000015": "exactly 30 min → rated on the 1 h floor",
  "9000022": "A2",
  "9000023": "A15: single-app 'Collection' is rated",
  "9000026": "A17",
  "9000027": "A17",
};

const effNow = (g: { current: number | null; lowest: number | null }) =>
  g.current != null && g.current > 0
    ? g.current
    : g.lowest != null && g.lowest > 0
      ? g.lowest
      : 0;
const effLowest = (g: { lowest: number | null; kind: string }) =>
  g.kind === "free" ? 0 : g.lowest != null && g.lowest > 0 ? g.lowest : 0;

const exp = readExpected<Expected>();
let d: DashboardPayload;

const shelfRows = (appId: number): ValuationGame[] =>
  d.valuation.games.filter((g) => g.steamAppId === appId);

before(async () => {
  d = await buildDashboard();
});

describe("meta", () => {
  it("reads the parsed JSON and counts its rows", () => {
    assert.equal(d.meta.source, "parsed-json");
    assert.equal(d.meta.purchaseRows, exp.meta.purchaseRows);
    assert.equal(d.meta.licenseRows, exp.meta.licenseRows);
    assert.equal(d.meta.mailGiftsCount, exp.meta.mailGiftsCount);
  });

  it("detects the store region from the spend currency", () => {
    assert.equal(d.meta.storeCountry, exp.meta.storeCountry);
    assert.equal(d.meta.storeCurrency, exp.meta.storeCurrency);
  });

  it("reports the ITAD key as present without exposing it", () => {
    assert.equal(d.meta.hasItadApiKey, true);
    assert.equal(d.meta.hasSteamApiKey, false);
  });
});

describe("playtime", () => {
  it("totals 2,492.5 h, 41 games played, 23.1 h in the last two weeks", () => {
    assertNear(d.playtime.totalHours, exp.playtime.totalHours, "totalHours");
    assert.equal(d.playtime.gamesPlayed, exp.playtime.gamesPlayed);
    assertNear(
      d.playtime.recentHours2Weeks,
      exp.playtime.recentHours2Weeks,
      "recentHours2Weeks",
    );
  });

  it("holds 45 games: the 44 in the snapshot plus Ironroot II from its licence — DLC, packs and edition SKUs are not games [N1]", () => {
    const extra = d.playtime.games
      .filter((g) => g.appId < 9000001 || g.appId > 9000045)
      .map((g) => `${g.appId} ${g.name}`);
    assert.deepEqual(extra, [], "rows that are not library games");
    assert.equal(d.playtime.gameCount, exp.playtime.gameCount);
    assert.equal(d.meta.libraryGameCount, exp.playtime.gameCount);
  });

  it("adds the never-launched Ironroot II under its own app id [A14]", () => {
    const row = d.playtime.games.find((g) => g.appId === 9000009);
    assert.ok(row, "Ironroot II (9000009) missing from the library");
    assert.equal(row.hoursForever, 0);
  });

  it("is labelled as a full Steam API snapshot for the fixture account", () => {
    assert.equal(d.playtime.source, exp.playtime.source);
    assert.equal(d.playtime.steamId, exp.playtime.steamId);
  });

  it("ranks Starfall Tactics first and keeps the family flag", () => {
    assert.equal(d.playtime.topGames[0]?.appId, exp.playtime.topGameAppId);
    const family = d.playtime.games
      .filter((g) => g.fromFamily)
      .map((g) => g.appId);
    assert.deepEqual(family, exp.playtime.familyAppIds);
  });
});

describe("spending", () => {
  it("net spent is 22,615 over 35 purchases [A12 mixed checkout, A13 partial refund]", () => {
    assert.equal(d.spending.currency, exp.spending.currency);
    assertNear(d.spending.netSpent, exp.spending.netSpent, "netSpent");
    assert.equal(d.spending.purchaseCount, exp.spending.purchaseCount);
  });

  it("refunded total is 1,199: Broken Compass 799 + the refunded half of a cart 400 [A13]", () => {
    assertNear(
      d.spending.refundedTotal,
      exp.spending.refundedTotal,
      "refundedTotal",
    );
  });

  it("wallet top-ups are the ₹1,000 wallet credit only — a Digital Gift Card is not a top-up [A10]", () => {
    assertNear(d.spending.walletTopUps, exp.spending.walletTopUps, "walletTopUps");
  });

  it("gift spend is 4,499: two game gifts plus both Digital Gift Cards [A10, A12]", () => {
    assertNear(d.spending.giftSpend, exp.spending.giftSpend, "giftSpend");
  });

  it("a market sale (credit) is not added to market spend [A11]", () => {
    assert.ok(
      exp.spending.marketSpendAccepted.some((v) =>
        near(d.spending.marketSpend, v),
      ),
      `marketSpend: expected one of ${exp.spending.marketSpendAccepted.join(" / ")} (purchases only / net of the sale), got ${d.spending.marketSpend}`,
    );
  });

  it("split payment credits ₹200 to Steam Wallet and ₹1,300 to Visa [A9]", () => {
    const actual = Object.fromEntries(
      d.spending.paymentMethods.map((p) => [p.method, p.spent]),
    );
    assert.equal(actual["Steam Wallet"], exp.spending.paymentMethods["Steam Wallet"]);
    assert.equal(actual.Visa, exp.spending.paymentMethods.Visa);
  });

  it("payment methods add up per method: UPI 11,375 · Visa 8,291 · Mastercard 2,749 · Wallet 200 [A13 for UPI]", () => {
    const actual = Object.fromEntries(
      d.spending.paymentMethods.map((p) => [p.method, p.spent]),
    );
    assert.deepEqual(actual, exp.spending.paymentMethods);
  });

  it("yearly totals match the purchase dates [A12, A13 for 2023 and 2025]", () => {
    const actual = Object.fromEntries(
      d.spending.yearly.map((y) => [y.year, { spent: y.spent, count: y.count }]),
    );
    assert.deepEqual(actual, exp.spending.yearly);
  });

  it("monthly totals add up to net spent, and each month's lines to its total [A13]", () => {
    const monthly = d.spending.monthly.reduce((s, m) => s + m.spent, 0);
    assertNear(monthly, exp.spending.netSpent, "sum of monthly.spent");
    for (const m of d.spending.monthly) {
      const lines = m.lines.reduce((s, l) => s + l.amount, 0);
      assertNear(lines, m.spent, `lines of ${m.month}`);
    }
  });

  it("11 of 35 purchases were on sale (31.4 %) [A13 changes the denominator]", () => {
    assertNear(
      d.spending.pctBoughtOnSale,
      exp.spending.pctBoughtOnSale,
      "pctBoughtOnSale",
    );
  });

  it("on-sale purchases averaged 65.9 % off and saved 10,008 against list", () => {
    assertNear(
      d.spending.avgDiscountWhenOnSale,
      exp.spending.avgDiscountWhenOnSale,
      "avgDiscountWhenOnSale",
    );
    assertNear(d.spending.saleSavings, exp.spending.saleSavings, "saleSavings");
  });

  it("keeps Valve's own USD ledger figures as scraped", () => {
    assert.deepEqual(d.spending.valveSpendUsd, exp.spending.valveSpendUsd);
  });
});

describe("valuation", () => {
  it("library spent equals net spent [A13]", () => {
    assertNear(d.valuation.librarySpent, exp.valuation.librarySpent, "librarySpent");
  });

  it("per-title paid adds up to net spent — nothing counted twice, nothing lost [A1, A2, A13, A17]", () => {
    const sum = d.valuation.games.reduce((s, g) => s + (g.paid ?? 0), 0);
    assertNear(sum, exp.spending.netSpent, "sum of valuation.games[].paid");
  });

  for (const [id, want] of Object.entries(exp.valuation.apps)) {
    const tag = SHELF_TAGS[id] ? ` [${SHELF_TAGS[id]}]` : "";
    it(`shelf row ${id} ${want.title}: ${want.kind}, paid ${want.paid}, now ${want.now}, lowest ${want.lowest}${tag}`, () => {
      const rows = shelfRows(Number(id));
      assert.equal(
        rows.length,
        1,
        `expected exactly one shelf row for app ${id}, got ${rows.length}: ${rows.map((r) => r.title).join(" | ") || "none"}`,
      );
      const got = rows[0];
      assert.deepEqual(
        {
          kind: got.kind,
          paid: got.paid ?? 0,
          now: effNow(got),
          lowest: effLowest(got),
        },
        { kind: want.kind, paid: want.paid, now: want.now, lowest: want.lowest },
      );
    });
  }

  it("shelf now totals 44,210", () => {
    assertNear(d.valuation.shelfFull.current, exp.valuation.shelfNow, "shelfFull.current");
  });

  it("shelf lowest totals 16,766", () => {
    assertNear(d.valuation.shelfFull.lowest, exp.valuation.shelfLowest, "shelfFull.lowest");
  });

  it("the free-weekend and family-library games are not on the shelf", () => {
    for (const id of exp.valuation.notOnShelfAppIds) {
      const rows = shelfRows(id);
      assert.equal(
        rows.length,
        0,
        `app ${id} must not be valued: ${rows.map((r) => r.title).join(" | ")}`,
      );
    }
  });

  it("the pack row carries its ₹810 and no shelf price", () => {
    const pack = d.valuation.games.find((g) => g.title === exp.valuation.pack.title);
    assert.ok(pack, "Lanternfall Collection row missing");
    assert.equal(pack.paid, exp.valuation.pack.paid);
    assert.equal(effNow(pack), 0);
  });

  it("an owned game with no price quote keeps its cost and is listed as unresolved", () => {
    const u = exp.valuation.unresolved;
    const row = d.valuation.games.find((g) => g.title === u.title);
    assert.ok(row, `${u.title} row missing`);
    assert.equal(row.paid, u.paid);
    assert.equal(row.resolved, false);
    assert.equal(row.steamAppId, u.appId, "app id hydrated from playtime");
    assert.ok(d.valuation.unresolvedTitles.includes(u.title));
  });

  it("gifts received: Marrow Deep (licence) and Pocket Cartographer (e-mail, from juniper_fox)", () => {
    const got = d.valuation.giftsReceivedGames
      .map((g) => g.steamAppId)
      .sort();
    assert.deepEqual(got, exp.valuation.giftsReceived.appIds);
    assertNear(
      d.valuation.giftsReceived.current,
      exp.valuation.giftsReceived.current,
      "giftsReceived.current",
    );
    assertNear(
      d.valuation.giftsReceived.lowest,
      exp.valuation.giftsReceived.lowest,
      "giftsReceived.lowest",
    );
    const mail = d.valuation.giftsReceivedGames.find(
      (g) => g.steamAppId === 9000043,
    );
    assert.equal(mail?.giftedFrom, "juniper_fox");
  });

  it("gifts sent lists all three gifted games with recipient and cost, incl. the one without transaction detail [A19]", () => {
    const got = d.valuation.giftsSentGames
      .map((g) => ({ title: g.title, paid: g.paid, giftedTo: g.giftedTo }))
      .sort((a, b) => a.title.localeCompare(b.title));
    assert.deepEqual(got, exp.valuation.giftsSent);
  });

  it("your own copy of a game you also gifted keeps its own cost (Glass Orchard 249, not 499)", () => {
    assert.equal(shelfRows(9000006)[0]?.paid, 249);
  });
});

describe("cost per hour", () => {
  const find = (id: number) =>
    [...d.costPerHour.playedPaid, ...d.costPerHour.unplayedPaid].filter(
      (g) => g.steamAppId === id,
    );

  for (const [id, want] of Object.entries(exp.costPerHour.played)) {
    const tag = COST_TAGS[id] ? ` [${COST_TAGS[id]}]` : "";
    it(`app ${id}: ₹${want.paid} over ${want.hours} h = ${want.costPerHour.toFixed(2)}/h${tag}`, () => {
      const rows = find(Number(id));
      assert.equal(rows.length, 1, `expected one cost/hr row for app ${id}, got ${rows.length}`);
      assertNear(rows[0].paid, want.paid, "paid");
      assertNear(rows[0].hours, want.hours, "hours");
      assertNear(rows[0].costPerHour, want.costPerHour, "costPerHour");
    });
  }

  for (const [id, want] of Object.entries(exp.costPerHour.unplayed)) {
    const tag = COST_TAGS[id] ? ` [${COST_TAGS[id]}]` : "";
    it(`app ${id}: ₹${want.paid}, ${want.hours} h → unplayed, no rate${tag}`, () => {
      const rows = find(Number(id));
      assert.equal(rows.length, 1, `expected one cost/hr row for app ${id}, got ${rows.length}`);
      assertNear(rows[0].paid, want.paid, "paid");
      assertNear(rows[0].hours, want.hours, "hours");
      assert.equal(rows[0].costPerHour, null);
    });
  }

  it("best value is Hollow Circuit, worst is Hearthbound, biggest unplayed is Ironroot II [A2, A14]", () => {
    assert.equal(d.costPerHour.bestValue?.steamAppId, exp.costPerHour.bestValueAppId);
    assert.equal(d.costPerHour.worstValue?.steamAppId, exp.costPerHour.worstValueAppId);
    assert.equal(
      d.costPerHour.biggestUnplayed?.steamAppId,
      exp.costPerHour.biggestUnplayedAppId,
    );
  });

  it("never rates a game above what was paid for it", () => {
    for (const g of d.costPerHour.playedPaid) {
      assert.ok(
        g.costPerHour != null && g.costPerHour <= g.paid + 1e-9,
        `${g.title}: ${g.costPerHour}/h > paid ${g.paid}`,
      );
    }
  });
});

describe("artwork", () => {
  it("every library game has offline artwork (data: URIs from the fixture cache)", () => {
    for (const g of d.playtime.games) {
      if (g.appId > 9000045) continue;
      const art = d.artwork[String(g.appId)];
      assert.ok(art, `no artwork entry for ${g.appId} ${g.name}`);
      for (const url of [art.library, art.header, art.capsule]) {
        assert.ok(url.startsWith("data:image/svg+xml"), `${g.name}: ${url.slice(0, 60)}`);
      }
    }
  });
});
