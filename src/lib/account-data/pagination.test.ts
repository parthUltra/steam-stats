import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  historyNextStep,
  licensePageFileName,
  licensePageFiles,
  licenseWalkWasInterrupted,
  loadWholePurchaseHistory,
  markPurchaseHistoryComplete,
  resolveNextPageUrl,
  staleLicensePageFiles,
  walkLicensePages,
} from "./pagination";
import { parseAccountDataHtml, parseLicensePages } from "./parsers";

const BASE = "https://store.steampowered.com/account/licenses/";

/** A synthetic licences page: rows `from..to` of `total`, 2 per page. */
function page(from: number, to: number, total: number, nextHref: string | null) {
  let rows = "";
  for (let i = from; i <= to; i++) {
    rows += `<tr><td class="license_date_col">3 Mar, 2026</td><td>Game ${i}</td><td class="license_acquisition_col">Steam Store</td></tr>`;
  }
  return (
    `<html><body><table class="account_table"><tr><th>Date</th><th>Item</th><th>Acquisition Method</th></tr>${rows}</table>` +
    `<div class="license_paginator_ctn">Showing licenses ${from}-${to} of ${total}` +
    (nextHref ? ` <a class="license_paginator_next" href="${nextHref}">Next &gt;</a>` : "") +
    `</div></body></html>`
  );
}

/** A 5-licence list served 2 per page, keyed by absolute URL. */
const site: Record<string, string> = {
  [BASE]: page(1, 2, 5, "?continuationToken=AAA&amp;offset=2"),
  [`${BASE}?continuationToken=AAA&offset=2`]: page(3, 4, 5, "?continuationToken=BBB&amp;offset=4"),
  [`${BASE}?continuationToken=BBB&offset=4`]: page(5, 5, 5, null),
};

function walk(pages: Record<string, string>, extra: Partial<Parameters<typeof walkLicensePages>[0]> = {}) {
  const saved: Record<string, string> = {};
  const loaded: string[] = [];
  const slept: number[] = [];
  const log: string[] = [];
  return walkLicensePages({
    firstUrl: BASE,
    firstHtml: pages[BASE],
    load: async (url) => {
      loaded.push(url);
      if (!(url in pages)) throw new Error("404");
      return pages[url];
    },
    save: async (name, html) => {
      saved[name] = html;
    },
    sleep: async (ms) => {
      slept.push(ms);
    },
    log: (l) => log.push(l),
    ...extra,
  }).then((result) => ({ result, saved, loaded, slept, log }));
}

describe("licence page file names", () => {
  it("names page 1 licenses.html and later pages licenses-N.html", () => {
    assert.equal(licensePageFileName(1), "licenses.html");
    assert.equal(licensePageFileName(2), "licenses-2.html");
    assert.equal(licensePageFileName(12), "licenses-12.html");
  });

  it("orders saved pages numerically and ignores other files", () => {
    assert.deepEqual(
      licensePageFiles([
        "licenses-10.html",
        "licenses.meta.json",
        "licenses-2.html",
        "purchase-history.html",
        "licenses.html",
        "licenses-2.meta.json",
      ]),
      ["licenses.html", "licenses-2.html", "licenses-10.html"],
    );
  });

  it("finds pages left over from an older, longer list", () => {
    const files = ["licenses.html", "licenses-2.html", "licenses-3.html", "licenses-4.html"];
    assert.deepEqual(staleLicensePageFiles(files, 2), ["licenses-3.html", "licenses-4.html"]);
    assert.deepEqual(staleLicensePageFiles(files, 4), []);
    assert.deepEqual(staleLicensePageFiles(files, 1), [
      "licenses-2.html",
      "licenses-3.html",
      "licenses-4.html",
    ]);
  });
});

