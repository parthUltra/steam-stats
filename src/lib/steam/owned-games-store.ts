/**
 * Where the fetched library is stored: samples/parsed/games-played.json.
 * Used by scripts/fetch-owned-games.ts and scripts/fetch-account-data.ts so
 * both write it the same way.
 */
import fs from "node:fs/promises";
import type { PlayedGame } from "@/lib/account-data/games-playtime";
import { writeJsonAtomic } from "@/lib/data/json-store";
import { rootPath } from "@/lib/runtime";

export const ownedGamesSnapshotPath = () =>
  rootPath("samples", "parsed", "games-played.json");

/** True when a readable snapshot with at least one game is on disk. */
export async function savedLibraryExists(): Promise<boolean> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(ownedGamesSnapshotPath(), "utf8"),
    ) as { games?: unknown[] };
    return Array.isArray(parsed.games) && parsed.games.length > 0;
  } catch {
    return false;
  }
}

/**
 * Save a fetched library atomically (a crash mid-write leaves the previous
 * file intact).
 *
 * An empty result never replaces a non-empty saved library: Steam answers
 * 200 with no games for an expired token or a private profile, and that is
 * not "the owner has no games".
 */
export async function saveOwnedGamesSnapshot(
  result: { steamId: string | null; games: PlayedGame[] },
  fetchedAt: string = new Date().toISOString(),
): Promise<{ written: boolean; games: number; path: string; reason?: string }> {
  const path = ownedGamesSnapshotPath();
  if (result.games.length === 0 && (await savedLibraryExists())) {
    return {
      written: false,
      games: 0,
      path,
      reason:
        "Steam returned an empty library; kept the last saved one (expired session or private profile?)",
    };
  }
  await writeJsonAtomic(path, {
    steamId: result.steamId,
    source: "steam-session-api",
    fetchedAt,
    games: result.games,
  });
  return { written: true, games: result.games.length, path };
}
