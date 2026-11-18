import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LicenseRow, PurchaseHistoryRow } from "../account-data";
import {
  applySteamInrListPrices,
  buildSpendingAnalytics,
  gameTitlesFromPurchases,
  isTemporaryLibraryLicense,
  isTrackableGamePurchase,
  libraryTitlesForValuation,
  parseSteamDate,
  titlesForPriceRefresh,
} from "./spending";

const inr = (amount: number, raw = `₹ ${amount}`) => ({
  raw,
  amount,
  currencyHint: "INR",
});

/** A purchase row: `lines` are [name, amount]; total defaults to their sum. */
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
      raw: `₹ ${amount}`,
    })),
    type: "Purchase",
    paymentMethods: ["Visa **77"],
    isGift: false,
    price: inr(total),
    originalPrice: null,
    discountedPrice: null,
    discountPct: null,
    tax: null,
    shipping: null,
    total: inr(total),
    walletChange: null,
    walletBalance: null,
    transactionId: null,
    refunded: false,
    isWalletBalanceChange: false,
    ...extra,
  };
}

const methods = (a: ReturnType<typeof buildSpendingAnalytics>) =>
  Object.fromEntries(a.paymentMethods.map((m) => [m.method, [m.spent, m.count]]));

function row(
  items: string[],
  extra?: Partial<PurchaseHistoryRow>,
): PurchaseHistoryRow {
  return {
    dateText: "1 Jan 2024",
    items,
    lineItems: items.map((name) => ({
      name,
      amount: 100,
      currencyHint: "INR",
      raw: "100",
    })),
    type: extra?.isGift ? "Gift Purchase" : "Purchase",
    paymentMethods: ["Visa"],
    isGift: false,
    price: { raw: "100", amount: 100, currencyHint: "INR" },
    originalPrice: null,
    discountedPrice: null,
    discountPct: null,
    tax: null,
    shipping: null,
    total: { raw: "100", amount: 100, currencyHint: "INR" },
    walletChange: null,
    walletBalance: null,
    transactionId: null,
    refunded: false,
    isWalletBalanceChange: false,
    ...extra,
  };
}

describe("titlesForPriceRefresh", () => {
  it("includes games gifted to others that library valuation skips", () => {
    const purchases = [
      row(["Hades"]),
      row(["Overcooked! 2"], { isGift: true, giftRecipient: "friend-one" }),
    ];
    const licenses: LicenseRow[] = [
      {
        dateText: "1 Jan 2024",
        item: "Hades",
        acquisitionMethod: "Steam Store",
        packageId: null,
        removableComplimentary: false,
      },
    ];
    const library = libraryTitlesForValuation(purchases, licenses);
    assert.ok(library.includes("Hades"));
    assert.ok(!library.includes("Overcooked! 2"));

    const priced = titlesForPriceRefresh({
      purchases,
      licenses,
      mailGiftTitles: ["PEAK"],
    });
    assert.ok(priced.includes("Hades"));
    assert.ok(priced.includes("Overcooked! 2"));
    assert.ok(priced.includes("PEAK"));
  });
});

describe("temporary library licenses", () => {
  it("treats free pass / trial licenses as not owned", () => {
    const trial: LicenseRow = {
      dateText: "1 Jan 2024",
      item: "Battlefield 2042 Free Trial",
      acquisitionMethod: "Complimentary",
      packageId: null,
      removableComplimentary: true,
    };
    assert.equal(isTemporaryLibraryLicense(trial), true);

    const pass: LicenseRow = {
      dateText: "1 Jan 2024",
      item: "Battlefield V Free Pass",
      acquisitionMethod: "Complimentary",
      packageId: null,
      removableComplimentary: true,
    };
    assert.equal(isTemporaryLibraryLicense(pass), true);
  });
});

