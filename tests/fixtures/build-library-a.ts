/**
 * Builds the committed synthetic fixture tests/fixtures/library-a/.
 *
 *   npx tsx tests/fixtures/build-library-a.ts
 *
 * Everything here is invented: titles, app ids (>= 9000001), people, prices.
 * The raw Steam-shaped HTML is written first; the parsed JSON is then produced
 * from that HTML by the real pipeline (scripts/parse-account-data.ts and
 * parseTransactionDetailHtml), never typed by hand.
 *
 * NOT generated here: library-a/expected.json. Those totals are derived by hand
 * from the rows below (see library-a/README.md) and must not be regenerated
 * from application output.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseTransactionDetailHtml } from "../../src/lib/account-data/parsers";

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, "..", "..");
const ROOT = path.join(HERE, "library-a");
const RAW = path.join(ROOT, "samples", "account-data");
const PARSED = path.join(ROOT, "samples", "parsed");
const DATA = path.join(ROOT, "data");

/** Canary values: must never appear in any response or rendered page. */
const STEAM_ID = "76561197960265728";
const CANARY_ITAD_KEY = "CANARY-ITAD-KEY-000000000000";
const CANARY_STEAM_TOKEN = "CANARY-STEAM-TOKEN";

/** Snapshot time of the playtime fetch — every "as of" in the fixture. */
const FETCHED_AT = "2026-10-15T12:00:00.000Z";
const PRICES_AT = "2026-10-14T06:00:00.000Z";

const inr = (n: number) => `₹ ${n.toLocaleString("en-IN")}`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ───────────────────────── library (playtime) ─────────────────────────

type Game = {
  id: number;
  name: string;
  /** Lifetime minutes; null = owned but absent from the playtime snapshot */
  minutes: number | null;
  minutes2w?: number;
  /** ISO time of the last session */
  last?: string;
  family?: boolean;
  /** Store price today / all-time low / list price; null = not in price cache */
  price?: { cur: number | null; low: number | null; retail: number | null } | null;
  hue: number;
};

