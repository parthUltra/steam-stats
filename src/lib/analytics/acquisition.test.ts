import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LicenseRow, PurchaseHistoryRow } from "../account-data";
import {
  buildAcquisitionIndex,
  classifyAcquisition,
  hasOwnershipRecord,
  isLikelyFreeToPlay,
  playtimeTitlesForValuation,
  titlesSoftMatch,
} from "./acquisition";

function purchase(
  items: string[],
  amount: number,
  extra?: Partial<PurchaseHistoryRow>,
): PurchaseHistoryRow {
  return {
    dateText: "1 Jan 2024",
    items,
    lineItems: items.map((name) => ({
      name,
      amount,
      currencyHint: "INR",
      raw: String(amount),
    })),
    type: "Purchase",
    paymentMethods: ["Visa"],
    isGift: false,
    price: { raw: String(amount), amount, currencyHint: "INR" },
    originalPrice: null,
    discountedPrice: null,
    discountPct: null,
    tax: null,
    shipping: null,
    total: { raw: String(amount), amount, currencyHint: "INR" },
    walletChange: null,
    walletBalance: null,
    transactionId: "t1",
    refunded: false,
    isWalletBalanceChange: false,
    ...extra,
  };
}

function license(
  item: string,
  acquisitionMethod: string,
  extra?: Partial<LicenseRow>,
): LicenseRow {
  return {
    dateText: "1 Jan 2024",
    item,
    acquisitionMethod,
    packageId: null,
    removableComplimentary: false,
    ...extra,
  };
}

