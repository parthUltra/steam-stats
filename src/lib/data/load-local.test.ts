import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import {
  applyTransactionLineItems,
  parsePurchaseHistory,
  parseTransactionDetailHtml,
} from "@/lib/account-data";
import { hydratePlayedGames, loadLocalAccountData } from "./load-local";

const savedRoot = process.env.STEAM_STATS_ROOT;
let root: string;

const write = async (rel: string, content: unknown) => {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    typeof content === "string" ? content : JSON.stringify(content),
  );
};

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "load-local-test-"));
  process.env.STEAM_STATS_ROOT = root;
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
after(() => {
  if (savedRoot === undefined) delete process.env.STEAM_STATS_ROOT;
  else process.env.STEAM_STATS_ROOT = savedRoot;
});

const game = (over: Record<string, unknown>) => ({
  appId: 1,
  name: "Example Game",
  hoursForever: 1,
  hours2Weeks: null,
  lastPlayedText: null,
  lastPlayedAt: null,
  minutesForever: 60,
  ...over,
});

const LOGIN_PAGE = `<html><head><title>Steam Help</title>
  <link href="https://help.steampowered.com/en/login/?redir=%2Fen%2Faccountdata%2FAccountSpend&amp;need_password=1">
  </head><body><input type="password"></body></html>`;
const HISTORY_PAGE = `<table class="wallet_history_table"><tbody>
  <tr class="wallet_table_row"><td class="wht_date">3 Mar, 2026</td>
  <td class="wht_items"><div>Example Game</div></td>
  <td class="wht_type"><div>Purchase</div></td><td class="wht_total">₹ 100</td></tr>
  </tbody></table>`;

describe("loadLocalAccountData sourceStatus", () => {
  it("reports login-required, partial, ok and missing from parsed JSON", async () => {
    await write("samples/parsed/purchase-history.json", {
      kind: "purchase-history",
      status: "ok",
      rows: [],
    });
    await write("samples/parsed/licenses.json", {
      kind: "licenses",
      status: "partial",
      rows: [{ dateText: "3 Mar, 2026", item: "Example Game" }],
      pagination: { from: 1, to: 100, total: 453, nextHref: "?offset=100" },
    });
    await write("samples/parsed/account-spend.json", {
      kind: "unknown",
      status: "login-required",
      reason: "Steam Help login page (password required) — not Account Data",
    });
    const bundle = await loadLocalAccountData();
    assert.equal(bundle.source, "parsed-json");
    assert.deepEqual(bundle.accountSpend, []);
    assert.equal(bundle.sourceStatus?.accountSpend.status, "login-required");
    assert.deepEqual(bundle.sourceStatus?.licenses, {
      status: "partial",
      rows: 1,
      detail: "showing 1-100 of 453",
      coverage: { pagesSaved: 1, recordsCovered: 100, recordsTotal: 453 },
    });
    assert.deepEqual(bundle.sourceStatus?.purchases, { status: "ok", rows: 0 });
    assert.deepEqual(bundle.sourceStatus?.loginHistory, {
      status: "missing",
      rows: 0,
    });
  });

  it("understands parsed files written before the status field existed", async () => {
    await write("samples/parsed/purchase-history.json", {
      kind: "purchase-history",
      rows: [],
    });
    await write("samples/parsed/login-history.json", {
      kind: "unknown",
      reason: "Steam Help login page (password required) — not Account Data",
    });
    await write("samples/parsed/account-spend.json", {
      kind: "unknown",
      reason: "Unrecognized Account Data HTML shape",
    });
    const { sourceStatus } = await loadLocalAccountData();
    // Rows without a recorded status: we cannot say they are complete.
    assert.equal(sourceStatus?.purchases.status, "unknown");
    assert.match(sourceStatus?.purchases.detail ?? "", /npm run parse:account-data/);
    assert.equal(sourceStatus?.loginHistory.status, "login-required");
    assert.equal(sourceStatus?.accountSpend.status, "unrecognized");
  });

  it("keeps older rows but still says login-required after a failed re-fetch", async () => {
    await write("samples/parsed/purchase-history.json", {
      kind: "purchase-history",
      rows: [],
    });
    await write("samples/parsed/login-history.json", {
      kind: "login-history",
      status: "login-required",
      reason: "Steam Help login page (password required) — not Account Data",
      rows: [
        { loginTime: "a", logoffTime: "b", osType: "Windows", country: "XX", city: "c", state: "s" },
      ],
    });
    const bundle = await loadLocalAccountData();
    assert.equal(bundle.loginHistory.length, 1);
    assert.equal(bundle.sourceStatus?.loginHistory.status, "login-required");
    assert.equal(bundle.sourceStatus?.loginHistory.rows, 1);
  });

  it("reports the same from raw HTML, and tolerates absent pages", async () => {
    await write("samples/account-data/purchase-history.html", HISTORY_PAGE);
    await write("samples/account-data/account-spend.html", LOGIN_PAGE);
    const bundle = await loadLocalAccountData();
    assert.equal(bundle.source, "raw-html");
    assert.equal(bundle.purchases.length, 1);
    assert.equal(bundle.sourceStatus?.purchases.status, "ok");
    assert.equal(bundle.sourceStatus?.accountSpend.status, "login-required");
    assert.equal(bundle.sourceStatus?.licenses.status, "missing");
    assert.equal(bundle.sourceStatus?.loginHistory.status, "missing");
  });
});

