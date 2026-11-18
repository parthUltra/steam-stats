import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  detectAccountDataKind,
  isSteamHelpLoginHtml,
  parseAccountDataHtml,
  parseLicensePages,
  parseLicensePagination,
  parseLicenses,
  parseLoginHistory,
  parseMoney,
  parsePurchaseHistory,
  parseSteamDate,
  summarizePurchases,
} from "./parsers";

describe("isSteamHelpLoginHtml", () => {
  it("detects Steam Help password walls", () => {
    const html = `
      <title>Steam Help</title>
      <link href="https://help.steampowered.com/en/login/?redir=%2Fen%2Faccountdata%2FSteamLoginHistory&amp;need_password=1">
      <input type="password" />
    `;
    assert.equal(isSteamHelpLoginHtml(html), true);
    const parsed = parseAccountDataHtml(html, "login-history.html");
    assert.equal(parsed.kind, "unknown");
    assert.match(parsed.reason, /login page/i);
  });
});

describe("detectAccountDataKind", () => {
  it("reads login history without thead using the filename hint", () => {
    const html = `
      <table class="AccountDataTable">
        <tr>
          <th>Anmeldezeit</th><th>Abmeldezeit</th><th>OS</th>
          <th>Land</th><th>Stadt</th><th>Region</th>
        </tr>
        <tr>
          <td>1 Jan 2026</td><td>2 Jan 2026</td><td>Windows</td>
          <td>DE</td><td>Berlin</td><td>BE</td>
        </tr>
      </table>
    `;
    assert.equal(detectAccountDataKind(html, "login-history.html"), "login-history");
    const rows = parseLoginHistory(html);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.osType, "Windows");
  });

  it("does not treat a login wall as login-history even with a file hint", () => {
    const html = `
      <title>Steam Help</title>
      <link href="https://help.steampowered.com/login/?redir=%2Fen%2Faccountdata%2FAccountSpend&need_password=1">
    `;
    assert.equal(detectAccountDataKind(html, "account-spend.html"), "unknown");
  });
});

describe("parseMoney", () => {
  const cases: [string, number | null, string | null][] = [
    // Indian grouping
    ["₹1,499", 1499, "INR"],
    ["₹ 1,49,999.00", 149999, "INR"],
    ["₹ 2,176", 2176, "INR"],
    ["₹ 5 Credit", 5, "INR"],
    ["₹ 469.50", 469.5, "INR"],
    // dollar-suffixed currencies are not USD
    ["R$ 10,00", 10, "BRL"],
    ["R$ 1.234,56", 1234.56, "BRL"],
    ["A$ 14.50", 14.5, "AUD"],
    ["C$ 12.99", 12.99, "CAD"],
    ["CDN$ 12.99", 12.99, "CAD"],
    ["HK$ 108.00", 108, "HKD"],
    ["NZ$ 9.99", 9.99, "NZD"],
    ["S$ 21.00", 21, "SGD"],
    ["NT$ 398", 398, "TWD"],
    ["Mex$ 199.99", 199.99, "MXN"],
    ["ARS$ 1.250,00", 1250, "ARS"],
    ["CLP$ 12.500", 12500, "CLP"],
    ["COL$ 45.000", 45000, "COP"],
    ["$U 1.234", 1234, "UYU"],
    ["$9.99", 9.99, "USD"],
    ["$1,234.56", 1234.56, "USD"],
    ["$9.99 USD", 9.99, "USD"],
    ["US$ 9.99", 9.99, "USD"],
    // decimal comma vs thousands dot
    ["1.234 €", 1234, "EUR"],
    ["1.234,56 €", 1234.56, "EUR"],
    ["19,99€", 19.99, "EUR"],
    ["0,99€", 0.99, "EUR"],
    ["5,--€", 5, "EUR"],
    ["1,234.56", 1234.56, null],
    ["£0.79", 0.79, "GBP"],
    ["1 234,56 zł", 1234.56, "PLN"],
    ["12,99zł", 12.99, "PLN"],
    ["Rp 150.000", 150000, "IDR"],
    ["Rp 1 250 000", 1250000, "IDR"],
    ["CHF 1'234.50", 1234.5, "CHF"],
    ["249,00 TL", 249, "TRY"],
    ["₺249,00", 249, "TRY"],
    ["419 pуб.", 419, "RUB"],
    ["1 299 ₽", 1299, "RUB"],
    ["¥ 1,980", 1980, "JPY"],
    ["₩ 21,000", 21000, "KRW"],
    ["1.250 KWD", 1.25, "KWD"],
    ["0.999", 0.999, null],
    // negative and parenthesised
    ["-₹ 120.00", -120, "INR"],
    ["₹ -120.00", -120, "INR"],
    ["−$5.00", -5, "USD"],
    ["(₹ 120.00)", -120, "INR"],
    ["($5.00)", -5, "USD"],
    // free
    ["Free", 0, null],
    ["Free to Play", 0, null],
    // nothing to read
    ["N/A", null, null],
    ["₹", null, "INR"],
  ];
  for (const [raw, amount, currency] of cases) {
    it(`${JSON.stringify(raw)} → ${amount} ${currency}`, () => {
      const m = parseMoney(raw);
      assert.equal(m?.amount, amount);
      assert.equal(m?.currencyHint, currency);
    });
  }

  it("returns null for an empty cell and keeps the cleaned raw text", () => {
    assert.equal(parseMoney("    "), null);
    assert.equal(parseMoney("₹ 1,499 ")?.raw, "₹ 1,499");
  });
});

