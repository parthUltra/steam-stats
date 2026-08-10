import type { LicenseRow, PurchaseHistoryRow } from "@/lib/account-data";
import {
  isGiftPurchase,
  isGiftReceivedLicense,
  isOwnedLibraryLicense,
  isTemporaryLibraryLicense,
  isTrackableGamePurchase,
} from "@/lib/analytics/spending";

/** How this title relates to your wallet / shelf. */
export type AcquisitionKind =
  | "purchased"
  | "bundle"
  | "gifted_to_me"
  | "free"
  | "ownership_grant"
  | "unknown_unpaid"
  | "gifted_by_me";

export function normTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isGiftCardName(name: string) {
  return /gift card/i.test(name);
}

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

/** Rest after a shared prefix is only edition/pack noise (not a sequel number). */
function isEditionRest(rest: string): boolean {
  const trimmed = rest.trim();
  if (!trimmed) return true;
  // "Game + DLC" style checkout lines
  if (/^\+/.test(trimmed)) return true;
  const r = trimmed.replace(/^[\s:+|–—-]+/, "").trim();
  if (!r) return true;
  // Sequels: "II", "2", "Episode 1", etc.
  if (/^(i{1,3}|iv|vi{0,3}|ix|\d+)\b/i.test(r)) return false;
  if (/^(episode|part|chapter)\b/i.test(r)) return false;
  return /^(game of the year(?: edition)?|goty(?: edition)?|definitive(?: edition)?|enhanced(?: edition)?|complete(?: edition)?|remastered|hd(?: remaster| edition)?|launch(?: edition)?|standard(?: edition)?|deluxe(?: edition)?|ultimate(?: edition)?|gold(?: edition)?|premium(?: edition)?|director'?s cut|vr(?: edition)?|game of the yorha(?: edition)?)\b/i.test(
    r,
  );
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

export function isComplimentaryKeptLicense(license: LicenseRow): boolean {
  if (isTemporaryLibraryLicense(license)) return false;
  const method = (license.acquisitionMethod || "").toLowerCase();
  return method.includes("complimentary");
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
export function lookupPaidForTitle(
  title: string,
  paidByExact: Map<string, number>,
  purchases: PurchaseHistoryRow[],
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

  // Collection / bundle rows: mark coverage without attributing full pack price
  // to every included title (that would inflate shelf cost basis).
  for (const row of [...purchases].reverse()) {
    if (isGiftPurchase(row) || row.refunded) continue;
    if (!isTrackableGamePurchase(row)) continue;

    const names = row.lineItems?.length
      ? row.lineItems
          .filter((l) => l.amount != null && l.amount >= 0 && !isGiftCardName(l.name))
          .map((l) => l.name)
      : row.items.filter((i) => !isGiftCardName(i));

    for (const name of names) {
      if (packCoversTitle(name, title)) {
        return {
          amount: 0,
          via: "bundle",
          coveredBy: name,
        };
      }
    }
  }

  return { amount: null, via: "none" };
}

export function isLikelyFreeToPlay(
  title: string,
  opts?: { currentPrice?: number | null; retailPrice?: number | null },
): boolean {
  if (/\bfree to play\b|\bf2p\b/i.test(title)) return true;
  const cur = opts?.currentPrice;
  const retail = opts?.retailPrice;
  // Live + list at 0 → F2P / free claim still listed free
  if (cur === 0 && (retail == null || retail === 0)) return true;
  return false;
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
  priceHint?: { current: number | null; retail: number | null };
};

export type ClassifyResult = {
  kind: AcquisitionKind;
  paid: number | null;
  note?: string;
};

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

  // 1a) Steam still lists a Gift/Guest Pass license
  for (const lic of licenses) {
    if (!isGiftReceivedLicense(lic)) continue;
    if (!titlesSoftMatch(lic.item, title) && normTitle(lic.item) !== key) continue;
    return { kind: "gifted_to_me", paid: 0, note: "Steam Gift/Guest Pass" };
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
  const paid = lookupPaidForTitle(title, paidByExact, purchases);
  if (paid.via === "bundle") {
    return {
      kind: "bundle",
      paid: 0,
      note: paid.coveredBy ? `Included in ${paid.coveredBy}` : "Bundle / collection",
    };
  }
  if (paid.amount != null && paid.amount > 0) {
    return {
      kind: "purchased",
      paid: paid.amount,
      note: paid.via === "soft" && paid.coveredBy ? `Matched ${paid.coveredBy}` : undefined,
    };
  }

  // 3) Complimentary keep (free claim that stayed) — also match promo package
  // names onto the base game when you still own/play it.
  for (const lic of licenses) {
    const method = (lic.acquisitionMethod || "").toLowerCase();
    if (!method.includes("complimentary")) continue;
    const raw = lic.item.trim();
    const base = raw
      .replace(/\s*[-–—]?\s*limited free promotional package.*$/i, "")
      .replace(/\s*[-–—]?\s*free weekend.*$/i, "")
      .replace(/\s*[-–—]?\s*free on demand.*$/i, "")
      .replace(/\s+playtest.*$/i, "")
      .trim();
    if (
      titlesSoftMatch(raw, title) ||
      titlesSoftMatch(base, title) ||
      normTitle(raw) === key ||
      normTitle(base) === key
    ) {
      return {
        kind: "free",
        paid: 0,
        note: isTemporaryLibraryLicense(lic)
          ? "Claimed free promo / complimentary"
          : "Complimentary license",
      };
    }
  }

  // 4) Free-to-play / free store listing
  if (
    isLikelyFreeToPlay(title, {
      currentPrice: priceHint?.current ?? null,
      retailPrice: priceHint?.retail ?? null,
    })
  ) {
    return { kind: "free", paid: 0, note: "Free to play / free listing" };
  }

  // License says Steam Store / Retail but no purchase row matched — still not a gift
  const storeLic = licenses.find(
    (l) =>
      isOwnedLibraryLicense(l) &&
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
        const otherPaid = lookupPaidForTitle(other, paidByExact, purchases);
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
  if (ownedKeys.has(key) || licenses.some((l) => isOwnedLibraryLicense(l) && titlesSoftMatch(l.item, title))) {
    return {
      kind: "unknown_unpaid",
      paid: 0,
      note: "Owned with no matching purchase — gift, key, or incomplete history",
    };
  }

  return { kind: "purchased", paid: paid.amount };
}