describe("raw-HTML loader and transaction detail pages", () => {
  const history = `<table class="wallet_history_table"><tbody>
    <tr class="wallet_table_row" onclick="location.href='https://help.steampowered.com/en/wizard/HelpWithTransaction?transid=7001'">
      <td class="wht_date">3 Mar, 2026</td>
      <td class="wht_items"><div>Example Game A</div><div class="wht_item_refunded">Example Game B</div></td>
      <td class="wht_type"><div>Purchase</div></td><td class="wht_total">₹ 900</td></tr>
    <tr class="wallet_table_row" onclick="location.href='https://help.steampowered.com/en/wizard/HelpWithTransaction?transid=7002'">
      <td class="wht_date">4 Mar, 2026</td>
      <td class="wht_items"><div>Example Game C</div></td>
      <td class="wht_type"><div>Purchase</div></td><td class="wht_total">₹ 250</td></tr>
    </tbody></table>`;
  const detail = `<div class="purchase_line_items">
    <div><span class="purchase_detail_field">Example Game A</span><span class="refund_value">₹ 400</span></div>
    <div><span class="purchase_detail_field">Example Game B</span><span class="refund_value">₹ 500</span></div>
    </div>`;

  it("uses the real per-item prices instead of an equal split", async () => {
    await write("samples/account-data/purchase-history.html", history);
    await write("samples/account-data/transactions/7001.html", detail);
    // not a transaction page: ignored
    await write("samples/account-data/transactions/notes.txt", "x");
    const { purchases, source } = await loadLocalAccountData();
    assert.equal(source, "raw-html");
    assert.deepEqual(
      purchases[0].lineItems?.map((l) => [l.name, l.amount, l.refunded ?? false]),
      [
        ["Example Game A", 400, false],
        ["Example Game B", 500, true],
      ],
    );
    assert.deepEqual(purchases[0].items, ["Example Game A", "Example Game B"]);
    // no detail page for this one → untouched
    assert.deepEqual(purchases[1].lineItems, []);
  });

  it("gives the same purchases as the parsed-JSON loader", async () => {
    await write("samples/account-data/purchase-history.html", history);
    await write("samples/account-data/transactions/7001.html", detail);
    const viaHtml = await loadLocalAccountData();

    const rows = applyTransactionLineItems(parsePurchaseHistory(history), {
      "7001": parseTransactionDetailHtml(detail),
    });
    await write("samples/parsed/purchase-history.json", {
      kind: "purchase-history",
      status: "ok",
      rows,
    });
    const viaJson = await loadLocalAccountData();
    assert.equal(viaJson.source, "parsed-json");
    assert.deepEqual(viaHtml.purchases, viaJson.purchases);
  });

  it("works when there is no transactions directory", async () => {
    await write("samples/account-data/purchase-history.html", history);
    const { purchases } = await loadLocalAccountData();
    assert.deepEqual(purchases[0].lineItems, []);
  });
});

