import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseSteamGiftEmails,
  splitGiftEmailChunks,
} from "./parse-steam-gift-email";

describe("splitGiftEmailChunks", () => {
  it("prefers ---- separators over From lines inside gift notes", () => {
    const raw = [
      "Subject: You've received a gift copy of the game SKYLINE on Steam",
      "Your friend friend-one has given you SKYLINE on Steam.",
      "From Abhi, Arbaaz and others",
      "----",
      "Subject: You've received a gift copy of the game Hades on Steam",
      "Your friend friend-two has given you Hades on Steam.",
    ].join("\n");
    const chunks = splitGiftEmailChunks(raw);
    assert.equal(chunks.length, 2);
  });
});

describe("parseSteamGiftEmails", () => {
  it("attributes each gift to its own Your friend line", () => {
    const raw = [
      "Subject: You've received a gift copy of the game SKYLINE on Steam",
      "",
      "Your friend friend-one has given you SKYLINE on Steam.",
      "https://store.steampowered.com/account/ackgift/AAA",
      "",
      "----",
      "",
      "Subject: You've received a gift copy of the game Hades on Steam",
      "",
      "Your friend friend-two has given you Hades on Steam.",
      "https://store.steampowered.com/account/ackgift/BBB",
    ].join("\n");

    const gifts = parseSteamGiftEmails(raw);
    const skyline = gifts.find((g) => /skyline/i.test(g.title));
    const hades = gifts.find((g) => /hades/i.test(g.title));
    assert.ok(skyline);
    assert.ok(hades);
    assert.equal(skyline?.fromPersona, "friend-one");
    assert.equal(hades?.fromPersona, "friend-two");
  });

  it("does not stamp the first sender onto a later subject-only stub", () => {
    const raw = [
      "Subject: You've received a gift copy of the game SKYLINE on Steam",
      "Your friend friend-one has given you SKYLINE on Steam.",
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

describe("gift titles", () => {
  const titles = (raw: string) => parseSteamGiftEmails(raw).map((g) => g.title);

  it('keeps a title that itself starts with "Game"', () => {
    assert.deepEqual(
      titles(
        [
          "Subject: You've received a gift copy of the game Game Dev Tycoon on Steam",
          "",
          "Your friend friend-one has given you Game Dev Tycoon on Steam.",
        ].join("\n"),
      ),
      ["Game Dev Tycoon"],
    );
    // body only, and subject only
    assert.deepEqual(
      titles("Your friend friend-one has given you Game Dev Tycoon on Steam."),
      ["Game Dev Tycoon"],
    );
    assert.deepEqual(
      titles("Subject: You've received a gift copy of the game Game of Thrones on Steam"),
      ["Game of Thrones"],
    );
    assert.deepEqual(
      titles("Subject: You've received a gift copy of The Game of Life 2 on Steam"),
      ["The Game of Life 2"],
    );
  });

  it('still drops the "the game" Steam inserts before a title', () => {
    assert.deepEqual(
      titles(
        [
          "Your friend friend-one has given you a gift subscription to the game",
          "Example Quest on Steam.",
        ].join("\n"),
      ),
      ["Example Quest"],
    );
    assert.deepEqual(
      titles("Subject: You've received a gift copy of the game SKYLINE on Steam"),
      ["SKYLINE"],
    );
  });

  it("decodes quoted-printable UTF-8 without mangling ™ ® © or accents", () => {
    const raw = [
      "Subject: You've received a gift copy of the game Example=E2=84=A2 Racer on Steam",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      "Your friend caf=C3=A9 has given you Example=E2=84=A2 Racer on Steam.",
      "----",
      "Your friend friend-one has given you Sid Example=E2=80=99s Empire=C2=AE VI on Ste=",
      "am.",
      "----",
      "Your friend friend-one has given you Pok=C3=A9 Example =C2=A9 2026 on Steam.",
    ].join("\n");
    const gifts = parseSteamGiftEmails(raw);
    assert.deepEqual(
      gifts.map((g) => g.title),
      ["Example™ Racer", "Sid Example’s Empire® VI", "Poké Example © 2026"],
    );
    assert.equal(gifts[0].fromPersona, "café");
  });

  it("leaves text that is already UTF-8, and stray = signs, alone", () => {
    assert.deepEqual(
      titles("Your friend friend-one has given you Example™ Racer® on Steam."),
      ["Example™ Racer®"],
    );
    assert.deepEqual(
      titles("Your friend a=b has given you 2+2=5 Simulator on Steam."),
      ["2+2=5 Simulator"],
    );
  });

  it("decodes numeric and named HTML entities for the marks", () => {
    assert.deepEqual(
      titles(
        "<p>Your friend friend-one has given you Example&trade; Racer&#174; &#x2122;Deluxe&reg; &copy;2026 on Steam.</p>",
      ),
      ["Example™ Racer® ™Deluxe® ©2026"],
    );
  });
});
