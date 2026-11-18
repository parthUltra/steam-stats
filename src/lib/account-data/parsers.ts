import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { parseSteamDate } from "@/lib/dates";

// The date parser has no HTML dependency; it lives in src/lib/dates.ts so
// client-reachable modules can use it without pulling cheerio.
export { parseSteamDate };

export type Money = {
  raw: string;
  amount: number | null;
  currencyHint: string | null;
};

export type PurchaseLineItem = {
  name: string;
  amount: number | null;
  currencyHint: string | null;
  raw: string;
  /**
   * This item was refunded while the rest of the purchase was kept (set when
   * line items are attached to a partially refunded row). `amount` is then
   * the refunded amount of that purchase.
   */
  refunded?: boolean;
};

export type PurchaseHistoryRow = {
  dateText: string;
  items: string[];
  /** Per-game amounts from Steam transaction detail (preferred over equal split) */
  lineItems?: PurchaseLineItem[];
  type: string;
  paymentMethods: string[];
  /** True when this purchase was a gift sent to someone else */
  isGift: boolean;
  /** Steam persona the gift was sent to (from “Gift sent to …”) */
  giftRecipient?: string | null;
  price: Money | null;
  originalPrice: Money | null;
  discountedPrice: Money | null;
  discountPct: number | null;
  tax: Money | null;
  shipping: Money | null;
  total: Money | null;
  walletChange: Money | null;
  walletBalance: Money | null;
  transactionId: string | null;
  /** True only when the whole purchase was refunded (every item). */
  refunded: boolean;
  /**
   * Some items were refunded and some kept. `refunded` stays false; the kept
   * items are still owned and `total` is still the full original charge.
   */
  partiallyRefunded?: boolean;
  /** Names of the refunded items (all of `items` when `refunded`). */
  refundedItems?: string[];
  isWalletBalanceChange: boolean;
};

export type LicenseRow = {
  dateText: string;
  item: string;
  acquisitionMethod: string;
  packageId: string | null;
  removableComplimentary: boolean;
};

export type AccountSpendRow = {
  type: string;
  timeCalculated: string;
  amount: number;
  currency: string;
};

export type RemotePlaySession = {
  gameOrApp: string;
  sessionStarted: string;
  sessionEnded: string;
  deviceType: string;
};

export type LoginHistoryRow = {
  loginTime: string;
  logoffTime: string;
  osType: string;
  country: string;
  city: string;
  state: string;
};

export type MachineAuthName = {
  userSuppliedName: string;
  systemSuppliedName: string;
};

/** "Showing licenses 1-100 of 453" + the Next link of a paginated page. */
export type SourcePagination = {
  from: number;
  to: number;
  total: number;
  /** href of the Next link; null on the last page */
  nextHref: string | null;
};

/**
 * - `ok`              parsed, and the page was the whole data set
 * - `partial`         parsed, but the page says more rows exist (pagination)
 * - `login-required`  a Steam Help login page was saved in place of the data
 * - `unrecognized`    not a page this parser knows
 */
export type SourceParseStatus =
  | "ok"
  | "partial"
  | "login-required"
  | "unrecognized";

type Parsed = { status: "ok" | "partial" };

export type AccountDataParseResult =
  | ({ kind: "purchase-history"; rows: PurchaseHistoryRow[] } & Parsed)
  | ({
      kind: "licenses";
      rows: LicenseRow[];
      /** The last saved page's range and Next link. */
      pagination?: SourcePagination;
      coverage?: LicenseCoverage;
      /** Why the status is `partial`, when the pages alone do not show it. */
      reason?: string;
    } & Parsed)
  | ({ kind: "account-spend"; rows: AccountSpendRow[] } & Parsed)
  | ({ kind: "remote-play-sessions"; rows: RemotePlaySession[] } & Parsed)
  | ({ kind: "login-history"; rows: LoginHistoryRow[] } & Parsed)
  | ({ kind: "machine-auth-names"; rows: MachineAuthName[] } & Parsed)
  | {
      kind: "unknown";
      status: "login-required" | "unrecognized";
      reason: string;
    };