const G: Game[] = [
  { id: 9000001, name: "Starfall Tactics", minutes: 24750, last: "2026-10-12T18:30:00Z", price: { cur: 1299, low: 449, retail: 1299 }, hue: 212 },
  { id: 9000002, name: "Emberwake", minutes: 17160, last: "2026-09-28T16:10:00Z", price: { cur: 1999, low: 799, retail: 1999 }, hue: 14 },
  { id: 9000003, name: "Hollow Circuit", minutes: 10392, last: "2026-08-19T20:05:00Z", price: { cur: 1200, low: 360, retail: 1200 }, hue: 168 },
  { id: 9000004, name: "Paper Lanterns™", minutes: 5784, last: "2025-12-30T19:45:00Z", price: { cur: 529, low: 174, retail: 529 }, hue: 38 },
  { id: 9000005, name: "Tidebreaker", minutes: 3708, last: "2025-06-14T15:20:00Z", price: { cur: 2499, low: 999, retail: 2499 }, hue: 196 },
  { id: 9000006, name: "Glass Orchard", minutes: 2646, last: "2024-11-02T17:00:00Z", price: { cur: 999, low: 199, retail: 999 }, hue: 132 },
  // Store lists it at 100% off today (promo) — still a game you paid for.
  { id: 9000007, name: "Rustline Rally", minutes: 2316, last: "2024-03-21T18:15:00Z", price: { cur: 0, low: 299, retail: 899 }, hue: 22 },
  { id: 9000008, name: "Ironroot", minutes: 7200, last: "2026-07-04T21:30:00Z", price: { cur: 1100, low: 275, retail: 1100 }, hue: 96 },
  // Bought after the playtime snapshot: licence + purchase exist, no playtime row.
  { id: 9000009, name: "Ironroot II", minutes: null, price: { cur: 1800, low: 1620, retail: 1800 }, hue: 104 },
  { id: 9000010, name: "Voidrunner 2", minutes: 3120, last: "2026-05-17T19:00:00Z", price: { cur: 1499, low: 374, retail: 1499 }, hue: 268 },
  { id: 9000011, name: "Saltwater Diner", minutes: 1380, last: "2026-02-08T14:40:00Z", price: { cur: 649, low: 162, retail: 649 }, hue: 186 },
  { id: 9000012, name: "Lowtide", minutes: 24, last: "2024-05-02T20:00:00Z", price: { cur: 399, low: 99, retail: 399 }, hue: 204 },
  { id: 9000013, name: "Brass Meridian", minutes: 0, price: { cur: 2598, low: 1299, retail: 2598 }, hue: 44 },
  { id: 9000014, name: "Kestrel Run", minutes: 5400, minutes2w: 420, last: "2026-10-14T21:15:00Z", price: { cur: 1999, low: 999, retail: 1999 }, hue: 28 },
  { id: 9000015, name: "Hearthbound", minutes: 30, last: "2025-02-21T19:30:00Z", price: { cur: 900, low: 225, retail: 900 }, hue: 8 },
  { id: 9000016, name: "Sunken Arcade", minutes: 840, minutes2w: 150, last: "2026-10-09T17:50:00Z", price: { cur: 600, low: 150, retail: 600 }, hue: 290 },
  { id: 9000017, name: "Quiet Harbor", minutes: 4320, last: "2025-09-06T16:25:00Z", price: { cur: 750, low: 300, retail: 750 }, hue: 200 },
  { id: 9000018, name: "Moss Kingdom", minutes: 1500, last: "2024-08-11T15:10:00Z", price: { cur: 1125, low: 450, retail: 1125 }, hue: 118 },
  { id: 9000019, name: "Nightglass", minutes: 660, last: "2023-10-29T22:00:00Z", price: { cur: 625, low: 250, retail: 625 }, hue: 248 },
  { id: 9000020, name: "Lumen Drift", minutes: 1920, last: "2025-03-30T18:05:00Z", price: { cur: 1200, low: 600, retail: 1200 }, hue: 54 },
  { id: 9000021, name: "Cinder Vale", minutes: 1080, last: "2026-01-18T20:20:00Z", price: { cur: 800, low: 400, retail: 800 }, hue: 2 },
  // A standalone game, NOT DLC of Hollow Circuit.
  { id: 9000022, name: "Hollow Circuit: Overclock", minutes: 3840, last: "2026-09-12T19:40:00Z", price: { cur: 1500, low: 750, retail: 1500 }, hue: 176 },
  // One playable app whose name contains "Collection".
  { id: 9000023, name: "Anvil Saga: The Complete Collection", minutes: 1800, last: "2024-12-15T17:35:00Z", price: { cur: 899, low: 224, retail: 899 }, hue: 30 },
  // Members of the "Lanternfall Collection" pack purchase.
  { id: 9000024, name: "Lanternfall", minutes: 2400, last: "2025-11-23T18:45:00Z", price: { cur: 700, low: 175, retail: 700 }, hue: 48 },
  { id: 9000025, name: "Lanternfall Remnant", minutes: 900, last: "2026-03-07T16:00:00Z", price: { cur: 500, low: 125, retail: 500 }, hue: 58 },
  // Two separate games; the second is NOT an edition of the first.
  { id: 9000026, name: "Pyrewatch", minutes: 1200, last: "2023-04-16T19:10:00Z", price: { cur: 799, low: 199, retail: 799 }, hue: 12 },
  { id: 9000027, name: "Pyrewatch Eternal", minutes: 2100, minutes2w: 300, last: "2026-10-11T20:30:00Z", price: { cur: 1799, low: 449, retail: 1799 }, hue: 348 },
  // Deliberately absent from the price cache.
  { id: 9000028, name: "Obsidian Tram", minutes: 750, minutes2w: 240, last: "2026-10-13T22:10:00Z", price: null, hue: 232 },
  { id: 9000029, name: "Vesper Lines", minutes: 8910, last: "2026-06-21T15:55:00Z", price: { cur: 949, low: 237, retail: 949 }, hue: 258 },
  { id: 9000030, name: "Copper Sparrow", minutes: 4470, last: "2025-08-02T18:00:00Z", price: { cur: 1499, low: 524, retail: 1499 }, hue: 24 },
  { id: 9000031, name: "Thimblewood", minutes: 1950, last: "2023-01-08T17:25:00Z", price: { cur: 398, low: 99, retail: 398 }, hue: 144 },
  { id: 9000032, name: "Nine Lamps", minutes: 1260, last: "2024-06-09T21:00:00Z", price: { cur: 799, low: 274, retail: 799 }, hue: 42 },
  { id: 9000033, name: "Farlight Courier", minutes: 510, last: "2025-01-05T16:45:00Z", price: { cur: 1499, low: 374, retail: 1499 }, hue: 190 },
  { id: 9000034, name: "Marigold Engine", minutes: 180, last: "2025-06-03T19:15:00Z", price: { cur: 259, low: 64, retail: 259 }, hue: 46 },
  { id: 9000035, name: "Wintering", minutes: 0, price: { cur: 899, low: 89, retail: 899 }, hue: 206 },
  { id: 9000036, name: "Tall Grass", minutes: 96, minutes2w: 96, last: "2026-10-08T18:20:00Z", price: { cur: 1100, low: 550, retail: 1100 }, hue: 110 },
  { id: 9000037, name: "Signal Kite", minutes: 6600, last: "2026-04-25T20:50:00Z", price: { cur: 2499, low: 1249, retail: 2499 }, hue: 340 },
  // Free to play: no store price at all.
  { id: 9000038, name: "Skyline Brawl", minutes: 12600, minutes2w: 180, last: "2026-10-10T19:05:00Z", price: { cur: null, low: null, retail: null }, hue: 318 },
  // Free-to-keep giveaways (permanent licences).
  { id: 9000039, name: "Driftwood Tales", minutes: 372, last: "2024-02-03T17:10:00Z", price: { cur: 499, low: 99, retail: 499 }, hue: 34 },
  // Free weekend only — played, never owned. Not in the price cache.
  { id: 9000040, name: "Cobalt Siege", minutes: 210, last: "2025-03-16T21:40:00Z", price: null, hue: 222 },
  // Steam Family library — played, not owned. Not in the price cache.
  { id: 9000041, name: "Aurora Crossing", minutes: 2880, last: "2026-08-30T18:30:00Z", family: true, price: null, hue: 160 },
  // Received as a gift (licence says so).
  { id: 9000042, name: "Marrow Deep", minutes: 1620, last: "2025-10-19T19:25:00Z", price: { cur: 1499, low: 599, retail: 1499 }, hue: 356 },
  // Received as a gift (only the gift e-mail record knows).
  { id: 9000043, name: "Pocket Cartographer", minutes: 540, last: "2022-12-28T16:15:00Z", price: { cur: 349, low: 104, retail: 349 }, hue: 80 },
  { id: 9000044, name: "Bramble Post", minutes: 132, last: "2025-06-29T18:00:00Z", price: { cur: 299, low: 74, retail: 299 }, hue: 126 },
  { id: 9000045, name: "Oddment Hotel", minutes: 0, price: { cur: 199, low: 49, retail: 199 }, hue: 300 },
];

