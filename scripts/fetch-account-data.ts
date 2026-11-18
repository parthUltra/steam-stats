/**
 * Opens a real Steam login window, then fetches Account Data HTML pages locally.
 * Usage: npm run fetch:account-data
 *
 * Session cookies stay in .steam-session/ (gitignored). Never upload them.
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {
  loadWholePurchaseHistory,
  markPurchaseHistoryComplete,
  staleLicensePageFiles,
  walkLicensePages,
} from "../src/lib/account-data/pagination";
import { isLicensesPage } from "../src/lib/account-data/parsers";
import { safeErrorMessage } from "../src/lib/data/redact";
import {
  ensurePrivateDir,
  makePrivate,
  writePrivateFile,
} from "../src/lib/process/private-files";
import { rootPath } from "../src/lib/runtime";
import { saveOwnedGamesSnapshot } from "../src/lib/steam/owned-games-store";

// Data root (honours STEAM_STATS_ROOT), the same one every reader uses.
const SAMPLES_DIR = rootPath("samples", "account-data");
const SESSION_DIR = rootPath(".steam-session");
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
  // Purchase/login history and the Steam login cookie: owner-only.
  await ensurePrivateDir(rootPath("samples"));
  await ensurePrivateDir(SAMPLES_DIR);
  await ensurePrivateDir(SESSION_DIR);
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

const HELP_TABLE_IDS = new Set(["account-spend", "login-history"]);

async function waitOutHelpLogin(page: Page) {
  const url = page.url();
  if (!url.includes("/login") && !url.includes("need_password")) return;

  console.log(
    "  Steam Help wants your password for this page. Enter it in the browser window.",
  );
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const now = page.url();
    if (!now.includes("/login") && !now.includes("need_password")) {
      await page.waitForTimeout(800);
      return;
    }
    await page.waitForTimeout(1000);
  }
  console.warn("  Timed out waiting for Steam Help password.");
}

async function savePage(page: Page, id: string, url: string) {
  console.log(`Fetching ${id}: ${url}`);
  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForTimeout(1500);
  await waitOutHelpLogin(page);

  if (HELP_TABLE_IDS.has(id)) {
    try {
      await page.waitForSelector("table.AccountDataTable, table.accountdatatable", {
        timeout: 60_000,
      });
    } catch {
      console.warn(
        `  ${id}: Account Data table not found (Steam Help may still be on the login page).`,
      );
    }
  }

  // Licenses table is server-rendered but can be huge — wait, scroll, stabilize.
  if (id === "licenses") {
    await settleLicensesTable(page);
  }

  // Expand "Load more" tables until nothing is left to load.
  let historyComplete = false;
  if (id === "purchase-history") {
    // The history page keeps a cursor while rows remain behind the button.
    ({ complete: historyComplete } = await loadWholePurchaseHistory({
      probe: () => probeHistoryPage(page),
      clickLoadMore: () => clickLoadMore(page),
      maxClicks: LOAD_MORE_CAP,
      log: (line) => console.log(`  ${line}`),
    }));
  } else {
    let clicks = 0;
    while (clicks < LOAD_MORE_CAP && (await clickLoadMore(page))) clicks += 1;
    if (clicks >= LOAD_MORE_CAP) {
      console.warn(
        `  ${id}: INCOMPLETE — still offering "Load more" after ${clicks} clicks`,
      );
    } else if (clicks) {
      console.log(`  ${id}: expanded with ${clicks} "Load more" click(s)`);
    }
  }

  if (id === "licenses") {
    await settleLicensesTable(page);
  }

  let html = await page.content();
  // The saved DOM still holds the page's original cursor script; record that
  // every row is loaded so the parser does not report the file as partial.
  if (id === "purchase-history" && historyComplete) {
    html = markPurchaseHistoryComplete(html);
  }
  const status = response?.status() ?? 0;
  const finalUrl = page.url();
  const outPath = path.join(SAMPLES_DIR, `${id}.html`);
  // A login / error page must not replace a good first licences page: the
  // later pages on disk belong to it.
  const keepSavedLicenses =
    id === "licenses" &&
    !isLicensesPage(html) &&
    isLicensesPage(await fs.readFile(outPath, "utf8").catch(() => ""));
  if (keepSavedLicenses) {
    console.warn(
      "  licenses: Steam did not return the licences page (login required?) — kept the previously saved pages.",
    );
    return {
      id,
      requestedUrl: url,
      finalUrl,
      status,
      savedAt: null,
      licensePages: 0,
      licensesComplete: false,
    };
  }
  await writePrivateFile(outPath, html);

  const meta = {
    id,
    requestedUrl: url,
    finalUrl,
    status,
    savedAt: new Date().toISOString(),
    bytes: Buffer.byteLength(html, "utf8"),
  };
  await writePrivateFile(
    path.join(SAMPLES_DIR, `${id}.meta.json`),
    JSON.stringify(meta, null, 2),
  );
  console.log(`  → ${outPath} (${meta.bytes} bytes, HTTP ${status})`);
  if (id === "licenses") {
    return { ...meta, ...(await saveFurtherLicensePages(page, finalUrl, html)) };
  }
  return meta;
}

/** How long one "Load more" response may take before the page counts as stuck. */
const HISTORY_SETTLE_TIMEOUT_MS = 30_000;

/**
 * Wait for the history page to finish its request, then read the cursor.
 * Steam's WalletHistory_LoadMore() sets g_historyCursor = null before the
 * request and restores it in .done(), so the cursor means nothing while the
 * spinner is showing or a jQuery request is active.
 */
