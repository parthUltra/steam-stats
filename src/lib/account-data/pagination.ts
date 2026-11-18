/**
 * Paginated Account Data pages.
 *
 * The licences list is server-paginated: "Showing licenses 1-100 of 453" and
 * an `a.license_paginator_next` link (`?continuationToken=…&offset=100`).
 * Pages are saved as licenses.html, licenses-2.html, licenses-3.html, … and
 * joined by `parseLicensePages`.
 *
 * Everything here is pure or takes its I/O as arguments, so the walk can be
 * tested on synthetic HTML without a browser.
 */
import {
  isLicensesPage,
  parseLicensePagination,
  parseLicenses,
} from "@/lib/account-data/parsers";

const LICENSE_PAGE_FILE = /^licenses(?:-(\d+))?\.html$/;

/** 1 → "licenses.html", 2 → "licenses-2.html", … */
export function licensePageFileName(page: number): string {
  return page <= 1 ? "licenses.html" : `licenses-${page}.html`;
}

/** Page number of a saved licence page file; null for any other file. */
export function licensePageNumber(fileName: string): number | null {
  const m = fileName.match(LICENSE_PAGE_FILE);
  return m ? Number(m[1] ?? 1) : null;
}

/** The licence page files among `files`, in page order (2 before 10). */
export function licensePageFiles(files: readonly string[]): string[] {
  return files
    .filter((f) => licensePageNumber(f) != null)
    .sort((a, b) => licensePageNumber(a)! - licensePageNumber(b)!);
}

/** Saved pages beyond the last one of this fetch — leftovers of an older, longer list. */
export function staleLicensePageFiles(
  files: readonly string[],
  pagesSaved: number,
): string[] {
  return licensePageFiles(files).filter(
    (f) => licensePageNumber(f)! > Math.max(pagesSaved, 1),
  );
}

/**
 * Absolute URL of the next page, or null when there is none or the link
 * leaves the page being walked (another host or path): a paginator is only
 * ever followed within its own list.
 */
export function resolveNextPageUrl(
  nextHref: string | null | undefined,
  currentUrl: string,
): string | null {
  if (!nextHref) return null;
  try {
    const current = new URL(currentUrl);
    // cheerio returns the attribute still entity-encoded in some inputs
    const next = new URL(nextHref.replace(/&amp;/g, "&"), current);
    const samePath =
      next.pathname.replace(/\/+$/, "") === current.pathname.replace(/\/+$/, "");
    if (next.origin !== current.origin || !samePath) return null;
    return next.toString();
  } catch {
    return null;
  }
}

export type LicenseWalkResult = {
  /** Licence pages seen, including the first; 0 when the first is not one. */
  pages: number;
  /** Table rows seen across those pages (fewer than records — see below). */
  rows: number;
  /** Licence records the pages' "from-to" ranges cover. */
  recordsCovered: number;
  /** Records in the list, as the paginator reports (0 without a paginator). */
  total: number;
  /** True only when a licences page with no Next link was reached. */
  complete: boolean;
  /** Why the walk stopped. */
  stopped:
    | "last-page"
    | "page-cap"
    | "repeated-page"
    | "not-a-licences-page"
    | "load-failed";
};

/** At 100 records per page this is 20,000 licences. */
export const LICENSE_PAGE_CAP = 200;

/**
 * Follow the licences paginator from the first page (already loaded by the
 * caller) until the Next link disappears.
 *
 * `load` fetches a URL and returns its HTML; `save` stores page N (N ≥ 2).
 * The walk is `complete` only when it reaches a licences page with no Next
 * link. It stops incomplete at the page cap, when a Next link repeats a URL
 * already visited, when a load throws, or on a page that is not a licences
 * page (login / error page — never saved; this includes the first page).
 *
 * A page with zero rows is still a page: Steam pages by licence record and
 * renders fewer rows than records, so a page can legitimately show none.
 */