/**
 * Currency markers, most specific first: "R$" / "A$" / "HK$" must be tried
 * before the bare "$", which alone means USD.
 */
const CURRENCY_MARKERS: [RegExp, string][] = [
  [/ARS\$/, "ARS"],
  [/CLP\$/, "CLP"],
  [/COL\$/, "COP"],
  [/CDN\$/, "CAD"],
  [/Mex\$/i, "MXN"],
  [/US\$/, "USD"],
  [/NZ\$/, "NZD"],
  [/HK\$/, "HKD"],
  [/NT\$/, "TWD"],
  [/R\$/, "BRL"],
  [/A\$/, "AUD"],
  [/C\$/, "CAD"],
  [/S\$/, "SGD"],
  [/\$U/, "UYU"],
  [/S\/\.?/, "PEN"],
  [/₹/, "INR"],
  [/€/, "EUR"],
  [/£/, "GBP"],
  [/¥/, "JPY"],
  [/₩/, "KRW"],
  [/₽|[pр]уб/i, "RUB"],
  [/₺|(?<![A-Za-z])TL(?![A-Za-z])/, "TRY"],
  [/zł/i, "PLN"],
  [/(?<![A-Za-z])Rp(?![A-Za-z])/, "IDR"],
  [/(?<![A-Za-z])RM(?![A-Za-z])/, "MYR"],
  [/₫/, "VND"],
  [/₴/, "UAH"],
  [/₸/, "KZT"],
  [/฿/, "THB"],
  [/₱/, "PHP"],
  [/₪/, "ILS"],
  [/\$/, "USD"],
];

/** ISO 4217 codes Steam prices in; a random capitalised word is not a currency. */
const ISO_CURRENCIES = new Set(
  (
    "USD EUR GBP INR JPY KRW RUB BRL AUD CAD NZD HKD SGD TWD MXN ARS CLP COP " +
    "UYU PEN PLN TRY IDR MYR VND UAH KZT THB PHP ILS CHF CNY NOK SEK DKK CZK " +
    "HUF RON ZAR AED SAR QAR KWD CRC"
  ).split(" "),
);

/** Currencies written with three decimals: "1.250 KWD" is 1.25, not 1250. */
const THREE_DECIMAL_CURRENCIES = new Set(["KWD", "BHD", "OMR", "JOD", "TND"]);

function detectCurrency(raw: string): string | null {
  // An explicit ISO code is the least ambiguous marker.
  for (const m of raw.matchAll(/(?<![A-Za-z$])([A-Z]{3})(?![A-Za-z$])/g)) {
    if (ISO_CURRENCIES.has(m[1])) return m[1];
  }
  for (const [re, code] of CURRENCY_MARKERS) {
    if (re.test(raw)) return code;
  }
  return null;
}

