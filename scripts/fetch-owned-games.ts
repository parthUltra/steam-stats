/**
 * Fetch full owned-games library using the local Steam Playwright session
 * (steamLoginSecure access token) and write samples/parsed/games-played.json.
 *
 * Usage: npm run fetch:owned-games
 */
import { safeErrorMessage } from "../src/lib/data/redact";
import { fetchOwnedGamesFromSteamSession } from "../src/lib/steam/owned-games";
import {
  ownedGamesSnapshotPath,
  saveOwnedGamesSnapshot,
  savedLibraryExists as existingLibraryExists,
} from "../src/lib/steam/owned-games-store";

// Same data root as every reader (honours STEAM_STATS_ROOT).
const OUT = ownedGamesSnapshotPath();

async function main() {
  let result;
  try {
    result = await fetchOwnedGamesFromSteamSession();
  } catch (err) {
    if (await existingLibraryExists()) {
      console.warn(
        "Owned-games refresh failed; keeping the last saved library.",
      );
      console.warn(safeErrorMessage(err));
      process.exit(0);
    }
    throw err;
  }

  if (!result) {
    if (await existingLibraryExists()) {
      console.warn(
        "No Steam session found; keeping the last saved library.",
      );
      process.exit(0);
    }
    console.error(
      "No Steam session found. Run: npm run fetch:account-data (log in once)",
    );
    process.exit(1);
  }

  // Atomic write; an empty answer never replaces a saved non-empty library
  // (Steam returns 200 with no games for an expired token / private profile).
  const saved = await saveOwnedGamesSnapshot(result);
  if (!saved.written) {
    console.warn(saved.reason);
    process.exit(0);
  }

  const hours = result.games.reduce((s, g) => s + g.hoursForever, 0);
  const played = result.games.filter((g) => g.hoursForever > 0).length;
  const family = result.games.filter((g) => g.fromFamily).length;
  console.log(
    `Wrote ${result.games.length} games (${played} played, ${family} family-played, ${hours.toFixed(1)}h) → ${OUT}`,
  );
  if (result.familyPlayedCount > 0) {
    console.log(
      `  (+${result.familyPlayedCount} titles from Steam Family Library)`,
    );
  }
}

main().catch(async (err) => {
  if (await existingLibraryExists()) {
    console.warn(
      "Owned-games refresh failed; keeping the last saved library.",
    );
    console.warn(safeErrorMessage(err));
    process.exit(0);
  }
  // message only: never dump an error object that could carry a request URL
  console.error(safeErrorMessage(err));
  process.exit(1);
});