describe("resolveNextPageUrl", () => {
  it("resolves a relative, entity-encoded next link against the current page", () => {
    assert.equal(
      resolveNextPageUrl("?continuationToken=AAA&amp;offset=100", BASE),
      `${BASE}?continuationToken=AAA&offset=100`,
    );
    assert.equal(
      resolveNextPageUrl("/account/licenses?offset=100", `${BASE}?offset=0`),
      "https://store.steampowered.com/account/licenses?offset=100",
    );
  });

  it("returns null without a link, or for a link that leaves the list", () => {
    assert.equal(resolveNextPageUrl(null, BASE), null);
    assert.equal(resolveNextPageUrl("", BASE), null);
    assert.equal(resolveNextPageUrl("https://example.com/account/licenses/?offset=2", BASE), null);
    assert.equal(resolveNextPageUrl("/account/history/?offset=2", BASE), null);
    assert.equal(resolveNextPageUrl("javascript:void(0)", BASE), null);
  });
});

describe("walkLicensePages", () => {
  it("follows Next until it disappears and saves each further page", async () => {
    const { result, saved, loaded, slept, log } = await walk(site);
    assert.deepEqual(result, {
      pages: 3,
      rows: 5,
      recordsCovered: 5,
      total: 5,
      complete: true,
      stopped: "last-page",
    });
    assert.deepEqual(Object.keys(saved), ["licenses-2.html", "licenses-3.html"]);
    assert.deepEqual(loaded, [
      `${BASE}?continuationToken=AAA&offset=2`,
      `${BASE}?continuationToken=BBB&offset=4`,
    ]);
    // one polite pause per extra request
    assert.deepEqual(slept, [1500, 1500]);
    assert.match(log.at(-1)!, /3 page\(s\), 5 rows \(records 5 of 5\) — complete/);

    // What was saved is what the parser joins into the full list
    const joined = parseLicensePages([site[BASE], saved["licenses-2.html"], saved["licenses-3.html"]]);
    assert.equal(joined.status, "ok");
    assert.deepEqual(
      joined.rows.map((r) => r.item),
      ["Game 1", "Game 2", "Game 3", "Game 4", "Game 5"],
    );
  });

  it("a single unpaginated page needs no request", async () => {
    const { result, loaded, saved } = await walk({ [BASE]: page(1, 2, 2, null) });
    assert.deepEqual(result, {
      pages: 1,
      rows: 2,
      recordsCovered: 2,
      total: 2,
      complete: true,
      stopped: "last-page",
    });
    assert.deepEqual(loaded, []);
    assert.deepEqual(saved, {});
  });

  it("stops at the page cap and says the list is incomplete", async () => {
    const { result, saved, log } = await walk(site, { maxPages: 2 });
    assert.deepEqual(result, {
      pages: 2,
      rows: 4,
      recordsCovered: 4,
      total: 5,
      complete: false,
      stopped: "page-cap",
    });
    assert.deepEqual(Object.keys(saved), ["licenses-2.html"]);
    assert.match(log.at(-1)!, /INCOMPLETE after 2 page\(s\), 4 rows \(records 4 of 5\) — page-cap/);
  });

  it("stops when a Next link points back at a page already visited", async () => {
    const loop = {
      [BASE]: page(1, 2, 5, "?offset=2"),
      [`${BASE}?offset=2`]: page(3, 4, 5, "?offset=2"),
    };
    const { result, loaded } = await walk(loop);
    assert.equal(result.stopped, "repeated-page");
    assert.equal(result.complete, false);
    assert.equal(result.pages, 2);
    assert.equal(loaded.length, 1);
  });

  it("does not save a page that is not a licences page (login / error page)", async () => {
    const broken = {
      [BASE]: page(1, 2, 5, "?offset=2"),
      [`${BASE}?offset=2`]: "<html><body><form><input type=password></form></body></html>",
    };
    const { result, saved } = await walk(broken);
    assert.deepEqual(result, {
      pages: 1,
      rows: 2,
      recordsCovered: 2,
      total: 5,
      complete: false,
      stopped: "not-a-licences-page",
    });
    assert.deepEqual(saved, {});
  });

  it("keeps going through a page that renders no rows: Steam pages by record, not by row", async () => {
    // Records 1-100 of 250 render 37 rows; records 101-200 render none; 201-250 render 3.
    const emptyMiddle =
      `<html><body><table class="account_table"><tr><th>Date</th><th>Item</th><th>Acquisition Method</th></tr></table>` +
      `<div class="license_paginator_ctn">Showing licenses 101-200 of 250 <a class="license_paginator_next" href="?offset=200">Next</a></div></body></html>`;
    const pages = {
      [BASE]: page(1, 37, 250, "?offset=100").replace("1-37 of 250", "1-100 of 250"),
      [`${BASE}?offset=100`]: emptyMiddle,
      [`${BASE}?offset=200`]: page(201, 203, 250, null).replace("201-203 of 250", "201-250 of 250"),
    };
    const { result, saved } = await walk(pages);
    assert.deepEqual(result, {
      pages: 3,
      rows: 40,
      recordsCovered: 250,
      total: 250,
      complete: true,
      stopped: "last-page",
    });
    assert.deepEqual(Object.keys(saved), ["licenses-2.html", "licenses-3.html"]);
    const joined = parseLicensePages([pages[BASE], saved["licenses-2.html"], saved["licenses-3.html"]]);
    assert.equal(joined.status, "ok");
    assert.equal(joined.rows.length, 40);
    assert.deepEqual(joined.coverage, { pagesSaved: 3, recordsCovered: 250, recordsTotal: 250 });
  });

  it("a first page that is not a licences page is never a complete walk", async () => {
    const login = "<html><body><form><input type=password></form></body></html>";
    const { result, loaded, saved } = await walk({ [BASE]: login });
    assert.deepEqual(result, {
      pages: 0,
      rows: 0,
      recordsCovered: 0,
      total: 0,
      complete: false,
      stopped: "not-a-licences-page",
    });
    assert.deepEqual(loaded, []);
    assert.deepEqual(saved, {});
  });

  it("reports a failed load instead of throwing away the pages already saved", async () => {
    const { result, saved } = await walk({
      [BASE]: site[BASE],
      [`${BASE}?continuationToken=AAA&offset=2`]: site[`${BASE}?continuationToken=AAA&offset=2`],
    });
    assert.deepEqual(result, {
      pages: 2,
      rows: 4,
      recordsCovered: 4,
      total: 5,
      complete: false,
      stopped: "load-failed",
    });
    assert.deepEqual(Object.keys(saved), ["licenses-2.html"]);
  });
});

