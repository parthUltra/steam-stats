import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlayedGame, PurchaseHistoryRow } from "../account-data";
import type { GamePriceQuote, PriceCache } from "../pricing/prices";
import { buildCostPerHourAnalytics } from "./cost-per-hour";
import { buildSpendingAnalytics } from "./spending";
import { buildLibraryValuation } from "./valuation";

const money = (amount: number, currency = "INR") => ({
  raw: `${amount}`,
  amount,
  currencyHint: currency,
});

/** A purchase row: `lines` are [name, amount]; total is their sum. */
function buy(
  lines: [string, number][],
  extra?: Partial<PurchaseHistoryRow>,
): PurchaseHistoryRow {
  const total = lines.reduce((s, [, a]) => s + a, 0);
  return {
    dateText: "1 Jan, 2024",
    items: lines.map(([name]) => name),
    lineItems: lines.map(([name, amount]) => ({
      name,
      amount,
      currencyHint: "INR",
      raw: `${amount}`,
    })),
    type: "Purchase",
    paymentMethods: ["Visa **77"],
    isGift: false,
    price: money(total),
    originalPrice: null,
    discountedPrice: null,
    discountPct: null,
    tax: null,
    shipping: null,
    total: money(total),
    walletChange: null,
    walletBalance: null,
    transactionId: null,
    refunded: false,
    isWalletBalanceChange: false,
    ...extra,
  };
}