describe("parseSteamDate", () => {
  const ymd = (d: Date | null) =>
    d == null
      ? null
      : [d.getFullYear(), d.getMonth() + 1, d.getDate()].join("-");
  // snapshot fetched 5 Dec 2025
  const now = new Date(2025, 11, 5, 12);

  it("reads full dates in day-first and US order", () => {
    for (const text of [
      "11 Aug, 2026",
      "11 Aug 2026",
      "Aug 11, 2026",
      "August 11, 2026",
      "11 August 2026",
      "11. Aug. 2026",
      "2026-08-11",
    ]) {
      assert.equal(ymd(parseSteamDate(text)), "2026-8-11", text);
    }
    assert.equal(ymd(parseSteamDate("1 Jan 2024")), "2024-1-1");
    assert.equal(ymd(parseSteamDate("11 août 2026")), "2026-8-11");
  });

  it("infers the year of a year-less label from the snapshot time", () => {
    assert.equal(ymd(parseSteamDate("14 Jul", { now })), "2025-7-14");
    assert.equal(ymd(parseSteamDate("Jul 14", { now })), "2025-7-14");
    assert.equal(ymd(parseSteamDate("2 Dec", { now })), "2025-12-2");
    // later in the year than the snapshot → previous year
    assert.equal(ymd(parseSteamDate("17 Dec", { now })), "2024-12-17");
    // same label, snapshot taken a year later → a different year
    assert.equal(
      ymd(parseSteamDate("14 Jul", { now: new Date(2026, 10, 17) })),
      "2026-7-14",
    );
  });

  it("never falls back to the wall clock", () => {
    assert.equal(parseSteamDate("14 Jul"), null);
    assert.equal(parseSteamDate("Today"), null);
    assert.equal(parseSteamDate("Yesterday"), null);
  });

  it("resolves 29 Feb to the latest leap year before the snapshot", () => {
    assert.equal(ymd(parseSteamDate("29 Feb", { now })), "2024-2-29");
    assert.equal(
      ymd(parseSteamDate("29 Feb", { now: new Date(2024, 1, 29, 18) })),
      "2024-2-29",
    );
    assert.equal(ymd(parseSteamDate("Feb 29", { now })), "2024-2-29");
    assert.equal(parseSteamDate("29 Feb 2025"), null);
  });

  it("reads Today and Yesterday relative to the snapshot", () => {
    assert.equal(ymd(parseSteamDate("Today", { now })), "2025-12-5");
    assert.equal(ymd(parseSteamDate("yesterday", { now })), "2025-12-4");
    assert.equal(
      ymd(parseSteamDate("Yesterday", { now: "2026-01-01T12:00:00" })),
      "2025-12-31",
    );
  });

  it("rejects text that is not a date", () => {
    for (const text of ["", "31 Feb 2026", "soon", "12", "45 Aug 2026"]) {
      assert.equal(parseSteamDate(text, { now }), null, text);
    }
  });
});

