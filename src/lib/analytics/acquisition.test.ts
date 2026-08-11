import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LicenseRow, PurchaseHistoryRow } from "../account-data";
import {
  buildAcquisitionIndex,
  classifyAcquisition,
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
      mailGiftSenders: new Map([["peak", "penguin"]]),
    });
    assert.equal(result.kind, "gifted_to_me");
    assert.match(result.note ?? "", /penguin/);
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
});
