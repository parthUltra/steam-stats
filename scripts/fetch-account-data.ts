/**
 * Opens a real Steam login window, then fetches Account Data HTML pages locally.
 * Usage: npm run fetch:account-data
 *
 * Session cookies stay in .steam-session/ (gitignored). Never upload them.
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SAMPLES_DIR = path.join(ROOT, "samples", "account-data");
const SESSION_DIR = path.join(ROOT, ".steam-session");
const STORAGE_STATE = path.join(SESSION_DIR, "storage-state.json");

const PAGES: { id: string; url: string }[] = [
  { id: "accountdata-index", url: "https://help.steampowered.com/en/accountdata" },
  { id: "account", url: "https://store.steampowered.com/account/" },
  { id: "purchase-history", url: "https://store.steampowered.com/account/history/" },
  { id: "account-spend", url: "https://help.steampowered.com/en/accountdata/AccountSpend" },
  { id: "licenses", url: "https://store.steampowered.com/account/licenses/" },
  { id: "login-history", url: "https://help.steampowered.com/en/accountdata/SteamLoginHistory" },
  { id: "games-all", url: "https://steamcommunity.com/my/games?tab=all" },
  { id: "games-recent", url: "https://steamcommunity.com/my/games?tab=recent" },
];

async function ensureDirs() {
  await fs.mkdir(SAMPLES_DIR, { recursive: true });
  await fs.mkdir(SESSION_DIR, { recursive: true });
}

async function hasExistingSession(): Promise<boolean> {
  try {
    await fs.access(STORAGE_STATE);
    return true;
  } catch {
    return false;
  }
}

async function waitForSteamLogin(page: Page) {
  console.log("\n>>> Log into Steam in the opened browser window (Steam Guard if asked).");
  console.log(">>> Waiting up to 10 minutes for a successful login...\n");

  await page.goto("https://help.steampowered.com/en/accountdata", {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = page.url();
    const cookies = await page.context().cookies();
    const hasSecure = cookies.some((c) => c.name === "steamLoginSecure");
    const notOnLogin =
      !url.includes("/login") &&
      !url.includes("openid") &&
      !url.includes("SteamLogin");

    if (hasSecure && notOnLogin) {
      // Confirm we can load account data
      await page.goto("https://help.steampowered.com/en/accountdata", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const stillHasSecure = (await page.context().cookies()).some(
        (c) => c.name === "steamLoginSecure",
      );
      if (stillHasSecure && !page.url().includes("/login")) {
        console.log("Steam session detected.");
        return;
      }
    }

    await page.waitForTimeout(1500);
  }

  throw new Error("Timed out waiting for Steam login.");
}

async function savePage(page: Page, id: string, url: string) {
  console.log(`Fetching ${id}: ${url}`);
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);

  // Expand paginated Account Data / wallet history tables when present
  for (let i = 0; i < 40; i++) {
    const loadMore = page.locator(
      ".AccountDataLoadMore:visible, #load_more_button:visible",
    );
    if ((await loadMore.count()) === 0) break;
    const first = loadMore.first();
    const style = await first.getAttribute("style");
    if (style?.includes("display: none") || style?.includes("display:none")) break;
    try {
      await first.click({ timeout: 3000 });
      await page.waitForTimeout(1200);
    } catch {
      break;
    }
  }

  const html = await page.content();
  const status = response?.status() ?? 0;
  const finalUrl = page.url();
  const outPath = path.join(SAMPLES_DIR, `${id}.html`);
  await fs.writeFile(outPath, html, "utf8");

  const meta = {
    id,
    requestedUrl: url,
    finalUrl,
    status,
    savedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(html, "utf8"),
  };
  await fs.writeFile(
    path.join(SAMPLES_DIR, `${id}.meta.json`),
    JSON.stringify(meta, null, 2),
    "utf8",
  );
  console.log(`  → ${outPath} (${meta.bytes} bytes, HTTP ${status})`);
  return meta;
}

async function main() {
  await ensureDirs();
  const reuse = await hasExistingSession();

  const browser = await chromium.launch({
    headless: false,
    channel: undefined,
  });

  const context = await browser.newContext(
    reuse
      ? { storageState: STORAGE_STATE }
      : {
          viewport: { width: 1280, height: 900 },
          userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
  );

  const page = await context.newPage();

  try {
    if (reuse) {
      console.log("Reusing saved Steam session from .steam-session/");
      await page.goto("https://help.steampowered.com/en/accountdata", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      const cookies = await context.cookies();
      const hasSecure = cookies.some((c) => c.name === "steamLoginSecure");
      if (!hasSecure || page.url().includes("/login")) {
        console.log("Saved session expired; please log in again.");
        await waitForSteamLogin(page);
      } else {
        console.log("Saved session is valid.");
      }
    } else {
      await waitForSteamLogin(page);
    }

    await context.storageState({ path: STORAGE_STATE });
    console.log(`Session saved to ${STORAGE_STATE}`);

    const results = [];
    for (const entry of PAGES) {
      try {
        results.push(await savePage(page, entry.id, entry.url));
      } catch (err) {
        console.error(`Failed ${entry.id}:`, err);
        results.push({
          id: entry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await fs.writeFile(
      path.join(SAMPLES_DIR, "_manifest.json"),
      JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2),
      "utf8",
    );

    console.log("\nDone. Samples written to samples/account-data/");
    console.log("Fetching full owned-games library via session token…");
    try {
      const { fetchOwnedGamesFromSteamSession } = await import(
        "../src/lib/steam/owned-games"
      );
      const owned = await fetchOwnedGamesFromSteamSession();
      if (owned?.games.length) {
        const outDir = path.join(ROOT, "samples", "parsed");
        await fs.mkdir(outDir, { recursive: true });
        const outPath = path.join(outDir, "games-played.json");
        await fs.writeFile(
          outPath,
          JSON.stringify(
            {
              steamId: owned.steamId,
              source: "steam-session-api",
              fetchedAt: new Date().toISOString(),
              games: owned.games,
            },
            null,
            2,
          ),
          "utf8",
        );
        console.log(
          `Full library: ${owned.games.length} games → ${outPath}`,
        );
      } else {
        console.log(
          "Could not fetch full library via token; HTML games page may be partial (~25).",
        );
      }
    } catch (err) {
      console.error("Owned-games fetch failed:", err);
    }
    console.log("Next: npm run parse:account-data (purchases/licenses); library playtime already saved if session API worked.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
