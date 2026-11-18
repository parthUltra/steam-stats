import type { DashboardPayload } from "@/lib/analytics/contracts";
import type { DataNote } from "@/components/value/DataNotice";
import { formatDay } from "@/components/value/format";
import { giftTitlesMatch } from "@/components/value/gift-titles";

function sample(titles: string[], n = 3): string {
  const head = titles.slice(0, n).join(", ");
  return titles.length > n ? `${head} and ${titles.length - n} more` : head;
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

const REFETCH = "Run npm run fetch:account-data to fetch it again.";

const SOURCE_NAME = {
  purchases: "Purchase history",
  licenses: "Licence list",
  accountSpend: "Account spend page",
} as const;

const STATUS_PHRASE: Record<string, string> = {
  partial: "is only partly fetched",
  "login-required": "needs a re-fetch (Steam asked for a login)",
  unrecognized: "needs a re-fetch (saved page not recognised)",
  missing: "has not been fetched",
};

const REPARSE = "Run npm run parse:account-data to parse the saved pages again.";

const SOURCE_IMPACT = {
  purchases:
    "Paid, spend over time and cost per hour are built from it, so all of them may run low.",
  licenses:
    "Free, gifted and complimentary titles are identified from it, so some shelf titles may be unclassified.",
  accountSpend:
    "Steam's own lifetime total is missing, so paid cannot be cross-checked against it.",
} as const;

const ISSUE_LABEL: Record<string, string> = {
  "price-cache-unreadable": "Price cache is unreadable",
  "received-gifts-unreadable": "Received gifts file is unreadable",
};

/**
 * Data gaps the payload can prove today. Every note is derived from a field
 * that says something is missing; nothing here is inferred from the clock.
 */
export function buildDataNotes(
  data: DashboardPayload,
  opts: {
    itadConnected: boolean;
    lows: { latest: number; total: number } | null;
  },
): { totals: DataNote[]; costPerHour: DataNote[]; gifts: DataNote[] } {
  const { valuation, meta, costPerHour } = data;
  const totals: DataNote[] = [];

  // Same shelf rows as the summary's "N of M shelf titles priced".
  const unpriced = valuation.shelfUnpricedTitles ?? valuation.unresolvedTitles ?? [];
  const unpricedCount = valuation.shelfTitlesUnpriced ?? unpriced.length;
  if (unpricedCount > 0) {
    totals.push({
      id: "unpriced",
      label: `${plural(unpricedCount, "shelf title has", "shelf titles have")} no store price`,
      detail: `Shelf now and lowest leave ${unpricedCount === 1 ? "it" : "them"} out, so both totals run low${
        unpriced.length ? `: ${sample(unpriced)}` : ""
      }.`,
    });
  }

  if (!meta.priceCacheUpdatedAt) {
    totals.push({
      id: "no-quotes",
      label: "No market quotes yet",
      detail: "Shelf now and lowest stay empty until the first price refresh finishes.",
    });
  }

  if (!opts.itadConnected) {
    totals.push({
      id: "no-lows",
      label: "Store lows are not connected",
      detail:
        "Lowest uses shelf now wherever an all-time low is unknown, so it overstates the floor.",
      fix: "Use Get store lows to add an IsThereAnyDeal key.",
    });
  } else if (opts.lows && opts.lows.total > 0 && opts.lows.latest < opts.lows.total) {
    const missing = opts.lows.total - opts.lows.latest;
    totals.push({
      id: "lows-filling",
      label: `${plural(missing, "store low is", "store lows are")} older than a week`,
      detail:
        "Lowest uses the stored low where there is one and shelf now where there is none, until this week's refresh completes.",
    });
  }

  // Fields below are newer than some cached payloads: read them defensively.
  const ownedWithoutRecord = meta.ownedWithoutRecordCount ?? 0;
  if (ownedWithoutRecord > 0) {
    totals.push({
      id: "no-ownership-record",
      label: `${plural(ownedWithoutRecord, "owned title has", "owned titles have")} no ownership record yet`,
      detail:
        "They have no licence, purchase or gift record, so they cannot be counted as paid, free or gifted. This usually means the licence list or purchase history is incomplete.",
      fix: REFETCH,
    });
  }

  // Files written by an older parser: one line, whatever the number of sources.
  if (meta.needsReparse) {
    totals.push({
      id: "needs-reparse",
      label: "Saved Account Data needs a re-parse",
      detail:
        "The parsed files predate completeness tracking, so nothing says whether purchase history and the licence list are complete. The numbers shown are what those files hold.",
      fix: REPARSE,
    });
  }

  const status = meta.sourceStatus ?? null;
  for (const id of ["purchases", "licenses", "accountSpend"] as const) {
    const state = status?.[id];
    if (!state || state.status === "ok") continue;
    // Covered by the single re-parse note above.
    if ((state.status as string) === "unknown") continue;
    const coverage =
      id === "licenses" && state.coverage && state.coverage.recordsTotal > 0
        ? ` The saved pages cover ${state.coverage.recordsCovered} of ${state.coverage.recordsTotal} licence records.`
        : "";
    const fetched =
      id === "accountSpend" && meta.accountSpendFetchedAt
        ? ` Last fetched ${formatDay(meta.accountSpendFetchedAt)}.`
        : "";
    totals.push({
      id: `source-${id}`,
      label: `${SOURCE_NAME[id]} ${STATUS_PHRASE[state.status] ?? "is incomplete"}`,
      detail: `${SOURCE_IMPACT[id]}${coverage}${state.detail && !coverage ? ` (${state.detail}.)` : ""}${fetched}`,
      fix: REFETCH,
    });
  }
  // Older payloads have no source status: fall back to the missing total itself.
  if (!status && valuation.valveTotalSpend == null) {
    totals.push({
      id: "no-account-spend",
      label: "Account spend page not captured",
      detail: SOURCE_IMPACT.accountSpend,
      fix: REFETCH,
    });
  }


  // Unreadable files outrank every other note.
  for (const issue of meta.dataIssues ?? []) {
    totals.unshift({
      id: `issue-${issue.code}`,
      label: ISSUE_LABEL[issue.code] ?? "A cache file is unreadable",
      detail: issue.message,
    });
  }

  const cph: DataNote[] = [];
  const paidOnShelf = valuation.games.filter(
    (g) => g.kind !== "gifted_by_me" && g.paid != null && g.paid > 0,
  ).length;
  const inTable = costPerHour.playedPaid.length + costPerHour.unplayedPaid.length;
  if (paidOnShelf > inTable) {
    cph.push({
      id: "cph-left-out",
      label: `${plural(paidOnShelf - inTable, "paid title is", "paid titles are")} not in this table`,
      detail:
        "Bundles, edition packs rolled into their base game, and titles with no playtime record have no cost per hour.",
    });
  }

  const gifts: DataNote[] = [];
  const received = valuation.giftsReceivedGames ?? [];
  const unmatched = (meta.mailGifts ?? []).filter(
    (m) => !received.some((g) => giftTitlesMatch(g.title, m.title)),
  );
  if (unmatched.length > 0) {
    gifts.push({
      id: "gifts-unmatched",
      label: `${plural(unmatched.length, "Gmail gift is", "Gmail gifts are")} not matched to a library title`,
      detail: `They are listed without a value and are not in the worth-today total: ${sample(unmatched.map((m) => m.title))}.`,
    });
  }
  const unpricedGifts = received.filter(
    (g) => !(g.current != null && g.current > 0) && !(g.lowest != null && g.lowest > 0),
  );
  if (unpricedGifts.length > 0) {
    gifts.push({
      id: "gifts-unpriced",
      label: `${plural(unpricedGifts.length, "received gift has", "received gifts have")} no store price`,
      detail: `Worth today leaves them out: ${sample(unpricedGifts.map((g) => g.title))}.`,
    });
  }

  return { totals, costPerHour: cph, gifts };
}
