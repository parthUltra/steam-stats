import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LicenseRow, PlayedGame } from "../account-data";
import { withOwnedLicenses } from "./pricing-titles";

const lic = (item: string): LicenseRow => ({
  dateText: "1 Jan, 2024",
  item,
  acquisitionMethod: "Steam Store",
  packageId: null,
  removableComplimentary: false,
});

const played = (appId: number, name: string): PlayedGame => ({
  appId,
  name,
  hoursForever: 5,
  hours2Weeks: null,
  lastPlayedText: null,
  lastPlayedAt: null,
  minutesForever: 300,
});

describe("withOwnedLicenses", () => {
  const playedGames = [
    played(1, "Starfall Tactics"),
    played(24, "Lanternfall"),
    played(25, "Lanternfall Remnant"),
    played(23, "Anvil Saga: The Complete Collection"),
  ];
  const quotes = [
    { title: "Starfall Tactics - Crimson Front", steamAppId: 101 },
    { title: "Lanternfall Collection", steamAppId: 201 },
    { title: "Ironroot II", steamAppId: 9 },
  ];
  const licenses = [
    lic("Starfall Tactics - Crimson Front"),
    lic("Lanternfall Collection"),
    lic("Ironroot II"),
    lic("Anvil Saga: The Complete Collection"),
  ];

  it("adds a never-launched game, but not DLC or a multi-game pack", () => {
    const out = withOwnedLicenses(
      { licenses, playedGames },
      quotes,
      new Map([[101, 1]]),
    );
    assert.deepEqual(
      out.map((g) => g.appId).sort((a, b) => a - b),
      [1, 9, 23, 24, 25],
    );
  });

  it("without a DLC map, still keeps packs out", () => {
    const out = withOwnedLicenses({ licenses, playedGames }, quotes);
    assert.equal(out.some((g) => g.appId === 201), false);
  });
});