async function probeHistoryPage(page: Page) {
  try {
    await page.waitForFunction(
      () => {
        const spinner = document.querySelector<HTMLElement>(
          "#wallet_history_loading",
        );
        const spinnerHidden =
          !spinner ||
          spinner.offsetParent === null ||
          getComputedStyle(spinner).display === "none";
        const jq = (window as unknown as { jQuery?: { active?: number } })
          .jQuery;
        return spinnerHidden && (!jq || jq.active === 0);
      },
      undefined,
      { timeout: HISTORY_SETTLE_TIMEOUT_MS },
    );
  } catch {
    return { settled: false, cursorPresent: false };
  }
  const cursorPresent = await page.evaluate(
    () =>
      (window as unknown as { g_historyCursor?: unknown }).g_historyCursor !=
      null,
  );
  return { settled: true, cursorPresent };
}

/** Clicks before giving up on a "Load more" table (each adds a page of rows). */
const LOAD_MORE_CAP = 500;

/** Click a visible "Load more" control; false when there is none to click. */
async function clickLoadMore(page: Page): Promise<boolean> {
  const loadMore = page.locator(
    ".AccountDataLoadMore:visible, #load_more_button:visible, a.Link:has-text('Load more'):visible, button:has-text('Show more'):visible",
  );
  if ((await loadMore.count()) === 0) return false;
  const first = loadMore.first();
  const style = await first.getAttribute("style");
  if (style?.includes("display: none") || style?.includes("display:none")) {
    return false;
  }
  try {
    await first.click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    return true;
  } catch {
    return false;
  }
}

/**
 * The licences list is paginated ("Showing licenses 1-100 of 453"). Follow the
 * Next link until it disappears, saving licenses-2.html, licenses-3.html, …
 * next to licenses.html; the parser joins them. Pages left over from an
 * earlier, longer fetch are removed so they are not joined in.
 */
async function saveFurtherLicensePages(
  page: Page,
  firstUrl: string,
  firstHtml: string,
) {
  const walk = await walkLicensePages({
    firstUrl,
    firstHtml,
    load: async (url) => {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await settleLicensesTable(page);
      return page.content();
    },
    save: async (fileName, html, url) => {
      await writePrivateFile(path.join(SAMPLES_DIR, fileName), html);
      await writePrivateFile(
        path.join(SAMPLES_DIR, fileName.replace(/\.html$/, ".meta.json")),
        JSON.stringify(
          {
            id: fileName.replace(/\.html$/, ""),
            // The continuation token in the URL is account-specific: keep the path only
            requestedUrl: url.split("?")[0],
            savedAt: new Date().toISOString(),
            bytes: Buffer.byteLength(html, "utf8"),
          },
          null,
          2,
        ),
      );
    },
    log: (line) => console.log(`  → ${line}`),
  });

  // Only after a complete walk: an interrupted one keeps the older pages
  // rather than shrinking the list further.
  const stale = walk.complete
    ? staleLicensePageFiles(await fs.readdir(SAMPLES_DIR), walk.pages)
    : [];
  for (const file of stale) {
    await fs.unlink(path.join(SAMPLES_DIR, file)).catch(() => undefined);
    await fs
      .unlink(path.join(SAMPLES_DIR, file.replace(/\.html$/, ".meta.json")))
      .catch(() => undefined);
  }
  if (stale.length) {
    console.log(`  → licenses: removed ${stale.length} page file(s) from an older fetch`);
  }
  return { licensePages: walk.pages, licenseRows: walk.rows, licensesComplete: walk.complete };
}

/** Scroll + wait until the licenses account_table stops growing. */
async function settleLicensesTable(page: Page) {
  try {
    await page.waitForSelector("table.account_table", { timeout: 30_000 });
  } catch {
    console.warn("  licenses: account_table not found yet");
  }

  let last = 0;
  for (let i = 0; i < 25; i++) {
    await page.evaluate(async () => {
      const table = document.querySelector("table.account_table");
      table?.scrollIntoView({ block: "end" });
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(800);
    const n = await page.locator("table.account_table tr").count();
    if (n > 0 && n === last) break;
    last = n;
  }

  // One more beat for late paint
  try {
    await page.waitForLoadState("networkidle", { timeout: 8_000 });
  } catch {
    // ignore — Steam keeps sockets open
  }
  await page.waitForTimeout(1000);
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
      ? { storageState: STORAGE_STATE, viewport: { width: 1280, height: 900 } }
      : { viewport: { width: 1280, height: 900 } },
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
    await makePrivate(STORAGE_STATE);
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

    await writePrivateFile(
      path.join(SAMPLES_DIR, "_manifest.json"),
      JSON.stringify({ fetchedAt: new Date().toISOString(), results }, null, 2),
    );

    console.log("\nDone. Samples written to samples/account-data/");
    console.log("Fetching full owned-games library via session token…");
    try {
      const { fetchOwnedGamesFromSteamSession } = await import(
        "../src/lib/steam/owned-games"
      );
      const owned = await fetchOwnedGamesFromSteamSession();
      if (owned?.games.length) {
        // Atomic, owner-only, and never replaces a library with an empty one.
        const saved = await saveOwnedGamesSnapshot(owned);
        console.log(`Full library: ${saved.games} games → ${saved.path}`);
      } else {
        console.log(
          "Could not fetch full library via token; HTML games page may be partial (~25).",
        );
      }
    } catch (err) {
      // message only: an error object can carry a request URL with the token
      console.error("Owned-games fetch failed:", safeErrorMessage(err));
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
