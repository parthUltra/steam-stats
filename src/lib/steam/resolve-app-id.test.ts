import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSteamAppId } from "./resolve-app-id";

const src = (title: string, steamAppId: number) => ({ title, steamAppId });

describe("resolveSteamAppId", () => {
  it("does not resolve a sequel to its prequel (or the reverse)", () => {
    assert.equal(resolveSteamAppId("Portal 2", [src("Portal", 400)]), null);
    assert.equal(resolveSteamAppId("Portal", [src("Portal 2", 620)]), null);
    assert.equal(resolveSteamAppId("Hades II", [src("Hades", 1145360)]), null);
    assert.equal(resolveSteamAppId("Dishonored 2", [src("Dishonored", 205100)]), null);
    assert.equal(
      resolveSteamAppId("Slay the Spire 2", [src("Slay the Spire", 646570)]),
      null,
    );
    assert.equal(
      resolveSteamAppId("Slay the Spire", [src("Slay the Spire 2", 2868840)]),
      null,
    );
  });

  it("still matches a short name to its long / edition name", () => {
    const witcher2 = src("The Witcher 2: Assassins of Kings Enhanced Edition", 20920);
    assert.equal(resolveSteamAppId("The Witcher 2", [witcher2]), 20920);
    assert.equal(
      resolveSteamAppId("Overcooked! 2 - Gourmet Edition", [src("Overcooked! 2", 728880)]),
      728880,
    );
    assert.equal(
      resolveSteamAppId("The Witcher: Enhanced Edition (ROW)", [
        src("The Witcher: Enhanced Edition", 20900),
      ]),
      20900,
    );
  });

  it("prefers the exact title when both a game and its sequel are known", () => {
    const sources = [src("Portal", 400), src("Portal 2", 620)];
    assert.equal(resolveSteamAppId("Portal", sources), 400);
    assert.equal(resolveSteamAppId("Portal 2", sources), 620);
  });
});