/** Purchase SKUs whose name differs from the library title, DLC, and packs. */
const EXTRA_QUOTES: {
  title: string;
  id: number;
  cur: number;
  low: number;
  retail: number;
  hue: number;
}[] = [
  // Store search resolved these edition SKUs to the base app.
  { title: "Voidrunner 2: Ultimate Edition", id: 9000010, cur: 1499, low: 374, retail: 1499, hue: 268 },
  { title: "Saltwater Diner - Gourmet Edition", id: 9000011, cur: 649, low: 162, retail: 649, hue: 186 },
  { title: "Pyrewatch Eternal Standard Edition", id: 9000027, cur: 1799, low: 449, retail: 1799, hue: 348 },
  // Real DLC of Starfall Tactics (see data/dlc-parents.json).
  { title: "Starfall Tactics - Crimson Front", id: 9000101, cur: 399, low: 199, retail: 399, hue: 352 },
  // Multi-game pack SKU.
  { title: "Lanternfall Collection", id: 9000201, cur: 1620, low: 810, retail: 1620, hue: 52 },
];

// ───────────────────────── purchase history ─────────────────────────

type Row = {
  date: string;
  /** item names; `!name` marks an item refunded on its own */
  items: string[];
  type?: string;
  pay: string[];
  total: number;
  /** [discount %, original price] */
  sale?: [number, number];
  transid: number;
  refunded?: boolean;
  giftTo?: string;
  totalSuffix?: string;
  walletChange?: string;
  walletBalance?: string;
  /** line items for the HelpWithTransaction detail page */
  lines?: [string, number][];
};

let tid = 4000;
const t = () => ++tid;

