import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { foldEditionPacksIntoBase, stripEditionSuffix } from "./edition-packs";
import type { ValuationGame } from "./valuation";

function g(title: string, extra: Partial<ValuationGame> = {}): ValuationGame {
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

const byTitle = (games: ValuationGame[]) =>
  Object.fromEntries(games.map((x) => [x.title, x.paid]));

describe("foldEditionPacksIntoBase", () => {
  it("folds every base + edition pair, however many there are", () => {
    const games: ValuationGame[] = [];
    for (let i = 0; i < 20; i++) {
      games.push(g(`Quest Saga ${String.fromCharCode(65 + i)}lpha`, { current: 100 }));
      games.push(
        g(`Quest Saga ${String.fromCharCode(65 + i)}lpha Game of the Year Edition`, {
          current: 150,
        }),
      );
    }
    assert.equal(foldEditionPacksIntoBase(games).length, 20);
  });

  it("does not fold a different game that shares a prefix", () => {
    const doom = foldEditionPacksIntoBase([
      g("DOOM", { paid: 399 }),
      g("DOOM Eternal Standard Edition", { paid: 449 }),
    ]);
    assert.deepEqual(byTitle(doom), {
      DOOM: 399,
      "DOOM Eternal Standard Edition": 449,
    });

    const tomb = foldEditionPacksIntoBase([
      g("Tomb Raider: Anniversary", { paid: 50 }),
      g("Tomb Raider GOTY Edition", { paid: 150 }),
    ]);
    assert.deepEqual(byTitle(tomb), {
      "Tomb Raider: Anniversary": 50,
      "Tomb Raider GOTY Edition": 150,
    });
  });

  it("folds DOOM Eternal Standard Edition into DOOM Eternal, not DOOM", () => {
    const out = foldEditionPacksIntoBase([
      g("DOOM", { paid: 399, current: 1299 }),
      g("DOOM Eternal", { current: 2499 }),
      g("DOOM Eternal Standard Edition", { paid: 449 }),
    ]);
    assert.deepEqual(byTitle(out), { DOOM: 399, "DOOM Eternal": 449 });
  });

  it("adds up two editions that were bought separately, one shelf price", () => {
    // Each purchase line sits on exactly one row, so the fold sums paid
    const out = foldEditionPacksIntoBase([
      g("Mafia", { paid: 100, current: 500 }),
      g("Mafia: Definitive Edition", { paid: 200, current: 1500 }),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].paid, 300);
    assert.equal(out[0].current, 1500);
  });

  it("keeps VR releases as their own game", () => {
    assert.equal(stripEditionSuffix("SUPERHOT VR"), null);
    // …but an explicit "VR Edition" is an edition of the same game
    assert.equal(
      stripEditionSuffix("Hellblade: Senua's Sacrifice VR Edition"),
      "hellblade: senua's sacrifice",
    );
    const out = foldEditionPacksIntoBase([
      g("SUPERHOT", { paid: 300 }),
      g("SUPERHOT VR", { paid: 400 }),
    ]);
    assert.equal(out.length, 2);
  });
});