describe("buildSpendingAnalytics — categories", () => {
  it("books a split payment to each method, not all to the first", () => {
    const a = buildSpendingAnalytics(
      [
        buy([["Cyberpunk 2077", 2181]], {
          paymentMethods: ["₹ 5 Wallet", "₹ 2,176 Visa"],
        }),
        buy([["Celeste", 100]]),
      ],
      [],
      [],
    );
    assert.equal(a.netSpent, 2281);
    // Wallet 5; Visa 2176 + 100
    assert.deepEqual(methods(a), { Visa: [2276, 2], "Steam Wallet": [5, 1] });
  });

  it("splits proportionally when the parts do not add up to the total", () => {
    // parts 100 + 300 = 400 but the row total is 200 → 50 / 150
    const a = buildSpendingAnalytics(
      [buy([["Game", 200]], { paymentMethods: ["₹ 100 Wallet", "₹ 300 UPI"] })],
      [],
      [],
    );
    assert.deepEqual(methods(a), { UPI: [150, 1], "Steam Wallet": [50, 1] });
  });

  it("reads decimal parts of a split payment", () => {
    // 2.50 + 7.50 of a ₹10 purchase
    const a = buildSpendingAnalytics(
      [buy([["Game", 10]], { paymentMethods: ["₹ 2.50 Wallet", "₹ 7.50 Visa"] })],
      [],
      [],
    );
    assert.deepEqual(methods(a), { Visa: [7.5, 1], "Steam Wallet": [2.5, 1] });
  });

  it("does not read the card digits of a single method as an amount", () => {
    const a = buildSpendingAnalytics([buy([["Game", 500]])], [], []);
    assert.deepEqual(methods(a), { Visa: [500, 1] });
  });

  it("counts a digital gift card as a gift, not a wallet top-up or library spend", () => {
    const a = buildSpendingAnalytics(
      [
        buy([["Digital Gift Card", 3200]], { paymentMethods: ["UPI"] }),
        buy([["Hades", 1100]], { isGift: true, type: "Gift Purchase" }),
      ],
      [],
      [],
    );
    assert.equal(a.giftSpend, 4300);
    assert.equal(a.giftCardSpend, 3200);
    assert.equal(a.walletTopUps, 0);
    assert.equal(a.netSpent, 0);
    assert.equal(a.purchaseCount, 0);
  });

  it("counts wallet credit as a top-up", () => {
    const a = buildSpendingAnalytics(
      [buy([["Wallet Credit", 500]])],
      [],
      [],
    );
    assert.equal(a.walletTopUps, 500);
    assert.equal(a.netSpent, 0);
    assert.equal(a.giftSpend, 0);
  });

  it("keeps market credits out of market spend", () => {
    const market = (amount: number, credit: boolean) =>
      buy([], {
        items: ["Steam Community Market"],
        lineItems: [],
        type: "Market Transaction",
        paymentMethods: ["Wallet"],
        price: inr(amount, `₹ ${amount}${credit ? " Credit" : ""}`),
        total: inr(amount, `₹ ${amount}${credit ? " Credit" : ""}`),
      });
    const a = buildSpendingAnalytics(
      [market(5, true), market(2.5, true), market(4, false)],
      [],
      [],
    );
    assert.equal(a.marketSpend, 4);
    assert.equal(a.marketCredits, 7.5);
    assert.equal(a.netSpent, 0);
  });

  it("keeps the game from a mixed game + gift card checkout", () => {
    const mixed = buy([
      ["Celeste", 400],
      ["Steam Gift Card", 1000],
    ]);
    assert.equal(isTrackableGamePurchase(mixed), true);
    assert.deepEqual(gameTitlesFromPurchases([mixed]), ["Celeste"]);
    const a = buildSpendingAnalytics([mixed], [], []);
    assert.equal(a.netSpent, 400);
    assert.equal(a.purchaseCount, 1);
    assert.equal(a.giftSpend, 1000);
    assert.equal(a.giftCardSpend, 1000);
    assert.equal(a.walletTopUps, 0);
    assert.deepEqual(methods(a), { Visa: [400, 1] });
    assert.deepEqual(
      a.monthly[0].lines.map((l) => [l.title, l.amount]),
      [["Celeste", 400]],
    );
    assert.equal(a.monthly[0].spent, 400);
  });

  it("splits a mixed checkout evenly per item when there are no line amounts", () => {
    // 3 items, ₹900, one is a card → 600 games, 300 card
    const mixed = buy(
      [
        ["A", 0],
        ["B", 0],
        ["Steam Gift Card", 0],
      ],
      { lineItems: [], price: inr(900), total: inr(900) },
    );
    const a = buildSpendingAnalytics([mixed], [], []);
    assert.equal(a.netSpent, 600);
    assert.equal(a.giftCardSpend, 300);
    assert.deepEqual(
      a.monthly[0].lines.map((l) => [l.title, l.amount]).sort(),
      [
        ["A", 300],
        ["B", 300],
      ],
    );
  });

  it("a gift-card-only row is not a trackable game purchase", () => {
    assert.equal(isTrackableGamePurchase(buy([["Digital Gift Card", 3200]])), false);
  });
});

