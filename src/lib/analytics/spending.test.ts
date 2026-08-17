import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LicenseRow, PurchaseHistoryRow } from "../account-data";
import {
  libraryTitlesForValuation,
  titlesForPriceRefresh,
} from "./spending";

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
      row(["Overcooked! 2"], { isGift: true, giftRecipient: "penguin" }),
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