/** Oldest first here; written newest first, as Steam does. */
const ROWS: Row[] = [
  { date: "12 Mar, 2021", items: ["Starfall Tactics"], pay: ["UPI"], total: 899, transid: t() },
  { date: "4 Apr, 2021", items: ["Vesper Lines"], pay: ["UPI"], total: 649, transid: t() },
  { date: "27 Jun, 2021", items: ["Emberwake"], pay: ["Visa"], total: 1199, sale: [-40, 1999], transid: t() },
  { date: "18 Aug, 2021", items: ["Ironroot"], pay: ["Visa"], total: 700, transid: t() },
  { date: "16 Oct, 2021", items: ["Copper Sparrow"], pay: ["Visa"], total: 1049, transid: t() },
  { date: "5 Dec, 2021", items: ["Starfall Tactics - Crimson Front"], pay: ["UPI"], total: 299, transid: t() },

  { date: "2 Jan, 2022", items: ["Hollow Circuit"], pay: ["UPI"], total: 480, sale: [-60, 1200], transid: t() },
  { date: "14 Feb, 2022", items: ["Paper Lanterns™"], pay: ["UPI"], total: 349, transid: t() },
  { date: "9 Jul, 2022", items: ["Tidebreaker"], pay: ["Mastercard"], total: 1499, transid: t() },
  { date: "30 Jul, 2022", items: ["Thimblewood"], pay: ["UPI"], total: 199, sale: [-50, 398], transid: t() },
  { date: "8 Oct, 2022", items: ["Pyrewatch"], pay: ["UPI"], total: 399, transid: t() },
  { date: "25 Nov, 2022", items: ["Glass Orchard"], pay: ["UPI"], total: 249, sale: [-75, 999], transid: t() },
  // Gift to a friend, no transaction detail fetched (lineItems stays []).
  { date: "20 Dec, 2022", items: ["Glass Orchard"], type: "Gift Purchase", pay: ["UPI"], total: 499, giftTo: "pixel_otter", transid: t() },

  { date: "3 Mar, 2023", items: ["Rustline Rally"], pay: ["UPI"], total: 599, transid: t() },
  // Three-game cart, one cart-level discount.
  {
    date: "24 Jun, 2023", items: ["Quiet Harbor", "Moss Kingdom", "Nightglass"], pay: ["Visa"], total: 1000, sale: [-60, 2500], transid: 5001,
    lines: [["Quiet Harbor", 300], ["Moss Kingdom", 450], ["Nightglass", 250]],
  },
  { date: "7 Jul, 2023", items: ["Anvil Saga: The Complete Collection"], pay: ["UPI"], total: 224, sale: [-75, 899], transid: t() },
  // Bought, then fully refunded two days later.
  { date: "5 Aug, 2023", items: ["Broken Compass"], pay: ["UPI"], total: 799, refunded: true, transid: t() },
  { date: "7 Aug, 2023", items: ["Broken Compass"], type: "Refund", pay: ["UPI"], total: 799, transid: t() },
  { date: "22 Sep, 2023", items: ["Signal Kite"], pay: ["Mastercard"], total: 1250, transid: t() },
  { date: "11 Nov, 2023", items: ["Voidrunner 2: Ultimate Edition"], pay: ["Visa"], total: 560, sale: [-75, 2240], transid: t() },
  // Two-game cart; only the second game was refunded.
  {
    date: "12 Dec, 2023", items: ["Lumen Drift", "!Ashfall Protocol"], pay: ["UPI"], total: 1000, transid: 5002,
    lines: [["Lumen Drift", 600], ["Ashfall Protocol", 400]],
  },

  { date: "12 Jan, 2024", items: ["Nine Lamps"], pay: ["UPI"], total: 549, transid: t() },
  { date: "6 Apr, 2024", items: ["Saltwater Diner - Gourmet Edition"], pay: ["UPI"], total: 324, transid: t() },
  { date: "1 May, 2024", items: ["Lowtide"], pay: ["UPI"], total: 199, transid: t() },
  { date: "19 May, 2024", items: ["Hollow Circuit: Overclock"], pay: ["UPI"], total: 900, transid: t() },
  { date: "30 Jun, 2024", items: ["Brass Meridian"], pay: ["Visa"], total: 1299, sale: [-50, 2598], transid: t() },
  { date: "3 Sep, 2024", items: ["Lanternfall Collection"], pay: ["Visa"], total: 810, transid: t() },
  { date: "28 Nov, 2024", items: ["Farlight Courier"], pay: ["Visa"], total: 374, sale: [-75, 1499], transid: t() },
  // Two games gifted to one friend, with transaction detail.
  {
    date: "22 Dec, 2024", items: ["Moss Kingdom", "Tidebreaker"], type: "Gift Purchase", pay: ["Visa"], total: 1500, giftTo: "nova_wren", transid: 5004,
    lines: [["Moss Kingdom", 450], ["Tidebreaker", 1050]],
  },

  { date: "10 Jan, 2025", items: ["Purchased ₹ 1,000 Wallet Credit"], pay: ["UPI"], total: 1000, transid: t(), walletChange: "+₹ 1,000", walletBalance: "₹ 1,000" },
  // Split payment: ₹200 from the wallet, ₹1,300 on the card.
  { date: "15 Jan, 2025", items: ["Kestrel Run"], pay: ["₹ 200 Wallet", "₹ 1,300 Visa"], total: 1500, transid: t(), walletChange: "-₹ 200", walletBalance: "₹ 800" },
  { date: "3 Feb, 2025", items: ["Steam Community Market"], type: "Market Transaction", pay: ["Wallet"], total: 120, transid: t(), walletChange: "-₹ 120", walletBalance: "₹ 680" },
  // A market SALE: money came in.
  { date: "8 Feb, 2025", items: ["Steam Community Market"], type: "Market Transaction", pay: ["Wallet"], total: 45, totalSuffix: " Credit", transid: t(), walletChange: "+₹ 45", walletBalance: "₹ 725" },
  { date: "20 Feb, 2025", items: ["Hearthbound"], pay: ["UPI"], total: 450, transid: t() },
  // One checkout: a game for yourself plus a gift card for a friend.
  {
    date: "14 Mar, 2025", items: ["Cinder Vale", "Digital Gift Card"], pay: ["UPI"], total: 900, transid: 5003,
    lines: [["Cinder Vale", 400], ["Digital Gift Card", 500]],
  },
  { date: "2 Jun, 2025", items: ["Marigold Engine"], pay: ["UPI"], total: 129, transid: t() },
  { date: "24 Aug, 2025", items: ["Digital Gift Card"], pay: ["UPI"], total: 2000, transid: t() },
  { date: "9 Sep, 2025", items: ["Sunken Arcade"], pay: ["UPI"], total: 150, sale: [-75, 600], transid: t() },
  { date: "26 Dec, 2025", items: ["Wintering"], pay: ["UPI"], total: 89, sale: [-90, 899], transid: t() },

  { date: "14 Feb, 2026", items: ["Tall Grass"], pay: ["UPI"], total: 715, transid: t() },
  { date: "21 Mar, 2026", items: ["Pyrewatch Eternal Standard Edition"], pay: ["UPI"], total: 449, transid: t() },
  { date: "17 Apr, 2026", items: ["Obsidian Tram"], pay: ["UPI"], total: 275, transid: t() },
  { date: "2 Oct, 2026", items: ["Ironroot II"], pay: ["UPI"], total: 1800, transid: t() },
];