describe("login-required pages", () => {
  const loginPage = (redir: string) => `
    <html><head><title>Steam Help</title>
    <link rel="canonical" href="https://help.steampowered.com/en/login/?redir=${redir}&amp;need_password=1">
    </head><body><form><input type="password" name="password"></form></body></html>`;

  it("reports login-required instead of an empty table", () => {
    for (const [file, redir] of [
      ["account-spend.html", "%2Fen%2Faccountdata%2FAccountSpend"],
      ["login-history.html", "%2Fen%2Faccountdata%2FSteamLoginHistory"],
    ]) {
      const parsed = parseAccountDataHtml(loginPage(redir), file);
      assert.equal(parsed.status, "login-required");
      assert.equal(parsed.kind, "unknown");
      assert.equal("rows" in parsed, false);
    }
  });

  it("marks real tables ok and unknown markup unrecognized", () => {
    const ok = parseAccountDataHtml(
      `<table class="AccountDataTable"><thead><tr><th>Type</th><th>Time Calculated</th><th>Amount</th><th>Currency</th></tr></thead>
       <tbody><tr><td>TotalSpend</td><td>2026-01-01</td><td>12.5</td><td>USD</td></tr></tbody></table>`,
      "account-spend.html",
    );
    assert.equal(ok.status, "ok");
    assert.equal(ok.kind, "account-spend");
    assert.equal(parseAccountDataHtml("<p>hello</p>").status, "unrecognized");
  });
});

describe("parseLicenses pagination", () => {
  const page = (paginator: string) => `
    <div class="license_paginator_ctn">${paginator}</div>
    <table class="account_table"><tbody>
      <tr><th class="license_date_col">Date</th><th>Item</th><th class="license_acquisition_col">Acquisition Method</th></tr>
      <tr><td class="license_date_col">3 Mar, 2026</td><td>Example Game</td><td class="license_acquisition_col">Steam Store</td></tr>
      <tr><td class="license_date_col">2 Mar, 2026</td><td>
        <div class="free_license_remove_link"><a href="javascript:RemoveFreeLicense( 12345, 'RXhhbXBsZQ==' );">Remove</a></div>
        Example Demo</td><td class="license_acquisition_col">Complimentary</td></tr>
    </tbody></table>`;

  it("flags a page that has a Next link as partial", () => {
    const html = page(
      `<span>Showing licenses 1-100 of 453</span>
       <a class="license_paginator_next" href="?continuationToken=111:222&amp;offset=100">Next</a>`,
    );
    assert.deepEqual(parseLicensePagination(html), {
      from: 1,
      to: 100,
      total: 453,
      nextHref: "?continuationToken=111:222&offset=100",
    });
    const parsed = parseAccountDataHtml(html, "licenses.html");
    assert.equal(parsed.kind, "licenses");
    assert.equal(parsed.status, "partial");
    assert.equal(parsed.kind === "licenses" && parsed.rows.length, 2);
    assert.equal(
      parsed.kind === "licenses" && parsed.pagination?.total,
      453,
    );
  });

  it("treats the last page, and a page with no paginator, as complete", () => {
    const last = page(
      `<a class="license_paginator_prev" href="?offset=300">Prev</a>
       <span>Showing licenses 401-453 of 453</span>`,
    );
    assert.equal(parseLicensePagination(last)?.nextHref, null);
    // The last page on its own covers records 401-453 only: no Next link, but
    // not the whole list either.
    assert.equal(parseAccountDataHtml(last, "licenses.html").status, "partial");
    const whole = page(`<span>Showing licenses 1-453 of 453</span>`);
    assert.equal(parseAccountDataHtml(whole, "licenses.html").status, "ok");
    assert.equal(parseLicensePagination(page("")), null);
    assert.equal(parseAccountDataHtml(page(""), "licenses.html").status, "ok");
  });

  it("joins pages in order and reports the result complete only with the last page", () => {
    const p1 = page(
      `<span>Showing licenses 1-2 of 4</span><a class="license_paginator_next" href="?offset=2">Next</a>`,
    );
    const p2 = page(`<span>Showing licenses 3-4 of 4</span>`);
    const joined = parseLicensePages([p1, p2]);
    assert.equal(joined.rows.length, 4);
    assert.equal(joined.status, "ok");
    assert.equal(parseLicensePages([p1]).status, "partial");
    assert.equal(joined.rows[1].packageId, "12345");
    assert.equal(joined.rows[1].item, "Example Demo");
  });
});

