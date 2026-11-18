"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { effectiveShelfLowestBestKnown } from "@/lib/analytics/valuation";
import { GmailSyncWizard } from "@/components/GmailSyncWizard";
import type { LowsProgress } from "@/components/DashboardClient";
import type { GmailSyncChrome } from "@/components/use-gmail-sync";
import type { ItadKeyChrome } from "@/components/use-itad-key";
import {
  moneyCompact,
  moneyFmt,
  moneyPerHourFmt,
} from "@/components/value/format";
import type { InspectMode } from "@/components/value/inspect-rows";
import { buildDataNotes } from "@/components/value/data-notes";
import { CostPerHourTable } from "@/components/value/CostPerHourTable";
import { DataNotice } from "@/components/value/DataNotice";
import { GiftsBoard } from "@/components/value/GiftsBoard";
import { ItadKeyDialog } from "@/components/value/ItadKeyDialog";
import { LedgerDetail } from "@/components/value/LedgerDetail";
import { LowsStatus } from "@/components/value/LowsStatus";
import { ShelfInspectModal } from "@/components/value/ShelfInspectModal";
import { SpendTimeline } from "@/components/value/SpendTimeline";
import { SummaryPanel } from "@/components/value/SummaryPanel";
import { PaidVsLow } from "@/components/stats/PaidVsLow";

const EXCLUDE_GIFTS_KEY = "steam-stats-exclude-received-gifts";
const PREFS_EVENT = "steam-stats:prefs";
/** Holds the choice for this page load when localStorage cannot be written. */
let excludeGiftsUnsaved: boolean | null = null;

function subscribeExcludeGifts(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(PREFS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PREFS_EVENT, onChange);
  };
}