function purchaseRowHtml(r: Row): string {
  const itemDivs = r.items
    .map((raw) => {
      const refunded = raw.startsWith("!");
      const name = refunded ? raw.slice(1) : raw;
      return refunded
        ? `<div class="wht_item_refunded">${esc(name)}</div>`
        : `<div>${esc(name)}</div>`;
    })
    .join("");
  const gift = r.giftTo
    ? `<div>Gift sent to <a href="https://steamcommunity.com/id/${r.giftTo}">${r.giftTo}</a></div>`
    : "";
  const base = r.sale
    ? `<div class="wht_base_price_discounted"><div class="wht_discount_pct">${r.sale[0]}%</div><div class="wht_original_price">${inr(r.sale[1])}</div><div class="wht_discounted_price">${inr(r.total)}</div></div>`
    : inr(r.total);
  const rowClass = `wallet_table_row${r.walletChange ? " wallet_table_row_amt_change" : ""}`;
  const itemsClass = `wht_items${r.refunded ? " wht_item_refunded" : ""}`;
  return [
    `<tr class="${rowClass}" onclick="location.href='https://help.steampowered.com/en/wizard/HelpWithTransaction?transid=${r.transid}'">`,
    `  <td class="wht_date">${r.date}</td>`,
    `  <td class="${itemsClass}">${itemDivs}${gift}</td>`,
    `  <td class="wht_type"><div>${r.type ?? "Purchase"}</div><div class="wth_payment">${r.pay.map((p) => `<div>${p}</div>`).join("")}</div></td>`,
    `  <td class="wht_base_price">${base}</td>`,
    `  <td class="wht_tax"></td>`,
    `  <td class="wht_shipping"></td>`,
    `  <td class="wht_total">${inr(r.total)}${r.totalSuffix ?? ""}</td>`,
    `  <td class="wht_wallet_change">${r.walletChange ?? ""}</td>`,
    `  <td class="wht_wallet_balance">${r.walletBalance ?? ""}</td>`,
    `</tr>`,
  ].join("\n");
}

const page = (title: string, body: string) =>
  `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n${body}\n</body>\n</html>\n`;

function purchaseHistoryHtml(): string {
  const rows = [...ROWS].reverse().map(purchaseRowHtml).join("\n");
  return page(
    "Purchase History (synthetic fixture)",
    `<table class="wallet_history_table">\n<thead><tr><th>Date</th><th>Items</th><th>Type</th><th>Price</th><th>Tax</th><th>Shipping</th><th>Total</th><th>Wallet Change</th><th>Wallet Balance</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`,
  );
}

function transactionHtml(r: Row): string {
  const lines = (r.lines ?? [])
    .map(
      ([name, amount]) =>
        `  <div class="purchase_line_item"><span class="purchase_detail_field">${esc(name)}</span><span class="refund_value">${inr(amount)}</span></div>`,
    )
    .join("\n");
  return page(
    `Transaction ${r.transid} (synthetic fixture)`,
    `<div class="purchase_line_items">\n${lines}\n</div>`,
  );
}

// ───────────────────────── licences ─────────────────────────

type Lic = { date: string; item: string; method: string; removePkg?: number };