describe("parseLicensePages coverage", () => {
  it("is partial when the saved pages cover fewer records than the list has", () => {
    const first = page(1, 37, 453, "?offset=100").replace("1-37 of 453", "1-100 of 453");
    const out = parseLicensePages([first]);
    assert.equal(out.status, "partial");
    assert.equal(out.rows.length, 37);
    assert.deepEqual(out.coverage, { pagesSaved: 1, recordsCovered: 100, recordsTotal: 453 });
  });

  it("rows rendered < records is not partial when every record range is covered", () => {
    // one page, 37 rows rendered for records 1-100 of 100
    const only = page(1, 37, 100, null).replace("1-37 of 100", "1-100 of 100");
    const out = parseLicensePages([only]);
    assert.equal(out.status, "ok");
    assert.deepEqual(out.coverage, { pagesSaved: 1, recordsCovered: 100, recordsTotal: 100 });
  });

  it("an unpaginated page has no coverage numbers and is ok", () => {
    const plain = page(1, 2, 2, null).replace(/<div class="license_paginator_ctn">.*?<\/div>/, "");
    const out = parseLicensePages([plain]);
    assert.equal(out.status, "ok");
    assert.equal(out.coverage, undefined);
  });
});

describe("licenseWalkWasInterrupted (fetch manifest)", () => {
  it("is true only when the last fetch recorded an incomplete licence walk", () => {
    const manifest = (licenses: Record<string, unknown>) => ({
      fetchedAt: "2026-11-18T00:00:00.000Z",
      results: [{ id: "account" }, { id: "licenses", ...licenses }],
    });
    assert.equal(licenseWalkWasInterrupted(manifest({ licensesComplete: false })), true);
    assert.equal(licenseWalkWasInterrupted(manifest({ licensesComplete: true })), false);
    // the licences fetch threw before it could say
    assert.equal(licenseWalkWasInterrupted(manifest({ error: "Timeout 90000ms" })), true);
    // older manifests / other shapes say nothing
    assert.equal(licenseWalkWasInterrupted(manifest({})), false);
    assert.equal(licenseWalkWasInterrupted(null), false);
    assert.equal(licenseWalkWasInterrupted({ results: "x" }), false);
  });
});