describe("played games", () => {
  it("passes through the snapshot source and fetch time", async () => {
    await write("samples/parsed/purchase-history.json", {
      kind: "purchase-history",
      rows: [],
    });
    await write("samples/parsed/games-played.json", {
      steamId: "76561190000000000",
      source: "steam-session-api",
      fetchedAt: "2025-12-05T10:00:00.000Z",
      games: [game({ lastPlayedText: "14 Jul" })],
    });
    const bundle = await loadLocalAccountData();
    assert.equal(bundle.playedSource, "steam-session-api");
    assert.equal(bundle.playedFetchedAt, "2025-12-05T10:00:00.000Z");
    // year from the snapshot (2025), whatever today's date is
    assert.equal(new Date(bundle.playedGames[0].lastPlayedAt!).getFullYear(), 2025);
  });

  it("resolves year-less labels against fetchedAt, not the wall clock", () => {
    const year = (fetchedAt: string | null, text: string) => {
      const [g] = hydratePlayedGames([game({ lastPlayedText: text })], fetchedAt);
      return g.lastPlayedAt == null ? null : new Date(g.lastPlayedAt).getFullYear();
    };
    assert.equal(year("2025-12-05T10:00:00.000Z", "14 Jul"), 2025);
    assert.equal(year("2025-12-05T10:00:00.000Z", "17 Dec"), 2024);
    assert.equal(year("2025-12-05T10:00:00.000Z", "29 Feb"), 2024);
    assert.equal(year("2025-12-05T10:00:00.000Z", "26 May 2023"), 2023);
    // no snapshot time → unknown, rather than a guess from today's date
    assert.equal(year(null, "14 Jul"), null);
    assert.equal(year(null, "26 May 2023"), 2023);
  });

  it("keeps an existing lastPlayedAt", () => {
    const [g] = hydratePlayedGames(
      [game({ lastPlayedText: "14 Jul", lastPlayedAt: 1700000000000 })],
      "2025-12-05T10:00:00.000Z",
    );
    assert.equal(g.lastPlayedAt, 1700000000000);
  });
});