function licences(): Lic[] {
  const out: Lic[] = [];
  for (const r of ROWS) {
    const own = (r.type ?? "Purchase") === "Purchase" && !r.refunded;
    if (!own) continue;
    for (const raw of r.items) {
      if (raw.startsWith("!")) continue; // refunded item: licence removed
      if (/wallet credit|gift card|community market/i.test(raw)) continue;
      out.push({ date: r.date, item: raw, method: "Steam Store" });
    }
  }
  out.push(
    { date: "9 May, 2021", item: "Skyline Brawl", method: "Complimentary" },
    { date: "19 Jan, 2024", item: "Driftwood Tales Limited Free Promotional Package - Jan 2024", method: "Complimentary" },
    { date: "14 Mar, 2025", item: "Cobalt Siege Free Weekend - Mar 2025", method: "Complimentary" },
    { date: "21 Jun, 2025", item: "Bramble Post Limited Free Promotional Package - Jun 2025", method: "Complimentary" },
    { date: "2 Aug, 2025", item: "Oddment Hotel", method: "Complimentary", removePkg: 9100045 },
    { date: "11 Oct, 2025", item: "Marrow Deep", method: "Gift/Guest Pass" },
  );
  return out;
}

function licencesHtml(): string {
  // Steam lists newest first; order is irrelevant to the analytics.
  const rows = licences()
    .reverse()
    .map((l) => {
      const remove = l.removePkg
        ? `<div class="free_license_remove_link"><a href="javascript:RemoveFreeLicense( ${l.removePkg}, 'T2RkbWVudCBIb3RlbA==' );">Remove</a></div>`
        : "";
      return `<tr><td class="license_date_col">${l.date}</td><td>${remove}${esc(l.item)}</td><td class="license_acquisition_col">${l.method}</td></tr>`;
    })
    .join("\n");
  return page(
    "Licenses and product key activations (synthetic fixture)",
    `<table class="account_table">\n<tr><th class="license_date_col">Date</th><th>Item</th><th class="license_acquisition_col">Acquisition Method</th></tr>\n${rows}\n</table>`,
  );
}

// ───────────────────────── other Account Data pages ─────────────────────────

function accountSpendHtml(): string {
  const rows = [
    ["TotalSpend", "2026-10-01 00:00:00", "512.34", "USD"],
    ["PackageOnlySpend", "2026-10-01 00:00:00", "431.20", "USD"],
    ["PackageOnlySavings", "2026-10-01 00:00:00", "188.75", "USD"],
  ]
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n");
  return page(
    "External Funds Used (synthetic fixture)",
    `<table class="AccountDataTable">\n<thead><tr><th>Type</th><th>Time Calculated</th><th>Amount</th><th>Currency</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`,
  );
}

function loginHistoryHtml(): string {
  const rows = [
    ["2026-10-14 21:02:11", "2026-10-14 23:40:52", "Windows 11", "IN", "Bengaluru", "KA"],
    ["2026-10-13 20:15:40", "2026-10-13 22:31:07", "Windows 11", "IN", "Bengaluru", "KA"],
    ["2026-10-11 19:48:03", "2026-10-11 22:10:19", "SteamOS", "IN", "Bengaluru", "KA"],
    ["2026-10-09 17:20:55", "2026-10-09 18:44:30", "Windows 11", "IN", "Bengaluru", "KA"],
  ]
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n");
  return page(
    "Steam Login History (synthetic fixture)",
    `<table class="AccountDataTable">\n<thead><tr><th>Login Time</th><th>Logoff Time</th><th>OS Type</th><th>Country</th><th>City</th><th>State</th></tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`,
  );
}

function gamesHtml(): string {
  const inSnapshot = G.filter((g) => g.minutes != null);
  // A few visible cards (the community page renders the first screenful)…
  const cards = inSnapshot
    .filter((g) => g.minutes! > 0 && g.minutes! % 6 === 0 && g.last)
    .sort((a, b) => b.minutes! - a.minutes!)
    .slice(0, 6)
    .map((g) => {
      const d = new Date(g.last!);
      const label = `${d.getUTCDate()} ${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d.getUTCFullYear()}`;
      return `<div class="card"><a href="https://store.steampowered.com/app/${g.id}" class="_22awlPiAoaZjQMqxJhp-KP wfG8VGEsVTw">${esc(g.name)}</a><div><span class="lbl">TOTAL PLAYED</span> ${(g.minutes! / 60).toLocaleString("en-US")} hours</div><div><span class="lbl">LAST PLAYED</span> ${label}</div></div>`;
    })
    .join("\n");
  // …and the full list in the escaped SSR JSON blob, exactly as Steam embeds it.
  const q = '\\"';
  const blob = inSnapshot
    .map((g) => {
      const parts = [
        `${q}appid${q}:${g.id}`,
        `${q}name${q}:${q}${g.name}${q}`,
        `${q}playtime_forever${q}:${g.minutes}`,
        `${q}img_icon_url${q}:${q}synthetic${q}`,
      ];
      if (g.minutes2w) parts.push(`${q}playtime_2weeks${q}:${g.minutes2w}`);
      if (g.last) {
        parts.push(`${q}rtime_last_played${q}:${Math.floor(Date.parse(g.last) / 1000)}`);
      }
      return `{${parts.join(",")}}`;
    })
    .join(",");
  return page(
    "Games (synthetic fixture)",
    `${cards}\n<script>window.SSR={"renderContext":"{${q}steamid${q}:${q}${STEAM_ID}${q},${q}games${q}:[${blob}]}"};</script>`,
  );
}