describe("classifyAcquisition", () => {
  it("marks Steam Gift licenses as gifted_to_me", () => {
    const licenses = [license("Hades", "Steam Gift")];
    const purchases: PurchaseHistoryRow[] = [];
    const index = buildAcquisitionIndex(licenses, purchases);
    const result = classifyAcquisition({
      title: "Hades",
      licenses,
      purchases,
      paidByExact: new Map(),
      ownedKeys: new Set(["hades"]),
      libraryTitleKeys: ["hades"],
      index,
    });
    assert.equal(result.kind, "gifted_to_me");
    assert.equal(result.paid, 0);
  });

  it("uses Gmail titles when no gift license remains", () => {
    const licenses: LicenseRow[] = [];
    const purchases: PurchaseHistoryRow[] = [];
    const result = classifyAcquisition({
      title: "PEAK",
      licenses,
      purchases,
      paidByExact: new Map(),
      ownedKeys: new Set(["peak"]),
      libraryTitleKeys: ["peak"],
      mailGiftTitles: ["PEAK"],
      mailGiftSenders: new Map([["peak", "friend-one"]]),
    });
    assert.equal(result.kind, "gifted_to_me");
    assert.match(result.note ?? "", /friend-one/);
  });

  it("classifies a wallet match as purchased", () => {
    const row = purchase(["Celeste"], 400);
    const licenses = [license("Celeste", "Steam Store")];
    const paid = new Map([["celeste", 400]]);
    const index = buildAcquisitionIndex(licenses, [row]);
    const result = classifyAcquisition({
      title: "Celeste",
      licenses,
      purchases: [row],
      paidByExact: paid,
      ownedKeys: new Set(["celeste"]),
      libraryTitleKeys: ["celeste"],
      index,
    });
    assert.equal(result.kind, "purchased");
    assert.equal(result.paid, 400);
  });

  it("does not treat complimentary licenses as gifts", () => {
    const licenses = [license("Team Fortress 2", "Complimentary")];
    const result = classifyAcquisition({
      title: "Team Fortress 2",
      licenses,
      purchases: [],
      paidByExact: new Map(),
      ownedKeys: new Set(["team fortress 2"]),
      libraryTitleKeys: ["team fortress 2"],
    });
    assert.equal(result.kind, "free");
  });

  it("keeps a real purchase paid when the store shows a 100%-off promo", () => {
    const row = purchase(["Celeste"], 400);
    const base = {
      title: "Celeste",
      licenses: [],
      purchases: [row],
      paidByExact: new Map([["celeste", 400]]),
      ownedKeys: new Set(["celeste"]),
      libraryTitleKeys: ["celeste"],
    };
    const promo = classifyAcquisition({
      ...base,
      priceHint: { current: 0, retail: 899 },
    });
    assert.deepEqual([promo.kind, promo.paid], ["purchased", 400]);
    // Went free-to-play later: what you paid then is still what you paid
    const wentFree = classifyAcquisition({
      ...base,
      priceHint: { current: 0, retail: 0 },
    });
    assert.deepEqual([wentFree.kind, wentFree.paid], ["purchased", 400]);
  });

  it("keeps a paid pack for a free-to-play game paid", () => {
    const title = "Overwatch® 2 - Watchpoint Pack";
    const result = classifyAcquisition({
      title,
      licenses: [license("Overwatch® 2", "Complimentary")],
      purchases: [purchase([title], 1499)],
      paidByExact: new Map([["overwatch 2 - watchpoint pack", 1499]]),
      ownedKeys: new Set(),
      libraryTitleKeys: ["overwatch 2", "overwatch 2 - watchpoint pack"],
      priceHint: { current: 0, retail: 0 },
    });
    assert.deepEqual([result.kind, result.paid], ["purchased", 1499]);
  });

  it("calls a title free when the store lists it free and nothing was paid", () => {
    const result = classifyAcquisition({
      title: "Deadlock",
      licenses: [],
      purchases: [],
      paidByExact: new Map(),
      ownedKeys: new Set(["deadlock"]),
      libraryTitleKeys: ["deadlock"],
      priceHint: { current: null, retail: 0 },
    });
    assert.deepEqual([result.kind, result.paid], ["free", 0]);
  });

  it("does not guess free-to-play from the name", () => {
    const result = classifyAcquisition({
      title: "Tactical Overwatch",
      licenses: [],
      purchases: [],
      paidByExact: new Map(),
      ownedKeys: new Set(["tactical overwatch"]),
      libraryTitleKeys: ["tactical overwatch"],
    });
    assert.equal(result.kind, "unknown_unpaid");
  });

  it("a complimentary licence beats a soft match on another SKU's purchase", () => {
    const result = classifyAcquisition({
      title: "Brawlhalla",
      licenses: [license("Brawlhalla", "Complimentary")],
      purchases: [purchase(["Brawlhalla - Deluxe Edition"], 500)],
      paidByExact: new Map([["brawlhalla - deluxe edition", 500]]),
      ownedKeys: new Set(["brawlhalla"]),
      libraryTitleKeys: ["brawlhalla", "brawlhalla - deluxe edition"],
    });
    assert.deepEqual([result.kind, result.paid], ["free", 0]);
  });

  it("reports how the wallet row was matched", () => {
    const paidByExact = new Map([["titanfall 2: ultimate edition", 224]]);
    const purchases = [purchase(["Titanfall® 2: Ultimate Edition"], 224)];
    const soft = classifyAcquisition({
      title: "Titanfall® 2",
      licenses: [],
      purchases,
      paidByExact,
      ownedKeys: new Set(["titanfall 2"]),
      libraryTitleKeys: ["titanfall 2", "titanfall 2: ultimate edition"],
    });
    assert.equal(soft.kind, "purchased");
    assert.equal(soft.paidVia, "soft");
    assert.equal(soft.coveredBy, "titanfall 2: ultimate edition");
    const exact = classifyAcquisition({
      title: "Titanfall® 2: Ultimate Edition",
      licenses: [],
      purchases,
      paidByExact,
      ownedKeys: new Set(),
      libraryTitleKeys: ["titanfall 2", "titanfall 2: ultimate edition"],
    });
    assert.equal(exact.paidVia, "exact");
    assert.equal(exact.paid, 224);
  });

  it("classifies a free-to-keep promo claim as free", () => {
    const licenses = [
      license("Deponia Limited Free Promotional Package - Mar 2026", "Complimentary"),
    ];
    const result = classifyAcquisition({
      title: "Deponia",
      licenses,
      purchases: [],
      paidByExact: new Map(),
      ownedKeys: new Set(["deponia"]),
      libraryTitleKeys: ["deponia"],
    });
    assert.deepEqual([result.kind, result.paid], ["free", 0]);
  });

  it("treats Overwatch 2 as free even with a leftover paid wallet match", () => {
    const row = purchase(["Overwatch"], 1499);
    const licenses = [license("Overwatch® 2", "Complimentary")];
    const result = classifyAcquisition({
      title: "Overwatch® 2",
      licenses,
      purchases: [row],
      paidByExact: new Map([["overwatch", 1499]]),
      ownedKeys: new Set(["overwatch 2"]),
      libraryTitleKeys: ["overwatch 2"],
      priceHint: { current: 0, retail: 0 },
    });
    assert.equal(result.kind, "free");
    assert.equal(result.paid, 0);
  });
});

