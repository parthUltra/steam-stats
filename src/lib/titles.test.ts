import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isGiftCardName, isSequelRemainder, median, normTitle } from "./titles";

describe("titles", () => {
  it("normTitle lowercases, drops ™/® and collapses whitespace", () => {
    assert.equal(normTitle("  Titanfall®  2:\tUltimate Edition™ "), "titanfall 2: ultimate edition");
  });

  it("isGiftCardName matches Steam gift cards only", () => {
    assert.equal(isGiftCardName("Digital Gift Card"), true);
    assert.equal(isGiftCardName("Steam Gift Card"), true);
    assert.equal(isGiftCardName("Card Shark"), false);
  });

  it("median handles odd, even and empty lists", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), null);
  });

  it("isSequelRemainder spots sequel tokens, not subtitles or editions", () => {
    for (const rest of [" 2", " II", ": Episode 1", " - Part 2", " iv", " X", " XV"]) {
      assert.equal(isSequelRemainder(rest), true, rest);
    }
    for (const rest of ["", ": Assassins of Kings", " Remastered", " - Gourmet Edition", " Eternal"]) {
      assert.equal(isSequelRemainder(rest), false, rest);
    }
  });
});
