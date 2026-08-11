import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSteamGiftEmails,
  splitGiftEmailChunks,
} from "./parse-steam-gift-email";

describe("splitGiftEmailChunks", () => {
  it("prefers ---- separators over From lines inside gift notes", () => {
    const raw = [
      "Subject: You've received a gift copy of the game PEAK on Steam",
      "Your friend penguin has given you PEAK on Steam.",
      "From Abhi, Arbaaz and others",
      "----",
      "Subject: You've received a gift copy of the game Hades on Steam",
      "Your friend ded has given you Hades on Steam.",
    ].join("\n");
    const chunks = splitGiftEmailChunks(raw);
    assert.equal(chunks.length, 2);
  });
});

describe("parseSteamGiftEmails", () => {
  it("attributes each gift to its own Your friend line", () => {
    const raw = [
      "Subject: You've received a gift copy of the game PEAK on Steam",
      "",
      "Your friend penguin has given you PEAK on Steam.",
      "https://store.steampowered.com/account/ackgift/AAA",
      "",
      "----",
      "",
      "Subject: You've received a gift copy of the game Hades on Steam",
      "",
      "Your friend ded has given you Hades on Steam.",
      "https://store.steampowered.com/account/ackgift/BBB",
    ].join("\n");

    const gifts = parseSteamGiftEmails(raw);
    const peak = gifts.find((g) => /peak/i.test(g.title));
    const hades = gifts.find((g) => /hades/i.test(g.title));
    assert.ok(peak);
    assert.ok(hades);
    assert.equal(peak?.fromPersona, "penguin");
    assert.equal(hades?.fromPersona, "ded");
  });

  it("does not stamp the first sender onto a later subject-only stub", () => {
    const raw = [
      "Subject: You've received a gift copy of the game PEAK on Steam",
      "Your friend penguin has given you PEAK on Steam.",
      "",
      "----",
      "",
      "Subject: You've received a gift copy of the game Celeste on Steam",
    ].join("\n");
    const gifts = parseSteamGiftEmails(raw);
    const celeste = gifts.find((g) => /celeste/i.test(g.title));
    assert.ok(celeste);
    assert.equal(celeste?.fromPersona, undefined);
  });
});