describe("parsePurchaseHistory refunds", () => {
  const row = (itemsTd: string, typeClass = "", totalClass = "") => `
    <table class="wallet_history_table"><tbody>
    <tr class="wallet_table_row" onclick="location.href='https://help.steampowered.com/en/wizard/HelpWithTransaction?transid=1000000000000000001'">
      <td class="wht_date">3 Mar, 2026</td>
      ${itemsTd}
      <td class="wht_type ${typeClass}"><div>Purchase</div><div class="wth_payment"><div>Visa **00</div></div></td>
      <td class="wht_base_price">₹ 1,000</td><td class="wht_tax"></td><td class="wht_shipping"></td>
      <td class="wht_total ${totalClass}">₹ 1,000</td>
      <td class="wht_wallet_change"></td><td class="wht_wallet_balance"></td>
    </tr></tbody></table>`;

  it("does not mark the whole purchase refunded when one item was", () => {
    const [r] = parsePurchaseHistory(
      row(
        `<td class="wht_items"><div>Example Game A</div><div class="wht_item_refunded">Example Game B</div></td>`,
      ),
    );
    assert.equal(r.refunded, false);
    assert.equal(r.partiallyRefunded, true);
    assert.deepEqual(r.refundedItems, ["Example Game B"]);
    assert.deepEqual(r.items, ["Example Game A", "Example Game B"]);
    assert.equal(r.total?.amount, 1000);
  });

  it("marks a fully refunded purchase, in either markup", () => {
    const [cell] = parsePurchaseHistory(
      row(
        `<td class="wht_items wht_item_refunded"><div>Example Game A</div></td>`,
        "wht_refunded",
        "wht_refunded",
      ),
    );
    assert.equal(cell.refunded, true);
    assert.equal(cell.partiallyRefunded, false);
    assert.deepEqual(cell.refundedItems, ["Example Game A"]);

    const [each] = parsePurchaseHistory(
      row(
        `<td class="wht_items"><div class="wht_item_refunded">Example Game A</div><div class="wht_item_refunded">Example Game B</div></td>`,
      ),
    );
    assert.equal(each.refunded, true);
    assert.equal(each.partiallyRefunded, false);
  });

  it("leaves an ordinary purchase untouched", () => {
    const [r] = parsePurchaseHistory(
      row(`<td class="wht_items"><div>Example Game A</div></td>`),
    );
    assert.equal(r.refunded, false);
    assert.equal(r.partiallyRefunded, false);
    assert.deepEqual(r.refundedItems, []);
  });

  it("flags a history page that still has a Load More cursor", () => {
    const html = row(`<td class="wht_items"><div>Example Game A</div></td>`);
    assert.equal(parseAccountDataHtml(html).status, "ok");
    const more = `${html}<script>var g_historyCursor = {"wallet_txnid":"1","timestamp_newest":1,"balance":"0","currency":24};</script>`;
    assert.equal(parseAccountDataHtml(more).status, "partial");
    const done = `${html}<script>var g_historyCursor = null;</script>`;
    assert.equal(parseAccountDataHtml(done).status, "ok");
  });
});

describe("summarizePurchases", () => {
  it("does not subtract refunds that were never counted as spend", () => {
    const base = {
      dateText: "3 Mar, 2026",
      type: "Purchase",
      paymentMethods: [],
      isGift: false,
      price: null,
      originalPrice: null,
      discountedPrice: null,
      discountPct: null,
      tax: null,
      shipping: null,
      walletChange: null,
      walletBalance: null,
      transactionId: null,
      isWalletBalanceChange: false,
    };
    const money = (amount: number) => ({ raw: `₹ ${amount}`, amount, currencyHint: "INR" });
    const stats = summarizePurchases([
      { ...base, items: ["Example Game A"], total: money(400), refunded: false },
      { ...base, items: ["Example Game B"], total: money(250), refunded: true },
    ]);
    assert.equal(stats.spent, 400);
    assert.equal(stats.refundedTotal, 250);
    assert.equal(stats.netSpent, 400);
  });
});

describe("HTML entities in titles", () => {
  const licences = (item: string) =>
    `<table class="account_table"><tr><th>Date</th><th>Item</th><th>Acquisition Method</th></tr>` +
    `<tr><td>3 Mar, 2026</td><td>${item}</td><td>Complimentary</td></tr></table>`;

  it("decodes entities Steam double-encoded, once, at parse time", () => {
    // In the page source the title is "…&amp;copy;…", i.e. the text "&copy;"
    const cases: [string, string][] = [
      ["Darkest Dungeon&amp;copy;: The Butcher's Circus", "Darkest Dungeon©: The Butcher's Circus"],
      ["Example&amp;trade; Game", "Example™ Game"],
      ["Example&amp;reg; Game", "Example® Game"],
      ["Example&amp;#8482; Game", "Example™ Game"],
      ["Example&amp;#x2122; Game", "Example™ Game"],
      ["Romeo &amp;amp; Juliet", "Romeo & Juliet"],
      // already-correct text is left alone
      ["Romeo &amp; Juliet", "Romeo & Juliet"],
      ["Darkest Dungeon©: The Musketeer", "Darkest Dungeon©: The Musketeer"],
      ["Q&amp;A; The Game", "Q&A; The Game"],
    ];
    for (const [source, expected] of cases) {
      assert.equal(parseLicenses(licences(source))[0].item, expected, source);
    }
  });
});
