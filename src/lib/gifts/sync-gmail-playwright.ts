/**
 * Opens Gmail in a dedicated automation browser window (isolated profile under
 * .gmail-session). Never quits or attaches to your everyday Chrome/Edge window.
 *
 * Flow: sign-in (once) → search Steam gift mails → open threads → parse titles
 * → merge into data/gifts-received.json.
 */
import { type Browser, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import {
  importReceivedGiftsFromText,
  loadReceivedGifts,
  type GiftsReceivedStore,
} from "@/lib/gifts/received-store";
import { parseSteamGiftEmails } from "@/lib/gifts/parse-steam-gift-email";
import { connectUserBrowser } from "@/lib/browser/user-chrome";

const ROOT = process.cwd();
const SESSION_DIR = path.join(ROOT, ".gmail-session");
const BROWSER_PROFILE_DIR = path.join(SESSION_DIR, "browser-profile");
const STATUS_FILE = path.join(SESSION_DIR, "status.json");
const PID_FILE = path.join(SESSION_DIR, "sync.pid");
const LAST_SCRAPE_FILE = path.join(SESSION_DIR, "last-scrape.txt");

/** One query covers Steam gift notifications — avoid looping 4 near-duplicate searches. */
const PRIMARY_SEARCH =
  'from:steampowered.com "gift copy of the game"';
/** Fallback if the primary phrase misses older wording. */
const FALLBACK_SEARCHES = [
  'from:steampowered.com "You\'ve received a gift"',
  'from:steampowered.com "has given you"',
];

const ROW_SELECTOR =
  "div[role='main'] tr.zA, div[role='main'] div.Cp tr.zA, table.F tr.zA, tr.zA";

/** Shorter pauses — Gmail is usually ready well before the old multi-second waits. */
const WAIT = {
  afterTypeSearch: 900,
  afterHashNav: 700,
  afterOpenMessage: 450,
  afterEscape: 350,
  scrollSettle: 250,
  inboxReady: 600,
} as const;

function looksLikeSteamGiftSubject(s: string): boolean {
  return /gift copy|received a gift|has given you|been sent a gift|ackgift/i.test(
    s,
  );
}

function gmailSearchHashUrl(query: string): string {
  // Gmail expects + for spaces in the hash segment
  const enc = encodeURIComponent(query).replace(/%20/g, "+");
  return `https://mail.google.com/mail/u/0/#search/${enc}`;
}

export type GmailSyncPhase =
  | "idle"
  | "starting"
  | "awaiting_login"
  | "scraping"
  | "done"
  | "error";

export type GmailSyncStatus = {
  phase: GmailSyncPhase;
  updatedAt: string;
  message?: string;
  error?: string;
  added?: number;
  parsed?: number;
  messagesScanned?: number;
  total?: number;
  lastSyncedAt?: string | null;
  pid?: number;
};

export type GmailSyncResult = {
  ok: boolean;
  added: number;
  parsed: number;
  messagesScanned: number;
  total: number;
  lastSyncedAt: string | null;
  store: GiftsReceivedStore;
  error?: string;
};

async function ensureSessionDir() {
  await fs.mkdir(SESSION_DIR, { recursive: true });
}

export async function readGmailSyncStatus(): Promise<GmailSyncStatus> {
  try {
    const raw = await fs.readFile(STATUS_FILE, "utf8");
    return JSON.parse(raw) as GmailSyncStatus;
  } catch {
    return { phase: "idle", updatedAt: "" };
  }
}

async function writeStatus(
  partial: Partial<GmailSyncStatus> & { phase: GmailSyncPhase },
) {
  await ensureSessionDir();
  const prev = await readGmailSyncStatus();
  const next: GmailSyncStatus = {
    ...prev,
    ...partial,
    updatedAt: new Date().toISOString(),
    pid: partial.pid ?? process.pid,
  };
  await fs.writeFile(STATUS_FILE, JSON.stringify(next, null, 2));
}

async function writePid() {
  await ensureSessionDir();
  await fs.writeFile(PID_FILE, String(process.pid));
}

async function clearPid() {
  try {
    await fs.unlink(PID_FILE);
  } catch {
    // ignore
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function isGmailSyncRunning(): Promise<boolean> {
  try {
    const raw = await fs.readFile(PID_FILE, "utf8");
    const pid = Number(raw.trim());
    if (!Number.isFinite(pid) || pid <= 0) return false;
    if (!isPidAlive(pid)) {
      await clearPid();
      const st = await readGmailSyncStatus();
      if (
        st.phase === "starting" ||
        st.phase === "awaiting_login" ||
        st.phase === "scraping"
      ) {
        await writeStatus({
          phase: "error",
          error: "Gmail sync process exited unexpectedly",
          message: "Sync stopped. Try again.",
        });
      }
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function waitForGmailInbox(page: Page, browserLabel: string) {
  await writeStatus({
    phase: "awaiting_login",
    message: `In the separate ${browserLabel} window: sign in to Gmail if asked (saved for next sync). Your other windows stay open.`,
  });
  console.log(`\n>>> In the separate ${browserLabel} window for steam-stats:`);
  console.log(">>>   Sign in to Gmail if prompted (this profile is isolated).");
  console.log(">>>   Your everyday browser is left alone.");
  console.log(">>> Waiting up to 10 minutes for Gmail inbox…\n");

  try {
    await page.goto("https://mail.google.com/mail/u/0/#inbox", {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
  } catch {
    // may already be on Gmail from launch URL
  }

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = page.url();
    const onAccounts =
      url.includes("accounts.google.com") ||
      url.includes("ServiceLogin") ||
      url.includes("signin") ||
      url.includes("challenge");
    const onMail =
      url.includes("mail.google.com/mail") &&
      !onAccounts &&
      (url.includes("#inbox") ||
        url.includes("#search") ||
        url.includes("#label") ||
        url.includes("#all") ||
        url.includes("#category") ||
        url.includes("#sent"));

    if (onMail) {
      try {
        await page.waitForSelector(
          "div[role='main'], div.AO, div.aeF, div.nH",
          { timeout: 15_000 },
        );
      } catch {
        // keep polling
      }
      if (!page.url().includes("accounts.google.com")) {
        console.log("Gmail session detected.");
        return;
      }
    }

    await page.waitForTimeout(1500);
  }

  throw new Error("Timed out waiting for Gmail login.");
}

async function typeSearchInBox(page: Page, query: string): Promise<boolean> {
  const candidates = [
    'form[role="search"] input',
    'input[aria-label="Search mail"]',
    'input[name="q"]',
    'input[placeholder*="Search"]',
  ];
  for (const sel of candidates) {
    const box = page.locator(sel).first();
    try {
      if ((await box.count()) === 0) continue;
      await box.click({ timeout: 4000 });
      // Clear any previous query thoroughly
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      await page.keyboard.press(`${mod}+A`);
      await page.keyboard.press("Backspace");
      await box.fill(query);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(WAIT.afterTypeSearch);
      return true;
    } catch {
      // try next selector
    }
  }
  return false;
}

async function waitForSearchSettled(page: Page) {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const url = page.url();
    const onSearch = url.includes("#search/") || url.includes("#search");
    const n = await page.locator(ROW_SELECTOR).count().catch(() => 0);
    if (onSearch && n > 0) return;
    const empty = await page.evaluate(`(() => {
      const t = (document.body && document.body.innerText || "").toLowerCase();
      return (
        t.includes("no messages matched your search") ||
        t.includes("no matching conversations") ||
        t.includes("didn't match any messages")
      );
    })()`);
    if (empty) return;
    await page.waitForTimeout(300);
  }
}

async function runSearch(page: Page, query: string) {
  // Land on inbox first so the search box is available and not stuck on a thread.
  try {
    if (
      !page.url().includes("mail.google.com/mail") ||
      page.url().includes("accounts.google.com")
    ) {
      await page.goto("https://mail.google.com/mail/u/0/#inbox", {
        waitUntil: "domcontentloaded",
        timeout: 120_000,
      });
      await page.waitForTimeout(WAIT.inboxReady);
    }
  } catch {
    // continue
  }

  try {
    await page.waitForSelector("div[role='main'], form[role='search']", {
      timeout: 25_000,
    });
  } catch {
    // continue
  }

  // Prefer the search box — hash URLs often drop quotes / from: filters.
  const typed = await typeSearchInBox(page, query);
  if (!typed) {
    await page.goto(gmailSearchHashUrl(query), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForTimeout(WAIT.afterHashNav);
  }

  await waitForSearchSettled(page);

  // If we got results but the URL/query doesn't look like our gift search,
  // force the hash URL as a second attempt.
  const url = page.url();
  const looksGiftSearch =
    /gift|ackgift|given\+you|given%20you/i.test(url) ||
    /gift copy|received a gift|has given you/i.test(
      decodeURIComponent(url.replace(/\+/g, " ")),
    );
  const n = await page.locator(ROW_SELECTOR).count().catch(() => 0);
  if (n > 0 && !looksGiftSearch && !typed) {
    await page.goto(gmailSearchHashUrl(query), {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForTimeout(WAIT.afterHashNav);
    await waitForSearchSettled(page);
  }
}

async function scrollResults(page: Page) {
  for (let i = 0; i < 4; i++) {
    const before = await page.locator(ROW_SELECTOR).count().catch(() => 0);
    await page.evaluate(`(() => {
      const main =
        document.querySelector("div[role='main'] div.AO") ||
        document.querySelector("div[role='main']") ||
        document.scrollingElement;
      if (main) main.scrollTop += 1400;
    })()`);
    await page.waitForTimeout(WAIT.scrollSettle);
    const after = await page.locator(ROW_SELECTOR).count().catch(() => 0);
    if (after <= before) break;
  }
}

async function collectSearchRowSubjects(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const subjects = new Set();
    const add = (t) => {
      const s = (t || "").replace(/\\s+/g, " ").trim();
      if (s.length > 2 && s.length < 300) subjects.add(s);
    };

    document.querySelectorAll("tr.zA").forEach((row) => {
      const bogEl = row.querySelector("span.bog");
      const bqeEl = row.querySelector("span.bqe");
      const bog = bogEl && bogEl.textContent;
      const bqe = bqeEl && bqeEl.textContent;
      if ((bog || "").length >= (bqe || "").length) add(bog);
      else add(bqe);
      add(bog);
      add(bqe);
      const y6 = row.querySelector("div.y6");
      add(y6 && y6.textContent);
      const aria = row.getAttribute("aria-label");
      if (aria) add(aria);
    });

    return Array.from(subjects);
  })()`) as Promise<string[]>;
}

/** Row indexes whose list text looks like a Steam gift notification. */
async function giftRowIndexes(page: Page): Promise<number[]> {
  return page.evaluate(`(() => {
    const indexes = [];
    const rows = document.querySelectorAll("tr.zA");
    rows.forEach((row, i) => {
      const text = (row.innerText || row.textContent || "");
      if (/gift copy|received a gift|has given you|been sent a gift|ackgift/i.test(text)) {
        indexes.push(i);
      }
    });
    return indexes;
  })()`) as Promise<number[]>;
}

async function extractOpenMessage(page: Page): Promise<string> {
  return page.evaluate(`(() => {
    const h2 = document.querySelector("h2.hP") || document.querySelector("div[role='main'] h2");
    const subject = (h2 && h2.textContent || "").trim();
    const dateEl =
      document.querySelector("span.g3") ||
      document.querySelector("span[title*='20']");
    const dateAttr =
      (dateEl && (dateEl.getAttribute("title") || dateEl.textContent)) || "";
    const bodyEl =
      document.querySelector("div.a3s.aiL") ||
      document.querySelector("div.a3s") ||
      document.querySelector("div.ii.gt div") ||
      document.querySelector("div[data-message-id]");
    const body =
      (bodyEl && (bodyEl.innerText || bodyEl.textContent)) || "";
    const dateLine = dateAttr ? "Date: " + dateAttr + "\\n" : "";
    return "Subject: " + subject + "\\n" + dateLine + "\\n" + body;
  })()`) as Promise<string>;
}

async function forceSearchList(page: Page, searchUrl: string) {
  // Prefer Escape back to the list — full reload only when rows are gone.
  try {
    await page.keyboard.press("Escape");
  } catch {
    // ignore
  }
  await page.waitForTimeout(WAIT.afterEscape);
  const onSearch = page.url().includes("#search");
  const n = await page.locator(ROW_SELECTOR).count().catch(() => 0);
  if (onSearch && n > 0) return;

  await page.goto(searchUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(WAIT.afterHashNav);
  try {
    await page.waitForSelector(ROW_SELECTOR, { timeout: 8_000 });
  } catch {
    // empty or still loading
  }
}

/**
 * Open each gift thread by re-finding gift rows on the list after every visit.
 * Index-based clicks break once Gmail leaves conversation view half-open.
 */
async function openGiftRowsAndCollectBodies(
  page: Page,
  limit: number,
  onProgress?: (opened: number, total: number) => Promise<void>,
): Promise<string[]> {
  const blobs: string[] = [];
  const searchUrl = page.url();
  const initial = await giftRowIndexes(page);
  const total = Math.min(initial.length, limit);
  if (total <= 0) return blobs;

  const seenSubjects = new Set<string>();

  for (let i = 0; i < total; i++) {
    try {
      // Previous iteration's finally already Escaped back to the list.
      if (i === 0 && !page.url().includes("#search/")) {
        await forceSearchList(page, searchUrl);
      }

      const indexes = await giftRowIndexes(page);
      if (!indexes.length) {
        console.warn("  no gift rows left on list");
        break;
      }

      // Prefer the i-th gift row; fall back to first not-yet-seen subject
      const rows = page.locator(ROW_SELECTOR);
      const n = await rows.count().catch(() => 0);
      let clicked = false;

      const tryClick = async (rowIndex: number) => {
        if (rowIndex < 0 || rowIndex >= n) return false;
        await rows.nth(rowIndex).click({ timeout: 4000 });
        return true;
      };

      const preferred = indexes[Math.min(i, indexes.length - 1)];
      clicked = await tryClick(preferred);
      if (!clicked) {
        for (const idx of indexes) {
          if (await tryClick(idx)) {
            clicked = true;
            break;
          }
        }
      }
      if (!clicked) {
        console.warn(`  could not click gift row ${i + 1}`);
        continue;
      }

      await page.waitForTimeout(WAIT.afterOpenMessage);
      try {
        await page.waitForSelector("h2.hP, div.a3s, div.ii.gt", {
          timeout: 5_000,
        });
      } catch {
        // still try extract
      }

      const piece = await extractOpenMessage(page);
      const subj =
        piece.match(/^Subject:\s*(.+)$/im)?.[1]?.trim().toLowerCase() ?? "";
      if (subj && seenSubjects.has(subj)) {
        // Same thread again — skip duplicate
      } else if (
        looksLikeSteamGiftSubject(piece) ||
        /ackgift|steampowered|has given you/i.test(piece)
      ) {
        if (subj) seenSubjects.add(subj);
        blobs.push(piece);
        console.log(
          `  read body ${blobs.length}: ${subj.slice(0, 60) || "(no subject)"}`,
        );
      }
    } catch (err) {
      console.warn(
        `Skip gift thread ${i + 1}:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      await forceSearchList(page, searchUrl);
      await onProgress?.(i + 1, total);
    }
  }

  return blobs;
}

/**
 * Fallback: for each known gift subject, search that mail alone and open it.
 * Guarantees we visit every gift even if the multi-result list is flaky.
 */
function focusedQueryForGiftSubject(subject: string): string {
  const cleaned = subject.replace(/"/g, "").trim();
  const m = cleaned.match(
    /gift copy of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?$/i,
  );
  if (m?.[1]) {
    return `from:steampowered.com "gift copy of the game ${m[1].trim()}"`;
  }
  return `from:steampowered.com "${cleaned.slice(0, 90)}"`;
}

async function openEachGiftSubject(
  page: Page,
  subjects: string[],
  onProgress?: (opened: number, total: number) => Promise<void>,
): Promise<string[]> {
  const blobs: string[] = [];
  const unique = [...new Set(subjects.filter(looksLikeSteamGiftSubject))];
  const total = unique.length;
  if (!total) return blobs;

  for (let i = 0; i < unique.length; i++) {
    const subject = unique[i];
    const query = focusedQueryForGiftSubject(subject);
    try {
      await writeStatus({
        phase: "scraping",
        message: `Reading sender ${i + 1}/${total}…`,
        messagesScanned: i + 1,
      });
      console.log(`  focused search: ${query}`);
      await runSearch(page, query);
      await page.waitForTimeout(WAIT.afterTypeSearch);

      const indexes = await giftRowIndexes(page);
      const rows = page.locator(ROW_SELECTOR);
      const n = await rows.count().catch(() => 0);
      const idx = indexes[0] ?? (n > 0 ? 0 : -1);
      if (idx < 0 || idx >= n) {
        if (n > 0) {
          await rows.nth(0).click({ timeout: 4000 });
        } else {
          console.warn(`  no row for: ${subject.slice(0, 50)}`);
          await onProgress?.(i + 1, total);
          continue;
        }
      } else {
        await rows.nth(idx).click({ timeout: 4000 });
      }

      await page.waitForTimeout(WAIT.afterOpenMessage);
      try {
        await page.waitForSelector("h2.hP, div.a3s, div.ii.gt", {
          timeout: 5_000,
        });
      } catch {
        // ignore
      }

      const piece = await extractOpenMessage(page);
      if (
        looksLikeSteamGiftSubject(piece) ||
        /ackgift|has given you|steampowered/i.test(piece)
      ) {
        blobs.push(piece);
        const persona = piece.match(
          /your friend\s+(.+?)\s+has given you/i,
        )?.[1];
        console.log(
          `  sender mail ${blobs.length}: ${persona ? `from ${persona}` : subject.slice(0, 40)}`,
        );
      }
    } catch (err) {
      console.warn(
        `Skip subject ${i + 1}:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      await onProgress?.(i + 1, total);
    }
  }

  return blobs;
}

type ScrapeResult = {
  raw: string;
  subjects: string[];
  threadsOpened: number;
  queriesTried: number;
};

function subjectsToRaw(subjects: string[]): string {
  return subjects
    .filter(looksLikeSteamGiftSubject)
    .map((s) => `Subject: ${s}\n`)
    .join("\n\n----\n\n");
}

function giftTitleFromSubject(subject: string): string | null {
  const m = subject.match(
    /gift copy of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?$/i,
  );
  return m?.[1]?.trim() || null;
}

function storeAlreadyHasSender(
  store: GiftsReceivedStore,
  title: string,
): boolean {
  const t = title.toLowerCase();
  return store.gifts.some(
    (g) =>
      Boolean(g.fromPersona && g.giftUrl) &&
      (g.title.toLowerCase() === t ||
        g.title.toLowerCase().includes(t) ||
        t.includes(g.title.toLowerCase())),
  );
}

async function scrapeGiftEmailText(page: Page): Promise<ScrapeResult> {
  const allGiftSubjects = new Set<string>();
  const allBodies: string[] = [];
  let threadsOpened = 0;
  let queriesTried = 0;
  const existing = await loadReceivedGifts();

  const queries = [PRIMARY_SEARCH, ...FALLBACK_SEARCHES];

  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi];
    queriesTried = qi + 1;
    await writeStatus({
      phase: "scraping",
      message: qi === 0 ? "Searching Steam gift mail…" : "Trying another search…",
    });
    console.log(`\nGmail search ${qi + 1}/${queries.length}: ${query}`);

    await runSearch(page, query);
    await scrollResults(page);

    const subjects = (await collectSearchRowSubjects(page)).filter(
      looksLikeSteamGiftSubject,
    );
    for (const s of subjects) allGiftSubjects.add(s);
    console.log(`  gift-like subjects: ${subjects.length}`);
    for (const s of subjects.slice(0, 8)) console.log(`    · ${s}`);

    const giftRows = await giftRowIndexes(page);
    if (!subjects.length && !giftRows.length) {
      console.log("  no gift-like rows for this query");
      continue;
    }

    const expected = Math.max(
      subjects.length,
      giftRows.length,
      parseSteamGiftEmails(subjectsToRaw([...allGiftSubjects])).length,
    );

    const needSenderSubjects = [...allGiftSubjects].filter((subject) => {
      const title = giftTitleFromSubject(subject);
      return title ? !storeAlreadyHasSender(existing, title) : true;
    });

    if (!needSenderSubjects.length && expected > 0) {
      console.log(
        "  all gift subjects already have senders in store — skipping body scrape",
      );
      await writeStatus({
        phase: "scraping",
        message: `Found ${expected} gift(s) — already synced`,
        messagesScanned: expected,
      });
      break;
    }

    await writeStatus({
      phase: "scraping",
      message: `Found ${expected || giftRows.length} gift(s) — reading senders…`,
      messagesScanned: expected || giftRows.length,
    });

    // Fast path: walk the result list once (one search, Escape between mails).
    const bodies = await openGiftRowsAndCollectBodies(
      page,
      Math.min(40, Math.max(giftRows.length, expected, 1)),
      async (opened, total) => {
        threadsOpened = Math.max(threadsOpened, opened);
        await writeStatus({
          phase: "scraping",
          message: `Reading gift emails… ${opened}/${total}`,
          messagesScanned: expected || total,
        });
      },
    );
    allBodies.push(...bodies);
    console.log(`  list walk kept ${bodies.length} body(ies)`);

    const parsedTitles = parseSteamGiftEmails(
      [subjectsToRaw([...allGiftSubjects]), ...allBodies]
        .filter(Boolean)
        .join("\n\n----\n\n"),
    );
    const withSender = parsedTitles.filter((g) => g.fromPersona).length;
    console.log(
      `  parsed ${parsedTitles.length} gift(s), ${withSender} with sender`,
    );

    // Only focused-search titles still missing a body/sender (not every mail).
    const missingSubjects = [...allGiftSubjects].filter((subject) => {
      const title = giftTitleFromSubject(subject);
      if (!title) return false;
      if (storeAlreadyHasSender(existing, title)) return false;
      const hit = parsedTitles.find(
        (g) =>
          g.title.toLowerCase() === title.toLowerCase() ||
          g.title.toLowerCase().includes(title.toLowerCase()) ||
          title.toLowerCase().includes(g.title.toLowerCase()),
      );
      return !hit?.fromPersona || !hit?.giftUrl;
    });

    if (missingSubjects.length && withSender < expected) {
      console.log(
        `  filling ${missingSubjects.length} missing sender(s) via focused search`,
      );
      const more = await openEachGiftSubject(
        page,
        missingSubjects,
        async (opened, total) => {
          threadsOpened = Math.max(threadsOpened, opened);
          await writeStatus({
            phase: "scraping",
            message: `Reading missing senders… ${opened}/${total}`,
            messagesScanned: expected,
          });
        },
      );
      allBodies.push(...more);
    }

    if (parsedTitles.length > 0 || allBodies.length > 0) {
      console.log("  done — saving & closing");
      break;
    }
  }

  const raw = [subjectsToRaw([...allGiftSubjects]), ...allBodies]
    .filter(Boolean)
    .join("\n\n----\n\n");
  try {
    await ensureSessionDir();
    await fs.writeFile(LAST_SCRAPE_FILE, raw || "(empty scrape)", "utf8");
  } catch {
    // ignore
  }

  return {
    raw,
    subjects: [...allGiftSubjects],
    threadsOpened,
    queriesTried,
  };
}

/**
 * Full sync — intended to run in a dedicated Node process (CLI / spawned).
 */
export async function syncGiftsFromGmail(): Promise<GmailSyncResult> {
  await ensureSessionDir();
  await writePid();
  await writeStatus({
    phase: "starting",
    message: "Opening a separate browser window for Gmail…",
    error: undefined,
  });

  const before = await loadReceivedGifts();
  let browser: Browser | null = null;

  try {
    const attached = await connectUserBrowser({
      startUrl: "https://mail.google.com/mail/u/0/#inbox",
      isolatedUserDataDir: BROWSER_PROFILE_DIR,
      onStatus: async (message) => {
        await writeStatus({ phase: "starting", message });
      },
    });
    browser = attached.browser;
    const page = attached.page;
    const browserLabel = attached.target.label;

    try {
      await page.bringToFront();
    } catch {
      // ignore
    }

    await waitForGmailInbox(page, browserLabel);
    const scrape = await scrapeGiftEmailText(page);

    if (!scrape.raw.trim()) {
      await writeStatus({
        phase: "done",
        message:
          "No Steam gift emails found. Check the separate window is signed into the right Gmail account, then try again.",
        added: 0,
        parsed: 0,
        messagesScanned: scrape.threadsOpened,
        total: before.gifts.length,
        lastSyncedAt: before.lastMailSyncedAt ?? null,
      });
      return {
        ok: true,
        added: 0,
        parsed: 0,
        messagesScanned: scrape.threadsOpened,
        total: before.gifts.length,
        lastSyncedAt: before.lastMailSyncedAt ?? null,
        store: before,
      };
    }

    await writeStatus({
      phase: "scraping",
      message: "Parsing gift emails and saving…",
      messagesScanned: scrape.threadsOpened,
    });

    const preview = parseSteamGiftEmails(scrape.raw);
    const imported = await importReceivedGiftsFromText(scrape.raw, {
      lastMailSyncedAt: new Date().toISOString(),
      allowEmpty: true,
    });

    const parsed = Math.max(imported.parsed, preview.length);
    const result: GmailSyncResult = {
      ok: true,
      added: imported.added,
      parsed,
      messagesScanned: Math.max(scrape.threadsOpened, scrape.subjects.length),
      total: imported.store.gifts.length,
      lastSyncedAt: imported.store.lastMailSyncedAt ?? null,
      store: imported.store,
    };

    const message =
      parsed === 0
        ? `Searched Gmail but could not parse game titles from ${result.messagesScanned} result(s).`
        : result.added > 0
          ? `Added ${result.added} · ${result.total} total`
          : `Up to date · ${result.total} gifts`;

    await writeStatus({
      phase: "done",
      message,
      added: result.added,
      parsed: result.parsed,
      messagesScanned: result.messagesScanned,
      total: result.total,
      lastSyncedAt: result.lastSyncedAt,
    });
    console.log(message);
    for (const g of preview.slice(0, 20)) {
      console.log(`  · ${g.title}${g.fromPersona ? ` (from ${g.fromPersona})` : ""}`);
    }
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : "Gmail sync failed";
    await writeStatus({
      phase: "error",
      error,
      message: error,
      total: before.gifts.length,
      lastSyncedAt: before.lastMailSyncedAt ?? null,
    });
    return {
      ok: false,
      added: 0,
      parsed: 0,
      messagesScanned: 0,
      total: before.gifts.length,
      lastSyncedAt: before.lastMailSyncedAt ?? null,
      store: before,
      error,
    };
  } finally {
    // Close only the isolated automation window we opened — never the user’s browser.
    try {
      await browser?.close();
    } catch {
      // ignore
    }
    await clearPid();
  }
}