describe("isLikelyFreeToPlay", () => {
  it("needs store evidence, not a name or a sale price of zero", () => {
    assert.equal(isLikelyFreeToPlay("Overwatch® 2"), false);
    assert.equal(isLikelyFreeToPlay("Overwatch® 2 - Watchpoint Pack"), false);
    assert.equal(
      isLikelyFreeToPlay("Celeste", { currentPrice: 0, retailPrice: 899 }),
      false,
    );
    assert.equal(
      isLikelyFreeToPlay("Celeste", { currentPrice: 0, retailPrice: null }),
      false,
    );
    assert.equal(
      isLikelyFreeToPlay("Team Fortress 2", { currentPrice: 0, retailPrice: 0 }),
      true,
    );
    assert.equal(
      isLikelyFreeToPlay("Deadlock", { currentPrice: null, retailPrice: 0 }),
      true,
    );
    assert.equal(isLikelyFreeToPlay("Some Game (Free to Play)"), true);
  });
});

describe("titlesSoftMatch", () => {
  const same: [string, string][] = [
    ["Titanfall® 2", "Titanfall® 2: Ultimate Edition"],
    ["BioShock", "BioShock Remastered"],
    ["The Witcher 3: Wild Hunt", "The Witcher 3: Wild Hunt - Game of the Year Edition"],
    ["Devil May Cry 5", "Devil May Cry 5 + Vergil"],
    ["Ori and the Blind Forest", "Ori and the Blind Forest: Definitive Edition"],
    ["DOOM Eternal", "DOOM Eternal Standard Edition"],
    ["Hades", "HADES™"],
    // a "VR Edition" is an edition of the same game; a bare "VR" title is not
    ["Hellblade: Senua's Sacrifice", "Hellblade: Senua's Sacrifice VR Edition"],
  ];
  const different: [string, string][] = [
    // separate VR products
    ["Fallout 4", "Fallout 4 VR"],
    ["SUPERHOT", "SUPERHOT VR"],
    ["Borderlands 2", "Borderlands 2 VR"],
    // DLC / upgrades / soundtracks that start with an edition word
    ["ELDEN RING", "ELDEN RING Deluxe Edition Upgrade"],
    ["Monster Hunter: World", "Monster Hunter: World - Deluxe Kit"],
    ["Rocket League", "Rocket League - HD Texture Pack"],
    ["Stellaris", "Stellaris: Complete Soundtrack"],
    ["Warframe", "Warframe: Premium Starter"],
    // sequels and siblings
    ["Portal", "Portal 2"],
    ["Hades", "Hades II"],
    ["Sid Meier's Civilization V", "Sid Meier's Civilization VI"],
    ["FINAL FANTASY X", "FINAL FANTASY XV"],
    ["DOOM", "DOOM Eternal"],
    ["Persona 5", "Persona 5 Royal"],
    ["Hollow Knight", "Hollow Knight: Silksong"],
  ];
  for (const [a, b] of same) {
    it(`same game: ${a} ↔ ${b}`, () => {
      assert.equal(titlesSoftMatch(a, b), true);
      assert.equal(titlesSoftMatch(b, a), true);
    });
  }
  for (const [a, b] of different) {
    it(`different product: ${a} ↔ ${b}`, () => {
      assert.equal(titlesSoftMatch(a, b), false);
      assert.equal(titlesSoftMatch(b, a), false);
    });
  }
});

/**
 * Ownership rule: a playtime title is left out of Value only on positive
 * evidence — it is family-shared, or every licence that covers it is a
 * trial / free pass / free weekend / demo and nothing shows it was bought or
 * gifted. A missing licence row is not evidence (the licence scrape is
 * truncated).
 */