describe("licence pages and fetch dates", () => {
  const licencePage = (rows: string[], from: number, total: number, next: string | null) =>
    `<table class="account_table"><tr><th>Date</th><th>Item</th><th>Acquisition Method</th></tr>` +
    rows
      .map((item) => `<tr><td>3 Mar, 2026</td><td>${item}</td><td>Steam Store</td></tr>`)
      .join("") +
    `</table><div class="license_paginator_ctn">Showing licenses ${from}-${from + rows.length - 1} of ${total}` +
    (next ? `<a class="license_paginator_next" href="${next}">Next</a>` : "") +
    `</div>`;

  it("the raw-HTML loader joins licenses.html, licenses-2.html, … in page order", async () => {
    await write("samples/account-data/purchase-history.html", HISTORY_PAGE);
    await write(
      "samples/account-data/licenses.html",
      licencePage(["One", "Two"], 1, 5, "?continuationToken=a&offset=2"),
    );
    await write(
      "samples/account-data/licenses-2.html",
      licencePage(["Three", "Four"], 3, 5, "?continuationToken=b&offset=4"),
    );
    await write("samples/account-data/licenses-3.html", licencePage(["Five"], 5, 5, null));
    // 10 sorts before 2 as text; it must still come last (and is ignored here: absent)
    const bundle = await loadLocalAccountData();
    assert.deepEqual(
      bundle.licenses.map((l) => l.item),
      ["One", "Two", "Three", "Four", "Five"],
    );
    assert.deepEqual(bundle.sourceStatus?.licenses, {
      status: "ok",
      rows: 5,
      coverage: { pagesSaved: 3, recordsCovered: 5, recordsTotal: 5 },
    });
  });

  it("a missing later page is reported as partial with shown / total", async () => {
    await write("samples/account-data/purchase-history.html", HISTORY_PAGE);
    await write(
      "samples/account-data/licenses.html",
      licencePage(["One", "Two"], 1, 5, "?continuationToken=a&offset=2"),
    );
    const { sourceStatus } = await loadLocalAccountData();
    assert.equal(sourceStatus?.licenses.status, "partial");
    assert.deepEqual(sourceStatus?.licenses.coverage, {
      pagesSaved: 1,
      recordsCovered: 2,
      recordsTotal: 5,
    });
  });

  it("fewer rows than records is not partial when the record ranges are all saved", async () => {
    await write("samples/account-data/purchase-history.html", HISTORY_PAGE);
    // 2 rows rendered for records 1-100 of 100
    await write(
      "samples/account-data/licenses.html",
      licencePage(["One", "Two"], 1, 100, null).replace("1-2 of 100", "1-100 of 100"),
    );
    const { sourceStatus } = await loadLocalAccountData();
    assert.deepEqual(sourceStatus?.licenses, {
      status: "ok",
      rows: 2,
      coverage: { pagesSaved: 1, recordsCovered: 100, recordsTotal: 100 },
    });
  });

  it("an interrupted licence walk is partial even when the saved pages look whole", async () => {
    await write("samples/account-data/purchase-history.html", HISTORY_PAGE);
    await write(
      "samples/account-data/licenses.html",
      licencePage(["One", "Two"], 1, 4, "?offset=2"),
    );
    // stale page from an older fetch: on its own the pair parses as complete
    await write("samples/account-data/licenses-2.html", licencePage(["Three", "Four"], 3, 4, null));
    assert.equal((await loadLocalAccountData()).sourceStatus?.licenses.status, "ok");

    await write("samples/account-data/_manifest.json", {
      results: [{ id: "licenses", licensesComplete: false }],
    });
    const { sourceStatus, licenses } = await loadLocalAccountData();
    assert.equal(sourceStatus?.licenses.status, "partial");
    assert.match(sourceStatus?.licenses.detail ?? "", /interrupted/);
    assert.equal(licenses.length, 4);
  });

  it("reports when the account-spend page was fetched", async () => {
    await write("samples/parsed/purchase-history.json", { kind: "purchase-history", rows: [] });
    assert.equal((await loadLocalAccountData()).accountSpendFetchedAt, null);
    await write("samples/account-data/account-spend.meta.json", {
      savedAt: "2026-10-01T08:00:00.000Z",
    });
    assert.equal(
      (await loadLocalAccountData()).accountSpendFetchedAt,
      "2026-10-01T08:00:00.000Z",
    );
  });

  it("anchors the games page's year-less labels to when it was saved", async () => {
    await write("samples/account-data/purchase-history.html", HISTORY_PAGE);
    await write(
      "samples/account-data/games-all.html",
      `<a href="https://store.steampowered.com/app/5" class="wfG8VGEsVTw-">Five</a>` +
        `<span>TOTAL PLAYED</span>3 hours<span>LAST PLAYED</span>14 Dec`,
    );
    await write("samples/account-data/games-all.meta.json", {
      savedAt: "2024-03-01T00:00:00.000Z",
    });
    const { playedGames } = await loadLocalAccountData();
    assert.equal(playedGames[0].lastPlayedAt, new Date(2023, 11, 14).getTime());
  });
});