function quote(
  title: string,
  steamAppId: number,
  current: number,
  lowest: number | null = null,
): GamePriceQuote {
  return {
    title,
    steamAppId,
    currentInr: current,
    lowestInr: lowest,
    retailInr: current,
    lowestUsd: null,
    currentUsd: null,
    retailUsd: null,
    onSale: false,
    source: "steam",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function cache(quotes: GamePriceQuote[]): PriceCache {
  return {
    updatedAt: "2026-01-01T00:00:00.000Z",
    country: "IN",
    currency: "INR",
    quotes: Object.fromEntries(
      quotes.map((q) => [q.title.toLowerCase().replace(/™|®/g, ""), q]),
    ),
  };
}

function value(
  purchases: PurchaseHistoryRow[],
  quotes: GamePriceQuote[],
  opts: { ownedTitles?: string[]; dlcParents?: Map<number, number> } = {},
) {
  const spending = buildSpendingAnalytics(purchases, [], []);
  const valuation = buildLibraryValuation(purchases, [], cache(quotes), spending, {
    ownedTitles: opts.ownedTitles ?? [],
    dlcParents: opts.dlcParents ?? new Map(),
  });
  return { spending, valuation };
}

const paidOf = (games: { title: string; paid: number | null }[]) =>
  Object.fromEntries(games.map((g) => [g.title, g.paid]));
const sumPaid = (games: { paid: number | null }[]) =>
  games.reduce((s, g) => s + (g.paid ?? 0), 0);

describe("buildLibraryValuation — one purchase, one cost basis", () => {
  it("counts an edition purchase once when the base title is on the shelf (no quotes)", () => {
    const { valuation } = value(
      [buy([["Titanfall® 2: Ultimate Edition", 224]])],
      [],
      { ownedTitles: ["Titanfall® 2"] },
    );
    assert.equal(valuation.games.length, 1);
    assert.equal(valuation.games[0].paid, 224);
  });

  it("counts an edition purchase once and does not add the two shelf prices", () => {
    const { valuation } = value(
      [buy([["Ori and the Blind Forest: Definitive Edition", 292]])],
      [
        quote("Ori and the Blind Forest", 261570, 1299, 259),
        quote("Ori and the Blind Forest: Definitive Edition", 387290, 1299, 259),
      ],
      {
        ownedTitles: [
          "Ori and the Blind Forest",
          "Ori and the Blind Forest: Definitive Edition",
        ],
      },
    );
    assert.equal(valuation.games.length, 1);
    assert.equal(valuation.games[0].paid, 292);
    assert.equal(valuation.games[0].current, 1299);
    assert.equal(valuation.games[0].lowest, 259);
    assert.equal(valuation.shelfFull.current, 1299);
  });

  it("adds up two editions that were bought in separate checkouts", () => {
    const { valuation, spending } = value(
      [buy([["Mafia: Definitive Edition", 200]]), buy([["Mafia", 100]])],
      [],
    );
    assert.equal(valuation.games.length, 1);
    assert.equal(valuation.games[0].paid, 300);
    assert.equal(spending.netSpent, 300);
  });
});

describe("buildLibraryValuation — DLC folding", () => {
  const hollow = [
    buy([["Hollow Knight", 345]]),
    buy([["Hollow Knight: Silksong", 900]]),
  ];

  it("keeps a standalone 'Base: Subtitle' game as its own row", () => {
    const { valuation } = value(hollow, [
      quote("Hollow Knight", 367520, 690),
      quote("Hollow Knight: Silksong", 1030300, 900),
    ]);
    assert.deepEqual(paidOf(valuation.games), {
      "Hollow Knight": 345,
      "Hollow Knight: Silksong": 900,
    });
  });

  it("keeps it apart when the subtitle game has no price quote either", () => {
    const { valuation } = value(hollow, [quote("Hollow Knight", 367520, 690)]);
    assert.deepEqual(paidOf(valuation.games), {
      "Hollow Knight": 345,
      "Hollow Knight: Silksong": 900,
    });
  });

  const brotato = [buy([["Brotato", 279], ["Brotato - Abyssal Terrors", 160]])];

  it("folds DLC into the base when the Steam DLC map says so", () => {
    const { valuation } = value(
      brotato,
      [quote("Brotato", 1942280, 399), quote("Brotato - Abyssal Terrors", 2868390, 200)],
      { dlcParents: new Map([[2868390, 1942280]]) },
    );
    assert.deepEqual(paidOf(valuation.games), { Brotato: 439 });
    assert.equal(valuation.games[0].current, 599);
  });

  it("leaves a priced add-on alone when the DLC map does not list it", () => {
    const { valuation } = value(brotato, [
      quote("Brotato", 1942280, 399),
      quote("Brotato - Abyssal Terrors", 2868390, 200),
    ]);
    assert.deepEqual(paidOf(valuation.games), {
      Brotato: 279,
      "Brotato - Abyssal Terrors": 160,
    });
  });

  it("folds an unpriced 'Base - Add-on' row into the base by title", () => {
    const { valuation } = value(brotato, [quote("Brotato", 1942280, 399)]);
    assert.deepEqual(paidOf(valuation.games), { Brotato: 439 });
  });

  it("keeps the DLC's cost when its quote resolved to the base app", () => {
    const { valuation } = value(brotato, [
      quote("Brotato", 1942280, 399),
      quote("Brotato - Abyssal Terrors", 1942280, 399),
    ]);
    assert.equal(valuation.games.length, 1);
    assert.equal(valuation.games[0].paid, 439);
    assert.equal(valuation.games[0].current, 399);
  });
});

describe("buildLibraryValuation — partial refunds", () => {
  it("the kept item carries its own price; the refunded one carries nothing", () => {
    const cart = buy(
      [
        ["Lumen Drift", 600],
        ["Ashfall Protocol", 400],
      ],
      { partiallyRefunded: true, refundedItems: ["Ashfall Protocol"] },
    );
    const { valuation, spending } = value([cart], [quote("Lumen Drift", 20, 900)]);
    assert.equal(spending.netSpent, 600);
    assert.deepEqual(paidOf(valuation.games), { "Lumen Drift": 600 });
    assert.equal(valuation.librarySpent, 600);
  });

  it("a refunded item that is still licensed is not paid for", () => {
    const cart = buy(
      [
        ["Lumen Drift", 600],
        ["Ashfall Protocol", 400],
      ],
      { partiallyRefunded: true, refundedItems: ["Ashfall Protocol"] },
    );
    const { valuation } = value([cart], [], {
      ownedTitles: ["Lumen Drift", "Ashfall Protocol"],
    });
    const paid = paidOf(valuation.games);
    assert.equal(paid["Lumen Drift"], 600);
    assert.notEqual(paid["Ashfall Protocol"], 400);
    assert.equal(sumPaid(valuation.games), 600);
  });
});

describe("buildLibraryValuation — gifts sent", () => {
  it("lists a gift whose row has no transaction detail (lineItems: [])", () => {
    const gift = buy([["Hades", 1100]], {
      isGift: true,
      type: "Gift Purchase",
      giftRecipient: "friend-one",
      lineItems: [],
    });
    const { valuation, spending } = value([gift], [quote("Hades", 1145360, 1100)]);
    assert.equal(spending.giftSpend, 1100);
    assert.deepEqual(paidOf(valuation.giftsSentGames), { Hades: 1100 });
    assert.equal(valuation.giftsSentGames[0].giftedTo, "friend-one");
    assert.equal(valuation.giftsSent.current, 1100);
    assert.deepEqual(valuation.games, []);
  });
});

describe("buildLibraryValuation — dates on rows", () => {
  const giftLicence = {
    dateText: "5 Mar, 2024",
    item: "Marrow Deep",
    acquisitionMethod: "Gift/Guest Pass",
    packageId: null,
    removableComplimentary: false,
  };

  it("a Steam-listed gift carries the licence date as receivedAt", () => {
    const spending = buildSpendingAnalytics([], [giftLicence], []);
    const valuation = buildLibraryValuation(
      [],
      [giftLicence],
      cache([quote("Marrow Deep", 42, 900, 300)]),
      spending,
      { ownedTitles: ["Marrow Deep"] },
    );
    assert.equal(valuation.giftsReceivedGames.length, 1);
    assert.equal(valuation.giftsReceivedGames[0].receivedAt, "2024-03-05");
  });

  it("an e-mail gift carries the mail's date; an undated one has none", () => {
    const spending = buildSpendingAnalytics([], [], []);
    const valuation = buildLibraryValuation(
      [],
      [],
      cache([quote("PEAK", 43, 500), quote("Hue", 44, 400)]),
      spending,
      {
        ownedTitles: ["PEAK", "Hue"],
        mailGiftTitles: ["PEAK", "Hue"],
        mailGiftReceivedAt: new Map([["peak", "2025-07-01T10:00:00.000Z"]]),
      },
    );
    const by = (t: string) => valuation.giftsReceivedGames.find((g) => g.title === t)!;
    assert.equal(by("PEAK").receivedAt, "2025-07-01T10:00:00.000Z");
    assert.equal(by("Hue").receivedAt, undefined);
  });

  it("passes through the date a store low was recorded, when the quote has one", () => {
    const purchases = [buy([["Celeste", 400]]), buy([["Hades", 500]])];
    const spending = buildSpendingAnalytics(purchases, [], []);
    const valuation = buildLibraryValuation(
      purchases,
      [],
      cache([
        { ...quote("Celeste", 1, 899, 179), lowestRecordedAt: "2025-06-26T17:00:00Z" },
        quote("Hades", 2, 1100, 275),
      ]),
      spending,
    );
    const by = (t: string) => valuation.games.find((g) => g.title === t)!;
    assert.equal(by("Celeste").lowestRecordedAt, "2025-06-26T17:00:00Z");
    assert.equal(by("Hades").lowestRecordedAt, undefined);
  });
});

describe("buildLibraryValuation — one set of shelf counts", () => {
  // Shelf rows that are summed:
  //   Celeste            priced (899)
  //   Titanfall 2        priced — the "Ultimate Edition" SKU folds into it
  //   Obsidian Tram      bought, no store quote → unpriced
  //   Deponia            free claim, no quote → counts as priced at 0
  //   BioShock x2        priced, covered by the pack
  // Not shelf titles: the pack row (redundant) and the gift sent to a friend.
  const promo = {
    dateText: "3 Mar, 2026",
    item: "Deponia Limited Free Promotional Package - Mar 2026",
    acquisitionMethod: "Complimentary",
    packageId: null,
    removableComplimentary: true,
  };
  const purchases = [
    buy([["Celeste", 400]]),
    buy([["Titanfall® 2: Ultimate Edition", 224]]),
    buy([["Obsidian Tram", 275]]),
    buy([["BioShock The Collection", 349]]),
    buy([["Unpriced Gift", 500]], { isGift: true, type: "Gift Purchase" }),
  ];
  const spending = buildSpendingAnalytics(purchases, [promo], []);
  const v = buildLibraryValuation(
    purchases,
    [promo],
    cache([
      quote("Celeste", 1, 899),
      quote("Titanfall® 2", 2, 1499),
      quote("BioShock Remastered", 3, 600),
      quote("BioShock 2 Remastered", 4, 600),
    ]),
    spending,
    {
      ownedTitles: [
        "Celeste",
        "Titanfall® 2",
        "Obsidian Tram",
        "Deponia",
        "BioShock Remastered",
        "BioShock 2 Remastered",
      ],
    },
  );

  it("counts the rows that are actually summed, without redundant packs", () => {
    assert.equal(v.shelfTitles, 6);
    assert.equal(v.shelfTitlesPriced, 5);
    assert.equal(v.shelfTitlesUnpriced, 1);
    assert.deepEqual(v.shelfUnpricedTitles, ["Obsidian Tram"]);
    assert.equal(v.shelfTitles, v.shelfTitlesPriced + v.shelfTitlesUnpriced);
  });

  it("every priced title is in the shelf total, and nothing else is", () => {
    // 899 + 1499 + 600 + 600 (+ 0 for the free claim)
    assert.equal(v.shelfFull.current, 3598);
  });

  it("the unpriced list has no folded SKU, pack or sent gift in it", () => {
    for (const title of v.shelfUnpricedTitles) {
      assert.ok(v.games.some((g) => g.title === title), title);
      assert.doesNotMatch(title, /Ultimate Edition|Collection|Unpriced Gift/);
    }
  });
});

describe("buildLibraryValuation — Valve USD figures", () => {
  const spendRows = [{ type: "TotalSpend", amount: 500, currency: "USD" }];

  it("does not convert Valve's USD totals with a regional price ratio", () => {
    const purchases = [buy([["Celeste", 400]])];
    const spending = buildSpendingAnalytics(purchases, [], spendRows);
    const valuation = buildLibraryValuation(
      purchases,
      [],
      cache([quote("Celeste", 504230, 899)]),
      spending,
    );
    assert.equal(spending.valveSpendUsd.totalSpend, 500);
    assert.equal(valuation.valveTotalSpend, null);
    assert.equal(valuation.usdToDisplayRate, null);
  });

  it("passes them through for a USD account", () => {
    const purchases = [
      buy([["Celeste", 20]], { price: money(20, "USD"), total: money(20, "USD") }),
    ];
    const spending = buildSpendingAnalytics(purchases, [], spendRows);
    const valuation = buildLibraryValuation(
      purchases,
      [],
      { ...cache([]), currency: "USD", country: "US" },
      spending,
    );
    assert.equal(valuation.valveTotalSpend, 500);
  });
});

/**
 * Invariant: every rupee of net trackable spend sits on exactly one shelf row.
 * Hand-derived: 224 + 292 + 500 + 345 + 900 + (279 + 160) + 100 + 200 + 172
 * + 400 + 224 = 3,796. The refunded rows (96, 345), the gift (1,100) and the
 * gift card (3,200) are not library spend.
 */
describe("invariant: sum of per-title paid == net trackable spend", () => {
  const purchases: PurchaseHistoryRow[] = [
    // newest first, like the Steam page
    buy([["Halo: The Master Chief Collection", 224]]),
    buy([["Digital Gift Card", 3200]], { paymentMethods: ["UPI"] }),
    buy([["Liar's Bar", 172]]),
    buy([["Liar's Bar", 345]], { type: "Refund" }),
    buy([["Liar's Bar", 345]], { refunded: true }),
    buy([["Hades", 1100]], { isGift: true, type: "Gift Purchase", giftRecipient: "friend-one" }),
    buy([["Hades", 400]]),
    buy([["Mafia: Definitive Edition", 200]]),
    buy([["Mafia", 100]]),
    buy([["Brotato", 279], ["Brotato - Abyssal Terrors", 160]]),
    buy([["Hotline Miami", 96]], { type: "Refund" }),
    buy([["Hotline Miami", 96]], { refunded: true }),
    buy([["Hollow Knight: Silksong", 900]]),
    buy([["Hollow Knight", 345]]),
    buy([["BioShock The Collection", 500]]),
    buy([["Ori and the Blind Forest: Definitive Edition", 292]]),
    buy([["Titanfall® 2: Ultimate Edition", 224]]),
  ];
  const quotes = [
    quote("Halo: The Master Chief Collection", 976730, 1099),
    quote("Liar's Bar", 3097560, 345),
    quote("Hades", 1145360, 1100),
    quote("Mafia", 40990, 500),
    quote("Mafia: Definitive Edition", 1030840, 1500),
    quote("Brotato", 1942280, 399),
    quote("Brotato - Abyssal Terrors", 2868390, 200),
    quote("Hollow Knight", 367520, 690),
    quote("Hollow Knight: Silksong", 1030300, 900),
    quote("BioShock Remastered", 409710, 600),
    quote("BioShock 2 Remastered", 409720, 600),
    quote("BioShock Infinite", 8870, 800),
    quote("Ori and the Blind Forest", 261570, 1299),
    quote("Ori and the Blind Forest: Definitive Edition", 387290, 1299),
    quote("Titanfall® 2", 1237970, 1999),
  ];
  const ownedTitles = [
    "Halo: The Master Chief Collection",
    "Liar's Bar",
    "Hades",
    "Mafia: Definitive Edition",
    "Brotato",
    "Hollow Knight",
    "Hollow Knight: Silksong",
    "BioShock Remastered",
    "BioShock 2 Remastered",
    "BioShock Infinite",
    "Ori and the Blind Forest",
    "Ori and the Blind Forest: Definitive Edition",
    "Titanfall® 2",
  ];
  const { spending, valuation } = value(purchases, quotes, {
    ownedTitles,
    dlcParents: new Map([[2868390, 1942280]]),
  });

  it("net spend is the hand-derived 3,796", () => {
    assert.equal(spending.netSpent, 3796);
    assert.equal(spending.refundedTotal, 96 + 345);
    assert.equal(spending.giftSpend, 1100 + 3200);
  });

  it("per-title paid adds up to net spend", () => {
    assert.equal(sumPaid(valuation.games), spending.netSpent);
  });

  it("each title carries what was actually paid for it", () => {
    const paid = paidOf(valuation.games);
    const find = (re: RegExp) =>
      Object.entries(paid).find(([t]) => re.test(t))?.[1];
    assert.equal(find(/^Titanfall/), 224);
    assert.equal(find(/^Ori and the Blind Forest/), 292);
    assert.equal(find(/^Mafia/), 300);
    assert.equal(find(/^Brotato$/), 439);
    assert.equal(find(/^Hollow Knight$/), 345);
    assert.equal(find(/Silksong/), 900);
    assert.equal(find(/^Liar's Bar$/), 172);
    assert.equal(find(/^Hades$/), 400);
    assert.equal(find(/^Halo/), 224);
    assert.equal(find(/^BioShock The Collection$/), 500);
    assert.equal(find(/^Hotline Miami$/), undefined);
  });

  it("gifts sent are tracked apart from the library", () => {
    assert.deepEqual(paidOf(valuation.giftsSentGames), { Hades: 1100 });
  });

  it("cost per hour accounts for the same money", () => {
    const played: PlayedGame[] = ownedTitles.map((name, i) => ({
      appId: quotes.find((q) => q.title === name)!.steamAppId!,
      name,
      hoursForever: i + 1,
      hours2Weeks: null,
      lastPlayedText: null,
      lastPlayedAt: null,
      minutesForever: (i + 1) * 60,
    }));
    const cph = buildCostPerHourAnalytics(valuation.games, played, "INR");
    assert.equal(sumPaid(cph.games), spending.netSpent);
  });
});
