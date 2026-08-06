import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";

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
  refunded: boolean;
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

export type AccountDataParseResult =
  | { kind: "purchase-history"; rows: PurchaseHistoryRow[] }
  | { kind: "licenses"; rows: LicenseRow[] }
  | { kind: "account-spend"; rows: AccountSpendRow[] }
  | { kind: "remote-play-sessions"; rows: RemotePlaySession[] }
  | { kind: "login-history"; rows: LoginHistoryRow[] }
  | { kind: "machine-auth-names"; rows: MachineAuthName[] }
  | { kind: "unknown"; reason: string };

const CURRENCY_SYMBOLS: Record<string, string> = {
  "₹": "INR",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
  "₩": "KRW",
  "₽": "RUB",
  A$: "AUD",
  C$: "CAD",
  R$: "BRL",
};

export function parseMoney(rawInput: string): Money | null {
  const raw = rawInput.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return null;

  let currencyHint: string | null = null;
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(sym)) {
      currencyHint = code;
      break;
    }
  }
  const codeMatch = raw.match(/\b([A-Z]{3})\b/);
  if (!currencyHint && codeMatch) currencyHint = codeMatch[1];

  // Keep digits, dots, commas, minus
  const numeric = raw.replace(/[^\d,.\-]/g, "");
  if (!numeric || numeric === "-" || numeric === "." || numeric === ",") {
    return { raw, amount: null, currencyHint };
  }

  let normalized = numeric;
  // Indian / European: 1,234.56 or 1.234,56 or 2,176
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      // 1.234,56
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      // 1,234.56
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    const parts = normalized.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = `${parts[0]}.${parts[1]}`;
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  }

  const amount = Number(normalized);
  return {
    raw,
    amount: Number.isFinite(amount) ? amount : null,
    currencyHint,
  };
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/&trade;/g, "™")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function cellText($: cheerio.CheerioAPI, el: AnyNode | null): string {
  if (!el) return "";
  return cleanText($(el).text());
}

export function parsePurchaseHistory(html: string): PurchaseHistoryRow[] {
  const $ = cheerio.load(html);
  const rows: PurchaseHistoryRow[] = [];

  $("table.wallet_history_table tbody tr.wallet_table_row").each((_, tr) => {
    const $tr = $(tr);
    const onclick = $tr.attr("onclick") ?? "";
    const transMatch = onclick.match(/transid=(\d+)/);
    const refunded =
      $tr.find(".wht_refunded, .wht_item_refunded").length > 0 ||
      $tr.find(".wht_items").hasClass("wht_item_refunded");

    const items = $tr
      .find("td.wht_items div")
      .map((__, el) => cleanText($(el).text()))
      .get()
      .filter(Boolean);

    const typeCell = cleanText($tr.find("td.wht_type").text());
    const isGift =
      /gift sent to/i.test(typeCell) ||
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
    const lineItems = byTransactionId[row.transactionId];
    if (!lineItems?.length) return row;
    return {
      ...row,
      lineItems,
      // Keep gift flag from history row; replace names with detail line items
      items: lineItems.map((l) => l.name),
      isGift: row.isGift,
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

export function parseAccountDataTable(
  html: string,
): { headers: string[]; rows: string[][] } {
  const $ = cheerio.load(html);
  const $table = $("table.AccountDataTable").first();
  const headers = $table
    .find("thead th")
    .map((_, el) => cleanText($(el).text()))
    .get();
  const built: string[][] = [];
  $table.find("tbody tr").each((_, tr) => {
    built.push(
      $(tr)
        .find("td")
        .map((__, td) => cleanText($(td).text()))
        .get(),
    );
  });

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
): AccountDataParseResult["kind"] | "unknown" {
  const $ = cheerio.load(html);
  if ($("table.wallet_history_table").length) return "purchase-history";
  if ($("table.account_table .license_date_col").length) return "licenses";

  const headers = $("table.AccountDataTable thead th")
    .map((_, el) => cleanText($(el).text()).toLowerCase())
    .get()
    .join("|");

  if (headers.includes("time calculated") && headers.includes("amount")) {
    return "account-spend";
  }
  if (headers.includes("session started") && headers.includes("device type")) {
    return "remote-play-sessions";
  }
  if (headers.includes("login time") && headers.includes("os type")) {
    return "login-history";
  }
  if (headers.includes("computer name")) {
    return "machine-auth-names";
  }

  // Fallback on body cues
  if (/TotalSpend/i.test(html) && /AccountDataTable/i.test(html)) {
    return "account-spend";
  }

  return "unknown";
}

export function parseAccountDataHtml(html: string): AccountDataParseResult {
  const kind = detectAccountDataKind(html);
  switch (kind) {
    case "purchase-history":
      return { kind, rows: parsePurchaseHistory(html) };
    case "licenses":
      return { kind, rows: parseLicenses(html) };
    case "account-spend":
      return { kind, rows: parseAccountSpend(html) };
    case "remote-play-sessions":
      return { kind, rows: parseRemotePlaySessions(html) };
    case "login-history":
      return { kind, rows: parseLoginHistory(html) };
    case "machine-auth-names":
      return { kind, rows: parseMachineAuthNames(html) };
    default:
      return { kind: "unknown", reason: "Unrecognized Account Data HTML shape" };
  }
}

/** Aggregate helpers for spend analytics */
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
    netSpent: spent - refundedTotal,
    currency,
    uniqueItems: [...new Set(rows.flatMap((r) => r.items))],
  };
}