export async function walkLicensePages(opts: {
  firstUrl: string;
  firstHtml: string;
  load: (url: string) => Promise<string>;
  save: (fileName: string, html: string, url: string) => Promise<void>;
  maxPages?: number;
  /** Pause before each further request. */
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<LicenseWalkResult> {
  const maxPages = opts.maxPages ?? LICENSE_PAGE_CAP;
  const delayMs = opts.delayMs ?? 1500;
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => undefined);

  let pages = 0;
  let rows = 0;
  let recordsCovered = 0;
  let total = 0;

  const done = (stopped: LicenseWalkResult["stopped"]): LicenseWalkResult => {
    const complete = stopped === "last-page";
    const of = total ? ` (records ${recordsCovered} of ${total})` : "";
    log(
      complete
        ? `licenses: ${pages} page(s), ${rows} rows${of} — complete`
        : `licenses: INCOMPLETE after ${pages} page(s), ${rows} rows${of} — ${stopped}`,
    );
    return { pages, rows, recordsCovered, total, complete, stopped };
  };

  /** Count a licences page; returns its pagination. */
  const take = (html: string) => {
    const pagination = parseLicensePagination(html);
    pages += 1;
    rows += parseLicenses(html).length;
    if (pagination?.total) {
      recordsCovered += Math.max(0, pagination.to - pagination.from + 1);
      total = pagination.total;
    }
    return pagination;
  };

  if (!isLicensesPage(opts.firstHtml)) return done("not-a-licences-page");
  let pagination = take(opts.firstHtml);
  let url = opts.firstUrl;
  const seen = new Set([url]);

  for (;;) {
    const next = resolveNextPageUrl(pagination?.nextHref, url);
    if (!next) return done("last-page");
    if (pages >= maxPages) return done("page-cap");
    if (seen.has(next)) return done("repeated-page");
    seen.add(next);

    await sleep(delayMs);
    let nextHtml: string;
    try {
      nextHtml = await opts.load(next);
    } catch {
      return done("load-failed");
    }
    if (!isLicensesPage(nextHtml)) return done("not-a-licences-page");

    pagination = take(nextHtml);
    await opts.save(licensePageFileName(pages), nextHtml, next);
    log(
      `licenses: page ${pages} saved (${rows} rows${total ? `, records ${recordsCovered} of ${total}` : ""} so far)`,
    );
    url = next;
  }
}

/**
 * Did the last fetch leave the licence walk unfinished? Read from the
 * fetcher's `_manifest.json`. After an interrupted walk the folder holds fresh
 * pages 1..k plus older later pages, which on their own parse as a whole
 * list — so the parse step must call the result partial.
 */
export function licenseWalkWasInterrupted(manifest: unknown): boolean {
  const results = (manifest as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return false;
  return results.some(
    (r: { id?: unknown; licensesComplete?: unknown; error?: unknown } | null) =>
      r?.id === "licenses" &&
      (r.licensesComplete === false || typeof r.error === "string"),
  );
}

/** What the purchase-history page looks like once its request has settled. */
export type HistoryProbe = {
  /**
   * False when the page was still loading after the wait (the spinner
   * `#wallet_history_loading` visible or an AJAX request active): the cursor
   * cannot be trusted — Steam's WalletHistory_LoadMore() sets
   * `g_historyCursor = null` before its request and restores it afterwards.
   */
  settled: boolean;
  /** `g_historyCursor != null`, read after the page settled. */
  cursorPresent: boolean;
};

/** Pure decision for one probe of the history page. */
export function historyNextStep(
  probe: HistoryProbe,
): "load-more" | "complete" | "incomplete" {
  if (!probe.settled) return "incomplete";
  return probe.cursorPresent ? "load-more" : "complete";
}

/**
 * Click "Load more" until the settled purchase history has no cursor left.
 * `probe` waits for the page to settle and reads the live cursor;
 * `clickLoadMore` clicks the button and resolves false when there is nothing
 * to click. Complete only when a settled page reports a null cursor — a
 * timeout, a missing button with rows remaining, or the click cap are all
 * incomplete.
 */
export async function loadWholePurchaseHistory(opts: {
  probe: () => Promise<HistoryProbe>;
  clickLoadMore: () => Promise<boolean>;
  maxClicks?: number;
  log?: (line: string) => void;
}): Promise<{ clicks: number; complete: boolean }> {
  const maxClicks = opts.maxClicks ?? 500;
  const log = opts.log ?? (() => undefined);
  let clicks = 0;
  const incomplete = (why: string) => {
    log(
      `purchase-history: INCOMPLETE — ${why} after ${clicks} "Load more" click(s)`,
    );
    return { clicks, complete: false };
  };
  for (;;) {
    const step = historyNextStep(await opts.probe());
    if (step === "incomplete") return incomplete("the page did not finish loading");
    if (step === "complete") break;
    if (clicks >= maxClicks) return incomplete("click cap reached");
    if (!(await opts.clickLoadMore())) {
      return incomplete("more rows remain but there is no button");
    }
    clicks += 1;
  }
  if (clicks) log(`purchase-history: loaded all rows (${clicks} "Load more" click(s))`);
  return { clicks, complete: true };
}

/**
 * The saved DOM of a fully loaded history still contains the page's original
 * `g_historyCursor = {…}` script text, which the parser reads as "more rows
 * to load". Once the live cursor is null, record that in the saved HTML.
 */
export function markPurchaseHistoryComplete(html: string): string {
  return html.replace(
    /(g_historyCursor\s*=\s*)[^;\n]+/,
    (_m, lead: string) => `${lead}null`,
  );
}