describe("parseSteamDate", () => {
  const ymd = (d: Date | null) =>
    d ? [d.getFullYear(), d.getMonth() + 1, d.getDate()] : null;

  it("parses the formats Steam uses across locales", () => {
    assert.deepEqual(ymd(parseSteamDate("11 Aug, 2026")), [2026, 8, 11]);
    assert.deepEqual(ymd(parseSteamDate("Aug 11, 2026")), [2026, 8, 11]);
    assert.deepEqual(ymd(parseSteamDate("11 August, 2026")), [2026, 8, 11]);
    assert.deepEqual(ymd(parseSteamDate("1 Jan 2024")), [2024, 1, 1]);
    assert.deepEqual(ymd(parseSteamDate("11. Aug. 2026")), [2026, 8, 11]);
  });

  it("returns null for text that is not a date", () => {
    assert.equal(parseSteamDate(""), null);
    assert.equal(parseSteamDate("yesterday-ish"), null);
  });
});

describe("applySteamInrListPrices", () => {
  const month = (title: string, amount: number) => [
    {
      month: "2024-01",
      spent: amount,
      count: 1,
      lines: [
        {
          title,
          amount,
          date: "1 Jan, 2024",
          purchasedAt: null,
          discountPct: null,
          listAmount: null,
        },
      ],
    },
  ];

  it("picks the closest title, not the first prefix in cache order", () => {
    const monthly = month("DOOM Eternal Standard Edition", 449);
    applySteamInrListPrices(monthly, {
      doom: { title: "DOOM", retailInr: 1299 },
      "doom eternal": { title: "DOOM Eternal", retailInr: 2499 },
    });
    assert.equal(monthly[0].lines[0].listAmount, 2499);
  });

  it("never borrows a sequel's list price", () => {
    const monthly = month("Hades", 400);
    applySteamInrListPrices(monthly, {
      "hades ii": { title: "Hades II", retailInr: 1300 },
    });
    assert.equal(monthly[0].lines[0].listAmount, null);
  });
});

describe("buildSpendingAnalytics — partial refunds", () => {
  // Cart of two: Lumen Drift 600 kept, Ashfall Protocol 400 refunded
  const cart = buy(
    [
      ["Lumen Drift", 600],
      ["Ashfall Protocol", 400],
    ],
    {
      dateText: "12 Dec, 2023",
      paymentMethods: ["UPI"],
      partiallyRefunded: true,
      refundedItems: ["Ashfall Protocol"],
    },
  );

  it("keeps the kept item's amount and refunds only the refunded one", () => {
    const a = buildSpendingAnalytics([cart, buy([["Celeste", 100]])], [], []);
    assert.equal(a.netSpent, 700);
    assert.equal(a.grossSpent, 700);
    assert.equal(a.purchaseCount, 2);
    assert.equal(a.refundedTotal, 400);
    assert.equal(a.refundCount, 1);
    assert.deepEqual(methods(a), { UPI: [600, 1], Visa: [100, 1] });
    assert.deepEqual(
      a.monthly.map((m) => [m.month, m.spent, m.lines.map((l) => [l.title, l.amount])]),
      [
        ["2023-12", 600, [["Lumen Drift", 600]]],
        ["2024-01", 100, [["Celeste", 100]]],
      ],
    );
    assert.deepEqual(a.yearly, [
      { year: "2023", spent: 600, count: 1 },
      { year: "2024", spent: 100, count: 1 },
    ]);
  });

  it("splits evenly by item when the cart has no line amounts", () => {
    const noLines = { ...cart, lineItems: [] };
    const a = buildSpendingAnalytics([noLines], [], []);
    assert.equal(a.netSpent, 500);
    assert.equal(a.refundedTotal, 500);
  });

  it("does not list the refunded item as a library title", () => {
    assert.deepEqual(gameTitlesFromPurchases([cart]), ["Lumen Drift"]);
  });
});

describe("monthly purchase lines carry a timestamp", () => {
  it("purchasedAt is the purchase date at local midnight (epoch ms)", () => {
    const a = buildSpendingAnalytics(
      [
        buy([["Celeste", 100]], { dateText: "12 Dec, 2023" }),
        buy([["A", 0], ["B", 0]], {
          dateText: "3 Jan, 2024",
          lineItems: [],
          price: inr(200),
          total: inr(200),
        }),
      ],
      [],
      [],
    );
    const lines = a.monthly.flatMap((m) => m.lines);
    assert.deepEqual(
      lines.map((l) => [l.title, l.purchasedAt]).sort(),
      [
        ["A", new Date(2024, 0, 3).getTime()],
        ["B", new Date(2024, 0, 3).getTime()],
        ["Celeste", new Date(2023, 11, 12).getTime()],
      ],
    );
  });
});