function readExcludeGifts(): boolean {
  if (excludeGiftsUnsaved != null) return excludeGiftsUnsaved;
  try {
    return localStorage.getItem(EXCLUDE_GIFTS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeExcludeGifts(v: boolean) {
  try {
    localStorage.setItem(EXCLUDE_GIFTS_KEY, v ? "1" : "0");
    excludeGiftsUnsaved = null;
  } catch {
    excludeGiftsUnsaved = v;
  }
  window.dispatchEvent(new Event(PREFS_EVENT));
}

export function SpendingValue({
  data,
  onOpenGlossary,
  lowsProgress,
  gmail,
  itad,
}: {
  data: DashboardPayload;
  onOpenGlossary?: (termId?: string) => void;
  lowsProgress?: LowsProgress | null;
  gmail: GmailSyncChrome;
  itad: ItadKeyChrome;
}) {
  const { spending, valuation, recentPurchases, meta, costPerHour, artwork, playtime } =
    data;
  const currency = valuation.currency || spending.currency;
  const money = (n: number) => moneyFmt(n, currency);
  const moneyHr = (n: number) => moneyPerHourFmt(n, currency);
  const moneyAxis = (n: number) => moneyCompact(n, currency);
  const [inspectMode, setInspectMode] = useState<InspectMode | null>(null);
  const excludeReceivedGifts = useSyncExternalStore(
    subscribeExcludeGifts,
    readExcludeGifts,
    () => false,
  );
  const { gmailWizardOpen, setGmailWizardOpen, mailSyncing, syncGmail } = gmail;
  const {
    itadConnected,
    itadStep,
    itadError,
    itadStatus,
    lowsRefreshing,
    openItadExplain,
    refreshLowsNow,
  } = itad;

  const receivedGames = valuation.giftsReceivedGames ?? [];
  const sentGames = valuation.giftsSentGames ?? [];
  const mailGifts = meta.mailGifts ?? [];
  const hasReceivedGifts = receivedGames.length > 0 || mailGifts.length > 0;

  const titleCatalog = useMemo(
    () => [
      ...valuation.games.map((g) => ({
        title: g.title,
        steamAppId: g.steamAppId,
      })),
      ...playtime.games.map((g) => ({
        title: g.name,
        steamAppId: g.appId,
      })),
    ],
    [valuation.games, playtime.games],
  );

  const spent = valuation.librarySpent;
  const shelf =
    hasReceivedGifts && excludeReceivedGifts
      ? valuation.shelfExcludingReceivedGifts
      : valuation.shelfFull;

  const lowsCalibrating =
    !lowsProgress ||
    lowsProgress.total <= 0 ||
    lowsProgress.latest < lowsProgress.total;

  /** Titles behind the three totals: never gifts sent, optionally not gifts received. */
  const inspectGames = useMemo(() => {
    return valuation.games.filter((g) => {
      if (g.kind === "gifted_by_me") return false;
      if (
        hasReceivedGifts &&
        excludeReceivedGifts &&
        g.kind === "gifted_to_me"
      ) {
        return false;
      }
      return true;
    });
  }, [valuation.games, hasReceivedGifts, excludeReceivedGifts]);

  /** While weekly refresh incomplete: hist low or shelf-now. When done: stored lows only. */
  const displayedLowest = useMemo(() => {
    if (!lowsCalibrating) return shelf.lowest;
    let sum = 0;
    for (const g of inspectGames) {
      const v = effectiveShelfLowestBestKnown(g);
      if (v != null) sum += v;
    }
    return sum;
  }, [lowsCalibrating, shelf.lowest, inspectGames]);

  const notes = useMemo(
    () =>
      buildDataNotes(data, {
        itadConnected,
        lows: lowsProgress
          ? { latest: lowsProgress.latest, total: lowsProgress.total }
          : null,
      }),
    [data, itadConnected, lowsProgress],
  );

  return (
    <div className="value-tab">
      <SummaryPanel
        spent={spent}
        current={shelf.current}
        lowest={displayedLowest}
        money={money}
        purchaseCount={spending.purchaseCount}
        // The same counts the "no store price" note uses, so they always agree.
        titlesPriced={valuation.shelfTitlesPriced ?? shelf.titlesResolved}
        titlesConsidered={valuation.shelfTitles ?? shelf.titlesConsidered}
        showExcludeGiftsToggle={hasReceivedGifts}
        excludeReceivedGifts={excludeReceivedGifts}
        onExcludeReceivedGifts={writeExcludeGifts}
        calibrating={lowsCalibrating}
        onInspect={setInspectMode}
        onOpenGlossary={onOpenGlossary}
        notice={<DataNotice notes={notes.totals} about="these totals" />}
        hindsight={
          <PaidVsLow stat={data.stats?.paidVsLow ?? null} currency={currency} />
        }
        lowsStatus={
          <LowsStatus
            progress={lowsProgress}
            quotesUpdatedAt={meta.priceCacheUpdatedAt}
            connected={itadConnected}
            refreshing={lowsRefreshing}
            onRefresh={() => void refreshLowsNow()}
            onConnect={openItadExplain}
            status={itadStatus}
            error={itadError && !itadStep ? itadError : null}
          />
        }
      />

      <CostPerHourTable
        costPerHour={costPerHour}
        money={money}
        moneyHr={moneyHr}
        artwork={artwork}
        onOpenGlossary={onOpenGlossary}
        notice={<DataNotice notes={notes.costPerHour} about="cost per hour" />}
        valueMap={data.stats?.valueMap ?? null}
        currency={currency}
      />

      <SpendTimeline
        spending={spending}
        money={money}
        moneyAxis={moneyAxis}
        artwork={artwork}
        titleCatalog={titleCatalog}
        stats={data.stats}
        currency={currency}
      />

      <GiftsBoard
        receivedGames={receivedGames}
        sentGames={sentGames}
        mailGifts={mailGifts}
        receivedWorth={valuation.giftsReceived?.current ?? 0}
        sentPaid={valuation.giftsSent.spent}
        lastSyncedAt={meta.mailGiftsLastSyncedAt}
        gmail={gmail}
        money={money}
        artwork={artwork}
        onOpenGlossary={onOpenGlossary}
        notice={<DataNotice notes={notes.gifts} about="gifts received" />}
      />

      <LedgerDetail
        spending={spending}
        recentPurchases={recentPurchases}
        currency={currency}
        money={money}
        notes={[valuation.note, costPerHour.note].filter(Boolean)}
      />

      {gmailWizardOpen ? (
        <GmailSyncWizard
          open={gmailWizardOpen}
          busy={mailSyncing}
          onCancel={() => setGmailWizardOpen(false)}
          onContinue={() => void syncGmail()}
        />
      ) : null}

      <ItadKeyDialog itad={itad} />

      {inspectMode ? (
        <ShelfInspectModal
          key={inspectMode}
          mode={inspectMode}
          total={
            inspectMode === "spent"
              ? spent
              : inspectMode === "shelfNow"
                ? shelf.current
                : displayedLowest
          }
          games={inspectGames}
          money={money}
          artwork={artwork}
          onClose={() => setInspectMode(null)}
          calibrating={lowsCalibrating}
        />
      ) : null}
    </div>
  );
}
