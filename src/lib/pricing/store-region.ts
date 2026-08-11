import type { PurchaseHistoryRow } from "@/lib/account-data/parsers";
import { loadLocalAccountData } from "@/lib/data/load-local";

/** Steam / ITAD store region for shelf pricing. */
export type StoreRegion = {
  /** ISO 3166-1 alpha-2 (Steam `cc` / ITAD `country`) */
  country: string;
  /** ISO 4217 — wallet / store currency for local quotes */
  currency: string;
  source: "spend-currency" | "login-history" | "cache" | "default";
};

/** Wallet currency → preferred Steam country when logins don’t decide. */
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: "US",
  INR: "IN",
  GBP: "GB",
  CAD: "CA",
  AUD: "AU",
  NZD: "NZ",
  EUR: "DE",
  BRL: "BR",
  ARS: "AR",
  CLP: "CL",
  COP: "CO",
  MXN: "MX",
  PEN: "PE",
  UYU: "UY",
  RUB: "RU",
  UAH: "UA",
  KZT: "KZ",
  TRY: "TR",
  PLN: "PL",
  CZK: "CZ",
  HUF: "HU",
  RON: "RO",
  SEK: "SE",
  NOK: "NO",
  DKK: "DK",
  CHF: "CH",
  JPY: "JP",
  KRW: "KR",
  CNY: "CN",
  TWD: "TW",
  HKD: "HK",
  SGD: "SG",
  MYR: "MY",
  THB: "TH",
  PHP: "PH",
  IDR: "ID",
  VND: "VN",
  ZAR: "ZA",
  AED: "AE",
  SAR: "SA",
  ILS: "IL",
  QAR: "QA",
  KWD: "KW",
};

const COUNTRY_TO_CURRENCY: Record<string, string> = Object.fromEntries(
  Object.entries(CURRENCY_TO_COUNTRY).map(([cur, cc]) => [cc, cur]),
);

/** Euro-zone (and EUR-priced) Steam countries — prefer login mode over DE default. */
const EUR_COUNTRIES = new Set([
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
]);

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  india: "IN",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  "great britain": "GB",
  england: "GB",
  germany: "DE",
  france: "FR",
  canada: "CA",
  australia: "AU",
  brazil: "BR",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  china: "CN",
  russia: "RU",
  poland: "PL",
  netherlands: "NL",
  spain: "ES",
  italy: "IT",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  turkey: "TR",
  "saudi arabia": "SA",
  "united arab emirates": "AE",
  singapore: "SG",
  "hong kong": "HK",
  taiwan: "TW",
  thailand: "TH",
  "new zealand": "NZ",
  mexico: "MX",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  ukraine: "UA",
  israel: "IL",
  "south africa": "ZA",
  indonesia: "ID",
  malaysia: "MY",
  philippines: "PH",
  vietnam: "VN",
  switzerland: "CH",
  austria: "AT",
  belgium: "BE",
  portugal: "PT",
  ireland: "IE",
  "czech republic": "CZ",
  czechia: "CZ",
  hungary: "HU",
  romania: "RO",
};

export function normalizeCountryCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const key = trimmed.toLowerCase().replace(/\s+/g, " ");
  return COUNTRY_NAME_TO_CODE[key] ?? null;
}

export function currencyForCountry(country: string): string {
  const cc = country.toUpperCase();
  if (EUR_COUNTRIES.has(cc)) return "EUR";
  return COUNTRY_TO_CURRENCY[cc] ?? "USD";
}

export function countryForCurrency(
  currency: string,
  loginCountries: string[] = [],
): string | null {
  const cur = currency.trim().toUpperCase();
  if (!cur) return null;
  if (cur === "EUR") {
    const euroLogins = loginCountries.filter((c) => EUR_COUNTRIES.has(c));
    if (euroLogins.length) return mode(euroLogins) ?? "DE";
    return "DE";
  }
  return CURRENCY_TO_COUNTRY[cur] ?? null;
}

function mode(values: string[]): string | null {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) {
      best = v;
      bestN = n;
    }
  }
  return best;
}

export function pickSpendCurrency(
  purchases: PurchaseHistoryRow[],
): string | null {
  const counts = new Map<string, number>();
  for (const p of purchases) {
    const cur =
      p.total?.currencyHint?.trim().toUpperCase() ||
      p.price?.currencyHint?.trim().toUpperCase() ||
      "";
    if (!cur || cur.length !== 3) continue;
    counts.set(cur, (counts.get(cur) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [c, n] of counts) {
    if (n > bestN) {
      best = c;
      bestN = n;
    }
  }
  return best;
}

export function detectStoreRegion(input: {
  loginCountries?: Array<string | null | undefined>;
  spendCurrency?: string | null;
  cachedCountry?: string | null;
  cachedCurrency?: string | null;
}): StoreRegion {
  const logins = (input.loginCountries ?? [])
    .map((c) => normalizeCountryCode(c))
    .filter((c): c is string => Boolean(c));

  const spendCur = input.spendCurrency?.trim().toUpperCase() || null;
  if (spendCur) {
    const fromSpend = countryForCurrency(spendCur, logins);
    if (fromSpend) {
      return {
        country: fromSpend,
        currency: spendCur === "EUR" ? "EUR" : currencyForCountry(fromSpend),
        source: "spend-currency",
      };
    }
  }

  const loginMode = mode(logins);
  if (loginMode) {
    return {
      country: loginMode,
      currency: currencyForCountry(loginMode),
      source: "login-history",
    };
  }

  const cachedCc = normalizeCountryCode(input.cachedCountry);
  if (cachedCc) {
    return {
      country: cachedCc,
      currency:
        input.cachedCurrency?.trim().toUpperCase() ||
        currencyForCountry(cachedCc),
      source: "cache",
    };
  }

  return { country: "US", currency: "USD", source: "default" };
}

export function storeRegionLabel(country: string): string {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(country.toUpperCase()) ?? country.toUpperCase();
  } catch {
    return country.toUpperCase();
  }
}

/** Resolve region from Account Data purchases + login history. */
export async function resolveStoreRegionFromAccount(opts?: {
  cachedCountry?: string | null;
  cachedCurrency?: string | null;
  purchases?: PurchaseHistoryRow[];
  loginCountries?: string[];
}): Promise<StoreRegion> {
  let purchases = opts?.purchases;
  let loginCountries = opts?.loginCountries;
  if (!purchases || loginCountries == null) {
    const bundle = await loadLocalAccountData().catch(() => null);
    purchases = purchases ?? bundle?.purchases;
    loginCountries =
      loginCountries ?? bundle?.loginHistory.map((r) => r.country) ?? [];
  }
  const spendCurrency = purchases ? pickSpendCurrency(purchases) : null;
  return detectStoreRegion({
    loginCountries: loginCountries ?? [],
    spendCurrency,
    cachedCountry: opts?.cachedCountry ?? null,
    cachedCurrency: opts?.cachedCurrency ?? null,
  });
}
