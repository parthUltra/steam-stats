import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";
import {
  isGiftPurchase,
  isGiftReceivedLicense,
  isKeptGameItem,
  isOwnedLibraryLicense,
  isTemporaryLibraryLicense,
  isTrackableGamePurchase,
} from "@/lib/analytics/spending";
import { isoLocalDate, parseSteamDate } from "@/lib/dates";
import { isSequelRemainder, normTitle } from "@/lib/titles";

// Re-exported: the gifts and stats modules import the normaliser from here.
export { normTitle };

/** How this title relates to your wallet / shelf. */
export type AcquisitionKind =
  | "purchased"
  | "bundle"
  | "gifted_to_me"
  | "free"
  | "ownership_grant"
  | "unknown_unpaid"
  | "gifted_by_me";

/** Strip edition / pack noise for soft matching. */
export function stripEditionNoise(title: string) {
  return normTitle(title)
    .replace(
      /\b(game of the year(?: edition)?|goty(?: edition)?|definitive edition|enhanced edition|complete edition|remastered|hd remaster|hd edition|launch edition|standard edition|deluxe edition|ultimate edition|gold edition|premium edition|director'?s cut|game of the yorha(?: edition)?)\b/g,
      " ",
    )
    .replace(/\b(the )?(collection|bundle|complete pack|pack)\b/g, " ")
    .replace(/[+|:–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isPackPurchaseName(title: string) {
  return /\b(collection|bundle|complete pack|multi-?pack|\d+\s*-?\s*packs?)\b/i.test(
    title,
  );
}

/** Franchise stem for pack titles — e.g. "bioshock the collection" → "bioshock". */
export function packFranchiseStem(title: string) {
  const n = normTitle(title)
    .replace(/\b(the )?(collection|bundle|complete pack|pack)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Prefer first 1–3 meaningful tokens
  const tokens = n.split(" ").filter((t) => t.length > 1 && t !== "and");
  if (!tokens.length) return "";
  if (tokens.length === 1) return tokens[0];
  // "batman arkham" from "batman arkham collection"
  return tokens.slice(0, Math.min(3, tokens.length)).join(" ");
}

/**
 * The whole remainder is an edition label — nothing after it. "Deluxe Edition"
 * is an edition; "Deluxe Edition Upgrade", "Deluxe Kit", "HD Texture Pack" and
 * "Complete Soundtrack" are other products. A "VR Edition" is an edition; a
 * bare "VR" title (Fallout 4 VR, SUPERHOT VR) is a separate game.
 */
const EDITION_LABEL =
  /^(?:vr edition|(?:game of the year|goty|definitive|enhanced|complete|remastered|hd remaster|hd|launch|standard|deluxe|ultimate|gold|premium|director'?s cut|game of the yorha)(?: edition)?)$/i;

/** Rest after a shared prefix is only edition/pack noise (not a sequel number). */
function isEditionRest(rest: string): boolean {
  const trimmed = rest.trim();
  if (!trimmed) return true;
  // "Game + DLC" style checkout lines
  if (/^\+/.test(trimmed)) return true;
  const r = trimmed.replace(/^[\s:+|–—-]+/, "").trim();
  if (!r) return true;
  // Sequels: "II", "2", "Episode 1", etc.
  if (isSequelRemainder(r)) return false;
  return EDITION_LABEL.test(r);
}

export function titlesSoftMatch(a: string, b: string): boolean {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (longer.startsWith(shorter) && isEditionRest(longer.slice(shorter.length))) {
    return true;
  }

  const sa = stripEditionNoise(a);
  const sb = stripEditionNoise(b);
  if (sa.length >= 5 && sb.length >= 5) {
    if (sa === sb) return true;
    const [sShort, sLong] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
    if (sLong.startsWith(sShort) && isEditionRest(sLong.slice(sShort.length))) {
      return true;
    }
  }
  return false;
}

/** Pack/collection purchase covers a library title (BioShock Collection → Remastered). */
export function packCoversTitle(packTitle: string, gameTitle: string): boolean {
  if (!isPackPurchaseName(packTitle)) return false;
  if (titlesSoftMatch(packTitle, gameTitle)) return true;
  const stem = packFranchiseStem(packTitle);
  if (stem.length < 4) return false;
  const g = normTitle(gameTitle);
  if (g === stem || g.startsWith(`${stem} `) || g.startsWith(`${stem}:`)) return true;
  // Avoid tiny stems matching everything
  const stemTokens = stem.split(" ");
  if (stemTokens.length >= 2 && g.includes(stem)) return true;
  return false;
}

export function isUpgradeGrantTitle(title: string): boolean {
  return /\b(remastered|hd remaster|definitive edition|enhanced edition|complete edition|vr edition)\b/i.test(
    title,
  );
}

export type PaidLookup = {
  amount: number | null;
  /** How the wallet row was matched */
  via: "exact" | "soft" | "bundle" | "none";
  /** Purchase line / item name that covered this title */
  coveredBy?: string;
};

/**
 * Resolve cost basis for a library title, including soft matches and
 * collection/bundle checkouts that list the pack name instead of each game.
 */
export type AcquisitionIndex = {
  giftLicenses: LicenseRow[];
  complimentaryLicenses: LicenseRow[];
  ownedLicenses: LicenseRow[];
  packNames: string[];
};

/** Scan licenses / purchases once, then classify each title against the index. */
export function buildAcquisitionIndex(
  licenses: LicenseRow[],
  purchases: PurchaseHistoryRow[],
): AcquisitionIndex {
  const giftLicenses: LicenseRow[] = [];
  const complimentaryLicenses: LicenseRow[] = [];
  const ownedLicenses: LicenseRow[] = [];
  for (const lic of licenses) {
    if (isGiftReceivedLicense(lic)) giftLicenses.push(lic);
    if ((lic.acquisitionMethod || "").toLowerCase().includes("complimentary")) {
      complimentaryLicenses.push(lic);
    }
    if (isOwnedLibraryLicense(lic)) ownedLicenses.push(lic);
  }

  const packNames: string[] = [];
  for (const row of purchases) {
    if (isGiftPurchase(row) || row.refunded) continue;
    if (!isTrackableGamePurchase(row)) continue;
    const names = row.lineItems?.length
      ? row.lineItems
          .filter(
            (l) =>
              l.amount != null && l.amount >= 0 && isKeptGameItem(row, l.name),
          )
          .map((l) => l.name)
      : row.items.filter((i) => isKeptGameItem(row, i));
    for (const name of names) {
      if (isPackPurchaseName(name)) packNames.push(name);
    }
  }

  return { giftLicenses, complimentaryLicenses, ownedLicenses, packNames };
}

export function lookupPaidForTitle(
  title: string,
  paidByExact: Map<string, number>,
  packNames: string[],
): PaidLookup {
  const key = normTitle(title);
  if (paidByExact.has(key)) {
    return { amount: paidByExact.get(key)!, via: "exact" };
  }

  let bestSoft: { amount: number; otherKey: string; len: number } | null = null;
  for (const [otherKey, amount] of paidByExact) {
    // Pack rows are handled below — soft-matching them would stamp the full
    // collection price onto every franchise title.
    if (isPackPurchaseName(otherKey) || isPackPurchaseName(title)) continue;
    if (!titlesSoftMatch(title, otherKey)) continue;
    const len = Math.min(key.length, otherKey.length);
    if (!bestSoft || len > bestSoft.len) {
      bestSoft = { amount, otherKey, len };
    }
  }
  if (bestSoft) {
    return { amount: bestSoft.amount, via: "soft", coveredBy: bestSoft.otherKey };
  }

  for (const name of packNames) {
    if (packCoversTitle(name, title)) {
      return {
        amount: 0,
        via: "bundle",
        coveredBy: name,
      };
    }
  }

  return { amount: null, via: "none" };
}

/**
 * Evidence that the store lists the title as free: its list price is 0, or it
 * says so in its name. A sale price of 0 with a non-zero list price is a
 * 100%-off promo, not free-to-play. No guessing from franchise names.
 *
 * This alone never overrides a real purchase — see `classifyAcquisition`.
 */
export function isLikelyFreeToPlay(
  title: string,
  opts?: {
    currentPrice?: number | null;
    retailPrice?: number | null;
    /** Steam appdetails `is_free` */
    storeIsFree?: boolean;
  },
): boolean {
  if (/\bfree to play\b|\bf2p\b/.test(normTitle(title))) return true;
  if (opts?.storeIsFree) return true;
  const cur = opts?.currentPrice;
  return opts?.retailPrice === 0 && (cur == null || cur === 0);
}

/** Drop "Free Trial" / "Guest Pass" suffixes so playtime names match license rows. */
export function stripTemporaryLicenseNoise(item: string): string {
  return item
    .replace(
      /\s*[-–—:]?\s*(free weekend|free on demand|limited free promotional package|guest pass|free pass|free trial|play first|open beta|closed beta|ea play|demo\b|playtest|temporary content).*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function licenseCoversTitle(license: LicenseRow, title: string): boolean {
  const key = normTitle(title);
  const item = license.item.trim();
  const base = stripTemporaryLicenseNoise(item);
  if (normTitle(item) === key || titlesSoftMatch(item, title)) return true;
  if (base.length < 3) return false;
  if (normTitle(base) === key || titlesSoftMatch(base, title)) return true;
  // The playtime name can carry the suffix too ("Hamsteria Playtest")
  const titleBase = stripTemporaryLicenseNoise(title);
  return titleBase.length >= 3 && normTitle(titleBase) === normTitle(base);
}

/**
 * Free claims you keep for good: a giveaway ("Limited Free Promotional
 * Package") or a free-to-play game ("Free On Demand"). The package wording
 * looks temporary; the licence is not.
 */
export function isFreeToKeepLicense(license: LicenseRow): boolean {
  if (!/limited free promotional package|free on demand/i.test(license.item)) {
    return false;
  }
  return !/\bfamily (sharing|library)\b/i.test(license.acquisitionMethod || "");
}

/**
 * Playtime is not ownership — but a missing licence row is not evidence
 * either (the licence scrape only reaches back a few months). A title is left
 * out of Value only on positive evidence: every licence covering it is a
 * trial / free pass / free weekend / demo, and nothing shows it was bought or
 * gifted. Family-shared titles are dropped by the caller on `fromFamily`.
 */
export function isKeptPlaytimeTitleForValuation(
  title: string,
  licenses: LicenseRow[],
  purchases: PurchaseHistoryRow[],
  mailGiftTitles: string[] = [],
): boolean {
  const covering = licenses.filter((l) => licenseCoversTitle(l, title));
  if (covering.some((l) => isOwnedLibraryLicense(l) || isFreeToKeepLicense(l))) {
    return true;
  }
  // No licence says anything about it → owned until shown otherwise
  if (covering.length === 0) return true;

  // Only temporary licences cover it: owned only if bought or gifted
  return hasPurchaseOrGiftRecord(title, purchases, mailGiftTitles);
}

/**
 * Something on record says how the title was acquired: a kept licence
 * (bought, gifted, complimentary, free-to-keep claim), a purchase row, or an
 * imported gift e-mail. False for a title that is in the library with none of
 * these — typically because the licence list or purchase history is incomplete.
 */
export function hasOwnershipRecord(
  title: string,
  licenses: LicenseRow[],
  purchases: PurchaseHistoryRow[],
  mailGiftTitles: string[] = [],
): boolean {
  return (
    licenses.some(
      (l) =>
        (isOwnedLibraryLicense(l) || isFreeToKeepLicense(l)) &&
        licenseCoversTitle(l, title),
    ) || hasPurchaseOrGiftRecord(title, purchases, mailGiftTitles)
  );
}

function hasPurchaseOrGiftRecord(
  title: string,
  purchases: PurchaseHistoryRow[],
  mailGiftTitles: string[],
): boolean {
  const key = normTitle(title);
  if (
    mailGiftTitles.some(
      (g) => normTitle(g) === key || titlesSoftMatch(g, title),
    )
  ) {
    return true;
  }

  for (const row of purchases) {
    if (row.refunded || isGiftPurchase(row)) continue;
    if (!isTrackableGamePurchase(row)) continue;
    const names = row.lineItems?.length
      ? row.lineItems.map((l) => l.name)
      : row.items;
    for (const name of names) {
      if (!isKeptGameItem(row, name)) continue;
      if (normTitle(name) === key || titlesSoftMatch(name, title)) return true;
      if (packCoversTitle(name, title)) return true;
    }
  }
  return false;
}

/** Owned playtime titles that belong on the Value shelf (not family / trials). */
export function playtimeTitlesForValuation(
  games: { name: string; fromFamily?: boolean }[],
  licenses: LicenseRow[],
  purchases: PurchaseHistoryRow[],
  mailGiftTitles: string[] = [],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const g of games) {
    if (g.fromFamily) continue;
    const name = g.name.trim();
    if (!name) continue;
    const key = normTitle(name);
    if (seen.has(key)) continue;
    if (
      !isKeptPlaytimeTitleForValuation(
        name,
        licenses,
        purchases,
        mailGiftTitles,
      )
    ) {
      continue;
    }
    seen.add(key);
    out.push(name);
  }
  return out;
}

export type ClassifyInput = {
  title: string;
  licenses: LicenseRow[];
  purchases: PurchaseHistoryRow[];
  paidByExact: Map<string, number>;
  ownedKeys: Set<string>;
  /** Other library title keys (norm) already known paid / owned — for upgrade detection */
  libraryTitleKeys: string[];
  /** Titles imported from Steam gift emails (only reliable received-gift source) */
  mailGiftTitles?: string[];
  /** Optional persona per mail gift title (norm key → Steam name) */
  mailGiftSenders?: Map<string, string>;
  priceHint?: {
    current: number | null;
    retail: number | null;
    /** Steam appdetails `is_free`, when the price cache has it */
    isFree?: boolean;
  };
  /** Precomputed license/pack lists — build once per valuation. */
  index?: AcquisitionIndex;
};

export type ClassifyResult = {
  kind: AcquisitionKind;
  paid: number | null;
  note?: string;
  /**
   * How `paid` was found. "soft": the amount is another title's purchase line
   * (`coveredBy`, an edition / SKU of the same game) — the caller must count
   * it once, not on both rows.
   */
  paidVia?: PaidLookup["via"];
  /** Norm key of the purchase line that covers this title (soft / bundle). */
  coveredBy?: string;
  /** Gift from a Steam licence row: the licence date, "YYYY-MM-DD". */
  receivedAt?: string;
};

/**
 * Complimentary keep (free claim that stayed) — also matches promo package
 * names onto the base game when you still own / play it.
 */
function complimentaryKeep(
  title: string,
  complimentaryLicenses: LicenseRow[],
  opts: { exactOnly: boolean },
): ClassifyResult | null {
  const key = normTitle(title);
  for (const lic of complimentaryLicenses) {
    const raw = lic.item.trim();
    const base = raw
      .replace(/\s*[-–—]?\s*limited free promotional package.*$/i, "")
      .replace(/\s*[-–—]?\s*free weekend.*$/i, "")
      .replace(/\s*[-–—]?\s*free on demand.*$/i, "")
      .replace(/\s+playtest.*$/i, "")
      .trim();
    const exact = normTitle(raw) === key || normTitle(base) === key;
    const soft =
      !opts.exactOnly &&
      (titlesSoftMatch(raw, title) || titlesSoftMatch(base, title));
    if (!exact && !soft) continue;
    return {
      kind: "free",
      paid: 0,
      note: isTemporaryLibraryLicense(lic)
        ? "Claimed free promo / complimentary"
        : "Complimentary license",
    };
  }
  return null;
}

/**
 * Classify how a kept library title was acquired.
 * Received gifts: Steam Gift/Guest Pass licenses (current) and/or Gmail import (older).
 */
export function classifyAcquisition(input: ClassifyInput): ClassifyResult {
  const {
    title,
    licenses,
    purchases,
    paidByExact,
    ownedKeys,
    libraryTitleKeys,
    mailGiftTitles,
    mailGiftSenders,
    priceHint,
  } = input;
  const key = normTitle(title);
  const index =
    input.index ?? buildAcquisitionIndex(licenses, purchases);

  // 1a) Steam still lists a Gift/Guest Pass license
  for (const lic of index.giftLicenses) {
    if (!titlesSoftMatch(lic.item, title) && normTitle(lic.item) !== key) continue;
    const received = parseSteamDate(lic.dateText);
    return {
      kind: "gifted_to_me",
      paid: 0,
      note: "Steam Gift/Guest Pass",
      ...(received ? { receivedAt: isoLocalDate(received) } : {}),
    };
  }

  // 1b) Older gifts recovered from Gmail sync
  const mailHit = (mailGiftTitles ?? []).find(
    (g) => normTitle(g) === key || titlesSoftMatch(g, title),
  );
  if (mailHit) {
    const persona =
      mailGiftSenders?.get(normTitle(mailHit)) ||
      mailGiftSenders?.get(key);
    return {
      kind: "gifted_to_me",
      paid: 0,
      note: persona ? `Gift from ${persona} · Gmail` : "Imported from Gmail",
    };
  }

  // 2) Wallet / bundle coverage
  const paid = lookupPaidForTitle(title, paidByExact, index.packNames);
  if (paid.via === "bundle") {
    return {
      kind: "bundle",
      paid: 0,
      note: paid.coveredBy ? `Included in ${paid.coveredBy}` : "Bundle / collection",
    };
  }
  // A purchase row for exactly this title always wins: what you paid is what
  // you paid, even if the game later went free or is 100% off today.
  if (paid.via === "exact" && paid.amount != null && paid.amount > 0) {
    return { kind: "purchased", paid: paid.amount, paidVia: "exact" };
  }

  // 3) Free by evidence — a complimentary licence for this title, or the
  // store lists it free. This beats a soft match on another SKU's purchase
  // (a paid pack for a free-to-play game stays on the pack's own row).
  const softPaid = paid.amount != null && paid.amount > 0;
  const complimentary = complimentaryKeep(title, index.complimentaryLicenses, {
    // Against a (soft) wallet match the licence must name exactly this title
    exactOnly: softPaid,
  });
  if (complimentary) return complimentary;
  if (
    isLikelyFreeToPlay(title, {
      currentPrice: priceHint?.current ?? null,
      retailPrice: priceHint?.retail ?? null,
      storeIsFree: priceHint?.isFree,
    })
  ) {
    return { kind: "free", paid: 0, note: "Free to play / free listing" };
  }

  if (softPaid) {
    return {
      kind: "purchased",
      paid: paid.amount,
      paidVia: paid.via,
      coveredBy: paid.coveredBy,
      note: paid.coveredBy ? `Matched ${paid.coveredBy}` : undefined,
    };
  }

  // License says Steam Store / Retail but no purchase row matched — still not a gift
  const storeLic = index.ownedLicenses.find(
    (l) =>
      titlesSoftMatch(l.item, title) &&
      /steam store|retail/i.test(l.acquisitionMethod || ""),
  );
  if (storeLic && /retail/i.test(storeLic.acquisitionMethod || "")) {
    return {
      kind: "unknown_unpaid",
      paid: 0,
      note: "Retail / CD key license (no wallet row)",
    };
  }

  // 5) Ownership upgrade (remaster etc.) when a base/franchise title is already paid
  if (isUpgradeGrantTitle(title)) {
    const base = stripEditionNoise(title);
    if (base.length >= 4) {
      const hasPaidBase = libraryTitleKeys.some((other) => {
        if (other === key) return false;
        const otherBase = stripEditionNoise(other);
        if (!(otherBase === base || other.startsWith(base) || base.startsWith(otherBase))) {
          return false;
        }
        // Prefer evidence the base was paid / soft-paid
        const otherPaid = lookupPaidForTitle(other, paidByExact, index.packNames);
        return otherPaid.amount != null && otherPaid.amount > 0;
      });
      if (hasPaidBase) {
        return {
          kind: "ownership_grant",
          paid: 0,
          note: "Likely free upgrade for owning the base / pack",
        };
      }
    }
  }

  // 6) Owned with playtime (or license) but no wallet match — unknown, not a gift
  if (ownedKeys.has(key) || index.ownedLicenses.some((l) => titlesSoftMatch(l.item, title))) {
    return {
      kind: "unknown_unpaid",
      paid: 0,
      note: "Owned with no matching purchase — gift, key, or incomplete history",
    };
  }

  return { kind: "purchased", paid: paid.amount };
}
