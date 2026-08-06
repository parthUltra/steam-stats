/**
 * Fetch full owned-games library using the local Steam Playwright session
 * (steamLoginSecure access token) and write samples/parsed/games-played.json.
 *
 * Usage: npm run fetch:owned-games
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fetchOwnedGamesFromSteamSession } from "../src/lib/steam/owned-games";

const OUT = path.resolve(__dirname, "..", "samples", "parsed", "games-played.json");

async function main() {
  const result = await fetchOwnedGamesFromSteamSession();
  if (!result) {
    console.error(
      "No Steam session found. Run: npm run fetch:account-data (log in once)",
    );
    process.exit(1);
  }

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  const payload = {
    steamId: result.steamId,
    source: "steam-session-api",
    fetchedAt: new Date().toISOString(),
    games: result.games,
  };
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2), "utf8");

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