// ───────────────────────── local placeholder artwork ─────────────────────────

/** Inline SVG as a data: URI — renders with no network at all. */
function art(title: string, hue: number, w: number, h: number): string {
  const clean = title.replace(/™|®/g, "");
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  const perLine = w >= 400 ? 18 : w >= 300 ? 14 : 22;
  for (const word of words) {
    const lastLine = lines[lines.length - 1];
    if (lastLine != null && (lastLine + " " + word).length <= perLine) {
      lines[lines.length - 1] = lastLine + " " + word;
    } else {
      lines.push(word);
    }
  }
  const portrait = h > w;
  const size = portrait ? 58 : h < 100 ? 17 : 34;
  const lh = Math.round(size * 1.15);
  const startY = portrait
    ? h - 90 - (lines.length - 1) * lh
    : Math.round(h / 2 - ((lines.length - 1) * lh) / 2 + size * 0.35);
  const text = lines
    .map(
      (l, i) =>
        `<text x="${portrait ? 44 : Math.round(w * 0.07)}" y="${startY + i * lh}">${esc(l)}</text>`,
    )
    .join("");
  const h2 = (hue + 46) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 62% 34%)"/><stop offset="1" stop-color="hsl(${h2} 58% 13%)"/></linearGradient></defs>` +
    `<rect width="${w}" height="${h}" fill="url(#g)"/>` +
    `<circle cx="${Math.round(w * 0.82)}" cy="${Math.round(h * (portrait ? 0.24 : 0.3))}" r="${Math.round(Math.min(w, h) * (portrait ? 0.42 : 0.62))}" fill="hsl(${hue} 80% 62%)" opacity=".2"/>` +
    `<circle cx="${Math.round(w * 0.64)}" cy="${Math.round(h * (portrait ? 0.4 : 0.85))}" r="${Math.round(Math.min(w, h) * 0.24)}" fill="hsl(${h2} 85% 70%)" opacity=".16"/>` +
    `<g font-family="Verdana,Arial,sans-serif" font-weight="700" font-size="${size}" fill="#fff" fill-opacity=".94">${text}</g>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ───────────────────────── write everything ─────────────────────────

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}
const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";
const normTitle = (s: string) =>
  s.toLowerCase().replace(/™|®/g, "").replace(/\s+/g, " ").trim();

function main() {
  for (const dir of [path.join(ROOT, "samples"), DATA, path.join(ROOT, ".steam-session")]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // 1. Raw Steam-shaped HTML
  write(path.join(RAW, "purchase-history.html"), purchaseHistoryHtml());
  write(path.join(RAW, "licenses.html"), licencesHtml());
  write(path.join(RAW, "account-spend.html"), accountSpendHtml());
  write(path.join(RAW, "login-history.html"), loginHistoryHtml());
  write(path.join(RAW, "games-all.html"), gamesHtml());
  const withDetail = ROWS.filter((r) => r.lines);
  for (const r of withDetail) {
    write(path.join(RAW, "transactions", `${r.transid}.html`), transactionHtml(r));
  }

  // 2. Parsed JSON — produced by the real parsers from the HTML above
  const lineItems: Record<string, unknown> = {};
  for (const r of withDetail) {
    const html = fs.readFileSync(path.join(RAW, "transactions", `${r.transid}.html`), "utf8");
    lineItems[String(r.transid)] = parseTransactionDetailHtml(html);
  }
  write(path.join(PARSED, "transaction-line-items.json"), json(lineItems));

  const run = spawnSync(
    process.execPath,
    [path.join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), path.join(REPO, "scripts", "parse-account-data.ts")],
    {
      cwd: REPO,
      env: { ...process.env, STEAM_STATS_ROOT: ROOT, STEAM_STATS_OFFLINE: "1", TZ: "UTC", LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" },
      encoding: "utf8",
    },
  );
  process.stdout.write(run.stdout ?? "");
  if (run.status !== 0) {
    process.stderr.write(run.stderr ?? "");
    throw new Error("scripts/parse-account-data.ts failed");
  }
  fs.rmSync(path.join(PARSED, "_summary.json"), { force: true });

  // The parse script stamps "now" and cannot know family sharing. Pin the
  // stamp and add what scripts/fetch-owned-games.ts would have written.
  const playedPath = path.join(PARSED, "games-played.json");
  const played = JSON.parse(fs.readFileSync(playedPath, "utf8")) as {
    games: { appId: number; fromFamily?: boolean }[];
    [k: string]: unknown;
  };
  const family = new Set(G.filter((g) => g.family).map((g) => g.id));
  played.source = "steam-session-api";
  played.fetchedAt = FETCHED_AT;
  played.games = played.games.map((g) => ({ ...g, fromFamily: family.has(g.appId) }));
  write(playedPath, json(played));
  // Re-serialise the others with a trailing newline for stable diffs.
  for (const f of fs.readdirSync(PARSED)) {
    const p = path.join(PARSED, f);
    write(p, json(JSON.parse(fs.readFileSync(p, "utf8"))));
  }

  // 3. data/ caches
  const quotes: Record<string, unknown> = {};
  const quote = (title: string, id: number, cur: number | null, low: number | null, retail: number | null) => ({
    title,
    steamAppId: id,
    itadId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    lowestUsd: null,
    currentUsd: null,
    currentInr: cur,
    lowestInr: low,
    retailInr: retail,
    retailUsd: null,
    onSale: cur != null && retail != null && cur < retail,
    source: low != null ? "steam+itad" : "steam",
    updatedAt: PRICES_AT,
    itadCheckedAt: PRICES_AT,
  });
  for (const g of G) {
    if (!g.price) continue;
    quotes[normTitle(g.name)] = quote(g.name, g.id, g.price.cur, g.price.low, g.price.retail);
  }
  for (const e of EXTRA_QUOTES) {
    quotes[normTitle(e.title)] = quote(e.title, e.id, e.cur, e.low, e.retail);
  }
  write(
    path.join(DATA, "price-cache.json"),
    json({ updatedAt: PRICES_AT, country: "IN", currency: "INR", quotes }),
  );

  const quoteIds = [
    ...new Set([
      ...G.filter((g) => g.price).map((g) => g.id),
      ...EXTRA_QUOTES.map((e) => e.id),
    ]),
  ];
  write(
    path.join(DATA, "dlc-parents.json"),
    json({
      updatedAt: PRICES_AT,
      parents: { "9000101": 9000001 },
      notDlc: quoteIds.filter((id) => id !== 9000101).map(String),
    }),
  );

  const byAppId: Record<string, unknown> = {};
  const artFor = (title: string, hue: number) => ({
    library: art(title, hue, 600, 900),
    header: art(title, hue, 460, 215),
    capsule: art(title, hue, 231, 87),
    hashed: true,
    updatedAt: PRICES_AT,
  });
  for (const g of G) byAppId[String(g.id)] = artFor(g.name, g.hue);
  for (const e of EXTRA_QUOTES) {
    if (!byAppId[String(e.id)]) byAppId[String(e.id)] = artFor(e.title, e.hue);
  }
  write(
    path.join(DATA, "artwork-cache.json"),
    json({ version: 2, updatedAt: PRICES_AT, byAppId }),
  );

  write(
    path.join(DATA, "gifts-received.json"),
    json({
      updatedAt: "2026-10-01T09:00:00.000Z",
      lastMailSyncedAt: "2026-10-01T09:00:00.000Z",
      gifts: [
        {
          title: "Pocket Cartographer",
          fromPersona: "juniper_fox",
          subject: "You've received a gift copy of the game Pocket Cartographer on Steam",
          receivedAt: "2022-12-24T08:12:00.000Z",
          source: "gmail",
          importedAt: "2026-10-01T09:00:00.000Z",
        },
      ],
    }),
  );

  write(
    path.join(DATA, "itad-credentials.json"),
    json({ apiKey: CANARY_ITAD_KEY, appName: "steam-stats", updatedAt: "2026-01-01T00:00:00.000Z" }),
  );

  // 4. Canary session cookie — must never be read offline, never leak
  write(
    path.join(ROOT, ".steam-session", "storage-state.json"),
    json({
      cookies: [
        {
          name: "steamLoginSecure",
          value: `${STEAM_ID}%7C%7C${CANARY_STEAM_TOKEN}`,
          domain: "store.steampowered.com",
          path: "/",
        },
      ],
      origins: [],
    }),
  );

  console.log(
    `\nlibrary-a: ${G.length} titles (${G.filter((g) => g.minutes != null).length} in the playtime snapshot), ${ROWS.length} purchase rows, ${licences().length} licences, ${Object.keys(quotes).length} quotes`,
  );
}

main();