/** "1,49,999.00" / "1.234,56" / "1 234,56" / "12.500" → a JS number. */
function parseLocalizedNumber(token: string, currency: string | null): number {
  let n = token.replace(/[\s '’]/g, "");
  const hasComma = n.includes(",");
  const hasDot = n.includes(".");

  if (hasComma && hasDot) {
    // Whichever comes last is the decimal mark.
    n =
      n.lastIndexOf(",") > n.lastIndexOf(".")
        ? n.replace(/\./g, "").replace(",", ".")
        : n.replace(/,/g, "");
  } else if (hasComma) {
    const parts = n.split(",");
    // "19,99" is a decimal comma; "1,499" and "1,49,999" are grouping.
    n =
      parts.length === 2 && parts[1].length <= 2
        ? `${parts[0]}.${parts[1]}`
        : n.replace(/,/g, "");
  } else if (hasDot) {
    const parts = n.split(".");
    const grouped =
      parts.length > 2 ||
      (parts[1].length === 3 &&
        parts[0] !== "0" &&
        parts[0].length <= 3 &&
        !(currency && THREE_DECIMAL_CURRENCIES.has(currency)));
    // "1.234 €" / "12.500" / "150.000" are thousands; "9.99" is a decimal.
    if (grouped) n = n.replace(/\./g, "");
  }
  return Number(n);
}

/**
 * Parse a Steam price cell. `currencyHint` is the currency actually found in
 * the text (null if none) — never a guess. Handles Indian grouping, decimal
 * commas, space / apostrophe grouping, "5,--€", negatives ("-₹ 5", "(₹ 5)")
 * and "Free" (0).
 */
export function parseMoney(rawInput: string): Money | null {
  const raw = rawInput.replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  const currencyHint = detectCurrency(raw);
  if (/^free\b/i.test(raw)) return { raw, amount: 0, currencyHint };

  // "5,--" / "5.-" are whole amounts
  const text = raw.replace(/[.,]-{1,2}(?!\d)/g, "");
  const token = text.match(
    /\d{1,3}(?:[ '’]\d{3})+(?:[.,]\d+)?|\d[\d.,]*\d|\d/,
  )?.[0];
  if (!token) return { raw, amount: null, currencyHint };

  const before = text.slice(0, text.indexOf(token));
  const negative =
    /^\(.*\)$/.test(raw) || /[-−]\s*[^\d\s-]{0,4}\s*$/.test(before);

  const value = parseLocalizedNumber(token, currencyHint);
  if (!Number.isFinite(value)) return { raw, amount: null, currencyHint };
  return { raw, amount: negative && value !== 0 ? -value : value, currencyHint };
}

/** A character reference: `&copy;`, `&#8482;`, `&#x2122;`. */
const ENTITY = /&(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,30});/i;

/**
 * Decode character references left in already-extracted text. Steam
 * double-encodes some titles ("Darkest Dungeon&amp;copy;: …"), so the DOM
 * text still reads "&copy;". Decoded once here, at parse time; a <textarea>
 * is RCDATA, so references are resolved and nothing is parsed as markup.
 */
function decodeEntities(value: string): string {
  if (!ENTITY.test(value)) return value;
  return cheerio
    .load(`<textarea>${value.replace(/</g, "&lt;")}</textarea>`)("textarea")
    .text();
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/\u00a0/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText($: cheerio.CheerioAPI, el: AnyNode | null): string {
  if (!el) return "";
  return cleanText($(el).text());
}

export function isSteamHelpLoginHtml(html: string): boolean {
  const $ = cheerio.load(html);
  if ($("table.AccountDataTable, table.wallet_history_table, table.account_table").length) {
    return false;
  }
  return (
    /need_password=1/i.test(html) ||
    /help\.steampowered\.com\/[^"' ]*\/login\/\?redir=/i.test(html) ||
    ($("input[type='password']").length > 0 && /steam help/i.test($("title").text()))
  );
}

const KIND_BY_FILE: Record<string, Exclude<AccountDataParseResult["kind"], "unknown">> = {
  "purchase-history.html": "purchase-history",
  "licenses.html": "licenses",
  "account-spend.html": "account-spend",
  "login-history.html": "login-history",
  "machine-auth-names.html": "machine-auth-names",
  "remote-play-sessions.html": "remote-play-sessions",
};

function accountDataTable($: cheerio.CheerioAPI) {
  return $("table.AccountDataTable, table.accountdatatable").first();
}

function tableHeaderBlob(
  $: cheerio.CheerioAPI,
  $table: ReturnType<cheerio.CheerioAPI>,
): string {
  const thead = $table
    .find("thead th")
    .map((_, el) => cleanText($(el).text()))
    .get();
  if (thead.length) return thead.join("|").toLowerCase();
  return $table
    .find("tr")
    .first()
    .find("th,td")
    .map((_, el) => cleanText($(el).text()))
    .get()
    .join("|")
    .toLowerCase();
}

export function parsePurchaseHistory(html: string): PurchaseHistoryRow[] {
  const $ = cheerio.load(html);
  const rows: PurchaseHistoryRow[] = [];

  $("table.wallet_history_table tr.wallet_table_row").each((_, tr) => {
    const $tr = $(tr);
    const onclick = $tr.attr("onclick") ?? "";
    const transMatch = onclick.match(/transid=(\d+)/);
    const REFUNDED_ITEM = "wht_item_refunded";
    const $itemsCell = $tr.find("td.wht_items");
    const itemEntries = $itemsCell
      .find("div")
      .map((__, el) => ({
        name: cleanText($(el).text()),
        refunded: $(el).hasClass(REFUNDED_ITEM),
      }))
      .get()
      .filter((e) => e.name && !/^gift sent to\b/i.test(e.name));
    const items = itemEntries.map((e) => e.name);

    // Steam marks a full refund on the cells (items / type / total) and a
    // partial one on the individual item lines. Only the first is a refund of
    // the purchase; with the second the other items are still owned and paid.
    const refundedLines = itemEntries.filter((e) => e.refunded);
    const partiallyRefunded =
      refundedLines.length > 0 && refundedLines.length < itemEntries.length;
    const refunded =
      !partiallyRefunded &&
      (refundedLines.length > 0 ||
        $itemsCell.hasClass(REFUNDED_ITEM) ||
        $tr.find(".wht_refunded").length > 0);

    const typeCell = cleanText($tr.find("td.wht_type").text());
    const itemsHtml = $tr.find("td.wht_items").html() ?? "";
    const itemsText = cleanText($tr.find("td.wht_items").text());
    const recipientFromHtml = itemsHtml.match(
      /Gift\s+sent\s+to\s*<a[^>]*>([^<]+)<\/a>/i,
    )?.[1];
    const recipientFromText = itemsText.match(
      /Gift\s+sent\s+to\s+(.+)$/i,
    )?.[1];
    const giftRecipient = cleanText(
      recipientFromHtml || recipientFromText || "",
    ) || null;

    const isGift =
      Boolean(giftRecipient) ||
      /gift sent to/i.test(typeCell) ||
      /gift purchase/i.test(typeCell) ||
      $tr.find('img[src*="icon_gift"]').length > 0 ||
      items.some((i) => /gift sent to/i.test(i));

    const type = cleanText(
      $tr.find("td.wht_type > div").not(".wth_payment").first().text(),
    );

    const paymentBlocks = $tr
      .find("td.wht_type .wth_payment")
      .find("div")
      .map((__, el) => cleanText($(el).text()))
      .get()
      .filter(Boolean);
    const paymentFallback = cleanText($tr.find("td.wht_type .wth_payment").text());

    const discountPctText = cleanText($tr.find(".wht_discount_pct").text());
    const discountPct = discountPctText
      ? Number(discountPctText.replace(/[^\d.-]/g, ""))
      : null;

    const originalPrice = parseMoney(cleanText($tr.find(".wht_original_price").text()));
    const discountedPrice = parseMoney(
      cleanText($tr.find(".wht_discounted_price").text()),
    );
    const $base = $tr.find("td.wht_base_price");
    const hasDiscountBlock = $base.find(".wht_base_price_discounted").length > 0;
    const plainBasePrice = hasDiscountBlock
      ? null
      : parseMoney(cellText($, $base.get(0) ?? null));

    rows.push({
      dateText: cellText($, $tr.find("td.wht_date").get(0) ?? null),
      items: items.length ? items : [cleanText($tr.find("td.wht_items").text())].filter(Boolean),
      lineItems: [],
      type: type || "Unknown",
      isGift,
      giftRecipient,
      paymentMethods: paymentBlocks.length
        ? paymentBlocks
        : paymentFallback
          ? [paymentFallback]
          : [],
      price: discountedPrice ?? plainBasePrice,
      originalPrice,
      discountedPrice,
      discountPct: Number.isFinite(discountPct) ? discountPct : null,
      tax: parseMoney(cellText($, $tr.find("td.wht_tax").get(0) ?? null)),
      shipping: parseMoney(cellText($, $tr.find("td.wht_shipping").get(0) ?? null)),
      total: parseMoney(cellText($, $tr.find("td.wht_total").get(0) ?? null)),
      walletChange: parseMoney(cellText($, $tr.find("td.wht_wallet_change").get(0) ?? null)),
      walletBalance: parseMoney(cellText($, $tr.find("td.wht_wallet_balance").get(0) ?? null)),
      transactionId: transMatch?.[1] ?? null,
      refunded,
      partiallyRefunded,
      refundedItems: refunded
        ? items
        : refundedLines.map((e) => e.name),
      isWalletBalanceChange: $tr.hasClass("wallet_table_row_amt_change"),
    });
  });

  return rows;
}

/** Parse Steam HelpWithTransaction page for per-item paid amounts. */
export function parseTransactionDetailHtml(html: string): PurchaseLineItem[] {
  const $ = cheerio.load(html);
  const items: PurchaseLineItem[] = [];

  $(".purchase_line_items > div").each((_, el) => {
    const name = cleanText($(el).find(".purchase_detail_field").first().text());
    const raw = cleanText($(el).find(".refund_value").first().text());
    if (!name) return;
    const money = parseMoney(raw);
    items.push({
      name,
      amount: money?.amount ?? null,
      currencyHint: money?.currencyHint ?? null,
      raw: money?.raw ?? raw,
    });
  });

  return items;
}

export function applyTransactionLineItems(
  rows: PurchaseHistoryRow[],
  byTransactionId: Record<string, PurchaseLineItem[]>,
): PurchaseHistoryRow[] {
  return rows.map((row) => {
    if (!row.transactionId) return row;
    const detail = byTransactionId[row.transactionId];
    if (!detail?.length) return row;
    // Carry a partial refund down to the item it applies to, so its real
    // price (not an equal share) can be taken off the purchase.
    const key = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
    const refundedNames = new Set(
      row.partiallyRefunded ? (row.refundedItems ?? []).map(key) : [],
    );
    const lineItems = detail.map((l) =>
      refundedNames.has(key(l.name)) ? { ...l, refunded: true } : l,
    );
    return {
      ...row,
      lineItems,
      // Keep gift flag from history row; replace names with detail line items
      items: lineItems.map((l) => l.name),
      isGift: row.isGift,
      giftRecipient: row.giftRecipient,
    };
  });
}

export function parseLicenses(html: string): LicenseRow[] {
  const $ = cheerio.load(html);
  const rows: LicenseRow[] = [];

  $("table.account_table tr").each((_, tr) => {
    const $tr = $(tr);
    if ($tr.find("th").length) return;
    const tds = $tr.find("td");
    if (tds.length < 3) return;

    const removeHref = $tr.find("a[href*='RemoveFreeLicense']").attr("href") ?? "";
    const pkgMatch = removeHref.match(/RemoveFreeLicense\(\s*(\d+)/);

    // Clone item cell and strip remove link text
    const $item = $(tds.get(1)).clone();
    $item.find(".free_license_remove_link").remove();

    rows.push({
      dateText: cleanText($(tds.get(0)).text()),
      item: cleanText($item.text()),
      acquisitionMethod: cleanText($(tds.get(2)).text()),
      packageId: pkgMatch?.[1] ?? null,
      removableComplimentary: Boolean(pkgMatch),
    });
  });

  return rows;
}

/**
 * The licences page is paginated ("Showing licenses 1-100 of 453" + a Next
 * link carrying a continuation token). Returns null when the page has no
 * paginator, i.e. it is the whole list.
 */
export function parseLicensePagination(html: string): SourcePagination | null {
  const $ = cheerio.load(html);
  const $ctn = $(".license_paginator_ctn");
  if (!$ctn.length) return null;
  const m = cleanText($ctn.text()).match(
    /(\d[\d,.]*)\s*[-–]\s*(\d[\d,.]*)\D+?(\d[\d,.]*)/,
  );
  const nextHref = $ctn.find("a.license_paginator_next").attr("href") ?? null;
  if (!m && !nextHref) return null;
  const int = (v: string | undefined) => Number((v ?? "").replace(/\D/g, "")) || 0;
  return { from: int(m?.[1]), to: int(m?.[2]), total: int(m?.[3]), nextHref };
}

/**
 * A licences page at all — it has the licence table or the paginator. A login
 * or error page saved in its place has neither. (A real page can render zero
 * rows: Steam pages by licence record and shows fewer rows than records.)
 */
export function isLicensesPage(html: string): boolean {
  const $ = cheerio.load(html);
  return (
    $("table.account_table").length > 0 || $(".license_paginator_ctn").length > 0
  );
}

/**
 * How much of the licence list the saved pages cover, counted in Steam's
 * licence *records* ("Showing licenses 1-100 of 453"), not in table rows: a
 * page of 100 records renders fewer rows, so rows < records says nothing.
 */
export type LicenseCoverage = {
  pagesSaved: number;
  /** Records covered by the saved pages' ranges (100 for one "1-100" page). */
  recordsCovered: number;
  /** Records in the whole list, as the paginator reports. */
  recordsTotal: number;
};

/**
 * Parse every saved page of the licences list, in order. `partial` when the
 * saved pages cover fewer records than the list has, or the last page still
 * has a Next link.
 */
export function parseLicensePages(pages: string[]): {
  kind: "licenses";
  status: "ok" | "partial";
  rows: LicenseRow[];
  pagination?: SourcePagination;
  coverage?: LicenseCoverage;
} {
  const rows = pages.flatMap((html) => parseLicenses(html));
  const paginations = pages.map((html) => parseLicensePagination(html));
  const last = paginations.length ? paginations[paginations.length - 1] : null;
  const ranged = paginations.filter(
    (p): p is SourcePagination => p != null && p.total > 0,
  );
  const coverage: LicenseCoverage | null = ranged.length
    ? {
        pagesSaved: pages.length,
        recordsCovered: ranged.reduce(
          (sum, p) => sum + Math.max(0, p.to - p.from + 1),
          0,
        ),
        recordsTotal: Math.max(...ranged.map((p) => p.total)),
      }
    : null;
  const partial =
    Boolean(last?.nextHref) ||
    (coverage != null && coverage.recordsCovered < coverage.recordsTotal);
  return {
    kind: "licenses",
    status: partial ? "partial" : "ok",
    rows,
    ...(last ? { pagination: last } : {}),
    ...(coverage ? { coverage } : {}),
  };
}

/** The history page still has rows behind its "Load More" button. */
function purchaseHistoryHasMore(html: string): boolean {
  const m = html.match(/g_historyCursor\s*=\s*([^;\n]+)/);
  return m != null && !/^null\b/.test(m[1].trim());
}

export function parseAccountDataTable(
  html: string,
): { headers: string[]; rows: string[][] } {
  const $ = cheerio.load(html);
  const $table = accountDataTable($);
  const headersFromThead = $table
    .find("thead th")
    .map((_, el) => cleanText($(el).text()))
    .get();
  const built: string[][] = [];
  const bodyRows = $table.find("tbody tr");
  const source = bodyRows.length ? bodyRows : $table.find("tr");
  source.each((_, tr) => {
    const $tr = $(tr);
    if ($tr.find("th").length && !$tr.find("td").length) return;
    const cells = $tr
      .find("td")
      .map((__, td) => cleanText($(td).text()))
      .get();
    if (!cells.length) return;
    built.push(cells);
  });
  const headers =
    headersFromThead.length > 0
      ? headersFromThead
      : $table
          .find("tr")
          .first()
          .find("th,td")
          .map((_, el) => cleanText($(el).text()))
          .get();

  return { headers, rows: built };
}

export function parseAccountSpend(html: string): AccountSpendRow[] {
  const { rows } = parseAccountDataTable(html);
  return rows
    .filter((r) => r.length >= 4)
    .map(([type, timeCalculated, amount, currency]) => ({
      type,
      timeCalculated,
      amount: Number(amount),
      currency,
    }));
}

export function parseRemotePlaySessions(html: string): RemotePlaySession[] {
  const { rows } = parseAccountDataTable(html);
  return rows
    .filter((r) => r.length >= 4)
    .map(([gameOrApp, sessionStarted, sessionEnded, deviceType]) => ({
      gameOrApp,
      sessionStarted,
      sessionEnded,
      deviceType,
    }));
}

export function parseLoginHistory(html: string): LoginHistoryRow[] {
  const { rows } = parseAccountDataTable(html);
  return rows
    .filter((r) => r.length >= 6)
    .map(([loginTime, logoffTime, osType, country, city, state]) => ({
      loginTime,
      logoffTime,
      osType,
      country,
      city,
      state,
    }));
}

export function parseMachineAuthNames(html: string): MachineAuthName[] {
  const { rows } = parseAccountDataTable(html);
  return rows
    .filter((r) => r.length >= 2)
    .map(([userSuppliedName, systemSuppliedName]) => ({
      userSuppliedName,
      systemSuppliedName,
    }));
}

export function detectAccountDataKind(
  html: string,
  fileHint?: string,
): AccountDataParseResult["kind"] | "unknown" {
  if (isSteamHelpLoginHtml(html)) return "unknown";

  const $ = cheerio.load(html);
  if ($("table.wallet_history_table").length) return "purchase-history";
  if (
    $("table.account_table .license_date_col").length ||
    $("table.account_table td").length >= 3
  ) {
    return "licenses";
  }

  const $table = accountDataTable($);
  const headers = $table.length ? tableHeaderBlob($, $table) : "";

  if (
    (headers.includes("time calculated") && headers.includes("amount")) ||
    /TotalSpend/i.test(html)
  ) {
    return "account-spend";
  }
  if (headers.includes("session started") && headers.includes("device type")) {
    return "remote-play-sessions";
  }
  if (
    (headers.includes("login time") && headers.includes("os type")) ||
    headers.includes("os type")
  ) {
    return "login-history";
  }
  if (headers.includes("computer name")) {
    return "machine-auth-names";
  }

  const hinted = fileHint
    ? KIND_BY_FILE[fileHint.replace(/^.*[\\/]/, "").toLowerCase()]
    : undefined;
  if (hinted === "purchase-history" && $("table.wallet_history_table").length) {
    return hinted;
  }
  if (hinted === "licenses" && $("table.account_table").length) return hinted;
  if (
    hinted &&
    hinted !== "purchase-history" &&
    hinted !== "licenses" &&
    $table.length
  ) {
    return hinted;
  }

  return "unknown";
}

export function parseAccountDataHtml(
  html: string,
  fileHint?: string,
): AccountDataParseResult {
  if (isSteamHelpLoginHtml(html)) {
    // Not "no rows": the fetch saved a login redirect. Callers must tell the
    // owner to re-fetch instead of showing an empty table.
    return {
      kind: "unknown",
      status: "login-required",
      reason: "Steam Help login page (password required) — not Account Data",
    };
  }
  const kind = detectAccountDataKind(html, fileHint);
  switch (kind) {
    case "purchase-history":
      return {
        kind,
        status: purchaseHistoryHasMore(html) ? "partial" : "ok",
        rows: parsePurchaseHistory(html),
      };
    case "licenses":
      return parseLicensePages([html]);
    case "account-spend":
      return { kind, status: "ok", rows: parseAccountSpend(html) };
    case "remote-play-sessions":
      return { kind, status: "ok", rows: parseRemotePlaySessions(html) };
    case "login-history":
      return { kind, status: "ok", rows: parseLoginHistory(html) };
    case "machine-auth-names":
      return { kind, status: "ok", rows: parseMachineAuthNames(html) };
    default:
      return {
        kind: "unknown",
        status: "unrecognized",
        reason: "Unrecognized Account Data HTML shape",
      };
  }
}

/**
 * Rough totals for the parse script's console line. Counts every non-refunded
 * "purchase" row, gifts and gift cards included — the dashboard's figures come
 * from buildSpendingAnalytics, not from here.
 */
export function summarizePurchases(rows: PurchaseHistoryRow[]) {
  const purchases = rows.filter((r) => /purchase/i.test(r.type) && !r.refunded);
  const refunds = rows.filter((r) => r.refunded);
  let spent = 0;
  let currency: string | null = null;
  for (const row of purchases) {
    const money = row.total ?? row.discountedPrice ?? row.price;
    if (money?.amount != null) {
      spent += money.amount;
      currency ??= money.currencyHint;
    }
  }
  let refundedTotal = 0;
  for (const row of refunds) {
    const money = row.total ?? row.price;
    if (money?.amount != null) refundedTotal += money.amount;
  }
  return {
    transactionCount: rows.length,
    purchaseCount: purchases.length,
    refundCount: refunds.length,
    spent,
    refundedTotal,
    // `spent` already leaves refunded purchases out; subtracting them again
    // would count each refund twice.
    netSpent: spent,
    currency,
    uniqueItems: [...new Set(rows.flatMap((r) => r.items))],
  };
}