describe("purchase history: Load more", () => {
  it("decides from the settled page state", () => {
    // request in flight and it never settled within the wait → not complete
    assert.equal(historyNextStep({ settled: false, cursorPresent: false }), "incomplete");
    assert.equal(historyNextStep({ settled: false, cursorPresent: true }), "incomplete");
    // settled with a cursor → more rows behind the button
    assert.equal(historyNextStep({ settled: true, cursorPresent: true }), "load-more");
    // settled with a null cursor → everything is loaded
    assert.equal(historyNextStep({ settled: true, cursorPresent: false }), "complete");
  });

  /** A fake page: `responses` are the cursor states after each click settles. */
  function fakePage(afterClick: ("cursor" | "null" | "timeout")[]) {
    let state: "cursor" | "null" | "timeout" = "cursor";
    let clicks = 0;
    return {
      probe: async () => ({
        settled: state !== "timeout",
        // Steam nulls the cursor while the request is in flight
        cursorPresent: state === "cursor",
      }),
      clickLoadMore: async () => {
        state = afterClick[clicks++] ?? "null";
        return true;
      },
    };
  }

  it("clicks until the settled cursor is null", async () => {
    const log: string[] = [];
    const out = await loadWholePurchaseHistory({
      ...fakePage(["cursor", "cursor", "null"]),
      log: (l) => log.push(l),
    });
    assert.deepEqual(out, { clicks: 3, complete: true });
    assert.match(log[0], /loaded all rows \(3 "Load more" click\(s\)\)/);
  });

  it("a response that never settles is incomplete, not complete", async () => {
    const log: string[] = [];
    const out = await loadWholePurchaseHistory({
      ...fakePage(["cursor", "timeout"]),
      log: (l) => log.push(l),
    });
    assert.deepEqual(out, { clicks: 2, complete: false });
    assert.match(log[0], /INCOMPLETE/);
  });

  it("reports incomplete when the button is gone but rows remain, or at the cap", async () => {
    const stuck = await loadWholePurchaseHistory({
      probe: async () => ({ settled: true, cursorPresent: true }),
      clickLoadMore: async () => false,
    });
    assert.deepEqual(stuck, { clicks: 0, complete: false });
    const capped = await loadWholePurchaseHistory({
      probe: async () => ({ settled: true, cursorPresent: true }),
      clickLoadMore: async () => true,
      maxClicks: 4,
    });
    assert.deepEqual(capped, { clicks: 4, complete: false });
  });

  it("a short history needs no click", async () => {
    const out = await loadWholePurchaseHistory({
      probe: async () => ({ settled: true, cursorPresent: false }),
      clickLoadMore: async () => {
        throw new Error("must not click");
      },
    });
    assert.deepEqual(out, { clicks: 0, complete: true });
  });

  it("records the finished cursor so the saved page parses as complete", () => {
    const history =
      `<table class="wallet_history_table"><tbody><tr class="wallet_table_row"><td class="wht_date">3 Mar, 2026</td>` +
      `<td class="wht_items"><div>Example Game</div></td><td class="wht_type"><div>Purchase</div></td>` +
      `<td class="wht_total">₹ 100</td></tr></tbody></table>` +
      `<script>var g_historyCursor = {"wallet_txnid":"1","timestamp_newest":1};</script>`;
    assert.equal(parseAccountDataHtml(history, "purchase-history.html").status, "partial");
    const marked = markPurchaseHistoryComplete(history);
    assert.match(marked, /g_historyCursor = null;/);
    assert.equal(parseAccountDataHtml(marked, "purchase-history.html").status, "ok");
    // a page without the script is left alone
    assert.equal(markPurchaseHistoryComplete("<p>x</p>"), "<p>x</p>");
  });
});