describe("playtimeTitlesForValuation", () => {
  it("drops family-only playtime with no license or purchase", () => {
    const titles = playtimeTitlesForValuation(
      [{ name: "007 First Light", fromFamily: true }],
      [],
      [],
    );
    assert.deepEqual(titles, []);
  });

  it("keeps an owned title that has no licence row and no purchase row", () => {
    // e.g. an old giveaway: the licence scrape only reaches back a few months
    const titles = playtimeTitlesForValuation(
      [{ name: "Half-Life 2", fromFamily: false }, { name: "Balatro" }],
      [license("CloverPit", "Steam Store")],
      [],
    );
    assert.deepEqual(titles, ["Half-Life 2", "Balatro"]);
  });

  it("drops Battlefield when the only license is a free pass / trial", () => {
    const titles = playtimeTitlesForValuation(
      [{ name: "Battlefield 2042" }],
      [license("Battlefield 2042 Free Trial", "Complimentary")],
      [],
    );
    assert.deepEqual(titles, []);

    const pass = playtimeTitlesForValuation(
      [{ name: "Battlefield V" }],
      [license("Battlefield V Free Pass", "Complimentary")],
      [],
    );
    assert.deepEqual(pass, []);
  });

  it("drops a title whose only licence is a free weekend, demo or playtest", () => {
    const titles = playtimeTitlesForValuation(
      [
        { name: "Super Battle Golf" },
        { name: "Lost in Anomaly Demo" },
        { name: "Hamsteria Playtest" },
      ],
      [
        license("Super Battle Golf Free Weekend - Jul 2026", "Complimentary"),
        license("Lost in Anomaly Demo", "Complimentary"),
        license("Hamsteria Playtest for store signup", "Complimentary"),
      ],
      [],
    );
    assert.deepEqual(titles, []);
  });

  it("keeps a free-weekend title that was also bought or has a store licence", () => {
    const weekend = license("Super Battle Golf Free Weekend - Jul 2026", "Complimentary");
    assert.deepEqual(
      playtimeTitlesForValuation(
        [{ name: "Super Battle Golf" }],
        [weekend],
        [purchase(["Super Battle Golf"], 500)],
      ),
      ["Super Battle Golf"],
    );
    assert.deepEqual(
      playtimeTitlesForValuation(
        [{ name: "Super Battle Golf" }],
        [weekend, license("Super Battle Golf", "Steam Store")],
        [],
      ),
      ["Super Battle Golf"],
    );
    assert.deepEqual(
      playtimeTitlesForValuation(
        [{ name: "Super Battle Golf" }],
        [weekend],
        [],
        ["Super Battle Golf"],
      ),
      ["Super Battle Golf"],
    );
  });

  it("keeps free-to-keep promo claims and free-on-demand games", () => {
    const titles = playtimeTitlesForValuation(
      [{ name: "Deponia" }, { name: "Brawlhalla" }],
      [
        license("Deponia Limited Free Promotional Package - Mar 2026", "Complimentary"),
        license("Brawlhalla Free On Demand", "Complimentary"),
      ],
      [],
    );
    assert.deepEqual(titles, ["Deponia", "Brawlhalla"]);
  });

  it("keeps a purchased title that is missing from the license scrape", () => {
    const titles = playtimeTitlesForValuation(
      [{ name: "Celeste" }],
      [],
      [purchase(["Celeste"], 400)],
    );
    assert.deepEqual(titles, ["Celeste"]);
  });

  it("keeps titles bought under a store SKU name (audit A3 repro)", () => {
    const titles = playtimeTitlesForValuation(
      [
        { name: "The Witcher: Enhanced Edition" },
        { name: "Overcooked! 2" },
        { name: "Deponia" },
        { name: "Half-Life 2" },
      ],
      [license("Deponia Limited Free Promotional Package - Mar 2026", "Complimentary")],
      [
        purchase(["The Witcher: Enhanced Edition (ROW)"], 49),
        purchase(["Overcooked! 2 - Gourmet Edition"], 324),
      ],
    );
    assert.deepEqual(titles, [
      "The Witcher: Enhanced Edition",
      "Overcooked! 2",
      "Deponia",
      "Half-Life 2",
    ]);
  });
});

describe("hasOwnershipRecord", () => {
  const licenses = [
    license("CloverPit", "Steam Store"),
    license("Deponia Limited Free Promotional Package - Mar 2026", "Complimentary"),
    license("Cobalt Siege Free Weekend - Mar 2025", "Complimentary"),
  ];
  const purchases = [purchase(["Titanfall® 2: Ultimate Edition"], 224)];

  it("is true for a licence, a free-to-keep claim, a purchase or a mail gift", () => {
    assert.equal(hasOwnershipRecord("CloverPit", licenses, purchases), true);
    assert.equal(hasOwnershipRecord("Deponia", licenses, purchases), true);
    assert.equal(hasOwnershipRecord("Titanfall® 2", licenses, purchases), true);
    assert.equal(hasOwnershipRecord("PEAK", licenses, purchases, ["PEAK"]), true);
  });

  it("is false when nothing records how the title was acquired", () => {
    assert.equal(hasOwnershipRecord("Half-Life 2", licenses, purchases), false);
    // a free-weekend licence is not a record of ownership
    assert.equal(hasOwnershipRecord("Cobalt Siege", licenses, purchases), false);
  });
});
