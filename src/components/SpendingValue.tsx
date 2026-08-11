"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import {
  effectiveShelfLowestBestKnown,
} from "@/lib/analytics/valuation";
import { GmailSyncWizard } from "@/components/GmailSyncWizard";
import { GlossaryHint } from "@/components/GlossaryDrawer";
import { ModalShell } from "@/components/ModalShell";
import type { LowsProgress } from "@/components/DashboardClient";
import type { GmailSyncChrome } from "@/components/use-gmail-sync";
import type { ItadKeyChrome } from "@/components/use-itad-key";
import { formatPlayHours } from "@/lib/steam/artwork";
import { resolveSteamAppId } from "@/lib/steam/resolve-app-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import {
  formatQuietDate,
  moneyFmt,
  moneyPerHourFmt,
  giftTitlesMatch,
  SteamThumb,
  type InspectMode,
  type InspectSort,
  ShelfInspectModal,
  TelemetryDuel,
  LowsLatestBar,
  MonthRail,
  MonthPurchasePanel,
  PaymentStack,
  CphSpotlight,
  CostPerHourRow,
} from "@/components/value/value-parts";

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
  const [cphView, setCphView] = useState<"best" | "worst" | "unplayed">(
    "best",
  );
  const [cphLimit, setCphLimit] = useState(12);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [inspectMode, setInspectMode] = useState<InspectMode | null>(null);
  const [inspectSort, setInspectSort] = useState<InspectSort>({
    key: "price",
    dir: "desc",
  });
  const [excludeReceivedGifts, setExcludeReceivedGifts] = useState(false);
  const {
    gmailWizardOpen,
    setGmailWizardOpen,
    mailSyncing,
    mailSyncError,
    mailSyncStatus,
    syncGmail,
  } = gmail;
  const {
    itadConnected,
    itadStep,
    setItadStep,
    itadKeyDraft,
    setItadKeyDraft,
    itadSaving,
    itadError,
    setItadError,
    itadStatus,
    lowsRefreshing,
    openItadExplain,
    continueToItadApps,
    refreshLowsNow,
    saveItadKey,
  } = itad;
  const latestProgress = lowsProgress;

  const receivedGames = valuation.giftsReceivedGames ?? [];
  const mailGifts = meta.mailGifts ?? [];
  const hasReceivedGifts = receivedGames.length > 0 || mailGifts.length > 0;
  const giftsSent = valuation.giftsSent;

  useEffect(() => {
    try {
      const raw = localStorage.getItem("steam-stats-exclude-received-gifts");
      if (raw === "1") setExcludeReceivedGifts(true);
    } catch {
      // ignore
    }
  }, []);

  const setExclude = useCallback((v: boolean) => {
    setExcludeReceivedGifts(v);
    try {
      localStorage.setItem("steam-stats-exclude-received-gifts", v ? "1" : "0");
    } catch {
      // ignore
    }
  }, []);

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
    !latestProgress ||
    latestProgress.total <= 0 ||
    latestProgress.latest < latestProgress.total;

  /** While weekly refresh incomplete: hist low or shelf-now. When done: stored lows only. */
  const displayedLowest = useMemo(() => {
    if (!lowsCalibrating) return shelf.lowest;
    const games = valuation.games.filter((g) => {
      if (g.kind === "gifted_by_me") return false;
      if (hasReceivedGifts && excludeReceivedGifts && g.kind === "gifted_to_me") {
        return false;
      }
      return true;
    });
    let sum = 0;
    for (const g of games) {
      const v = effectiveShelfLowestBestKnown(g);
      if (v != null) sum += v;
    }
    return sum;
  }, [
    lowsCalibrating,
    shelf.lowest,
    valuation.games,
    hasReceivedGifts,
    excludeReceivedGifts,
  ]);

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

  const cphFullList = useMemo(() => {
    if (cphView === "unplayed") return costPerHour.unplayedPaid;
    if (cphView === "worst") return [...costPerHour.playedPaid].reverse();
    return costPerHour.playedPaid;
  }, [costPerHour, cphView]);

  const cphRows = cphFullList.slice(0, cphLimit);
  const cphRemaining = Math.max(0, cphFullList.length - cphRows.length);

  const cphMaxHours = useMemo(
    () => Math.max(1, ...costPerHour.playedPaid.map((g) => g.hours)),
    [costPerHour.playedPaid],
  );

  const selectedMonthRow = useMemo(
    () => spending.monthly.find((m) => m.month === selectedMonth) ?? null,
    [spending.monthly, selectedMonth],
  );

  return (
    <div className="spend-shell tab-panel">
      <div className="spend-toolbar">
        <div>
          <h2>Value</h2>
          <p className="spend-lede">
            Was the money well spent? Start with paid versus shelf, then scroll
            for cost per hour, months, and gifts.
          </p>
        </div>
        <div className="spend-toolbar-actions">
          <p className="meta-line meta-line-emphasis">
            {meta.priceCacheUpdatedAt
              ? `Quotes updated ${formatQuietDate(meta.priceCacheUpdatedAt)}`
              : "Market quotes load automatically"}
          </p>
          {!itadConnected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openItadExplain}
            >
              Get store lows
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={lowsRefreshing}
              onClick={() => void refreshLowsNow()}
            >
              <RefreshCwIcon
                data-icon="inline-start"
                className={lowsRefreshing ? "animate-spin" : undefined}
              />
              {lowsRefreshing ? "Refreshing…" : "Refresh lows"}
            </Button>
          )}
          {itadStatus ? <p className="meta-line">{itadStatus}</p> : null}
          {itadError && !itadStep ? (
            <p className="meta-line meta-line-error">{itadError}</p>
          ) : null}
        </div>
      </div>

      {gmailWizardOpen ? (
        <GmailSyncWizard
          open={gmailWizardOpen}
          busy={mailSyncing}
          onCancel={() => setGmailWizardOpen(false)}
          onContinue={() => void syncGmail()}
        />
      ) : null}

      <ModalShell
        open={Boolean(itadStep)}
        onClose={() => {
          if (!itadSaving) {
            setItadStep(null);
            setItadError(null);
          }
        }}
        labelledBy="itad-key-title"
        className="itad-key-overlay"
        cardClassName="itad-key-card"
        busy={itadSaving}
      >
                {itadStep === "explain" ? (
                  <>
                    <h3 id="itad-key-title">Connect store all-time lows</h3>
                    <ol className="itad-key-steps">
                      <li>
                        Continue opens IsThereAnyDeal Apps in a new tab (sign
                        in there if asked).
                      </li>
                      <li>
                        Register an app (any name, e.g.{" "}
                        <span className="mono">steam-stats</span>) and copy the
                        API key.
                      </li>
                      <li>
                        Come back here, paste the key. It stays on this machine
                        only — then Lowest refreshes.
                      </li>
                    </ol>
                    <p className="itad-key-note">
                      No browser automation. You can cancel anytime.
                    </p>
                    <div className="itad-key-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setItadStep(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={continueToItadApps}
                      >
                        Continue
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <h3 id="itad-key-title">Paste your API key</h3>
                    <p className="itad-key-note">
                      After you create the key on IsThereAnyDeal, paste it
                      below. If the other tab is still open, finish there
                      first.
                    </p>
                    <Input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="Paste IsThereAnyDeal API key"
                      value={itadKeyDraft}
                      onChange={(e) => setItadKeyDraft(e.target.value)}
                      disabled={itadSaving}
                    />
                    {itadError ? (
                      <p className="itad-key-error">{itadError}</p>
                    ) : null}
                    <div className="itad-key-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={itadSaving}
                        onClick={() => {
                          setItadStep(null);
                          setItadError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={itadSaving}
                        onClick={continueToItadApps}
                      >
                        Open Apps again
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          itadSaving || itadKeyDraft.trim().length < 16
                        }
                        onClick={() => void saveItadKey()}
                      >
                        {itadSaving ? (
                          <>
                            <RefreshCwIcon
                              data-icon="inline-start"
                              className="animate-spin"
                            />
                            Saving…
                          </>
                        ) : (
                          "Save key"
                        )}
                      </Button>
                    </div>
                  </>
                )}
      </ModalShell>

      <TelemetryDuel
        spent={spent}
        current={shelf.current}
        lowest={displayedLowest}
        money={money}
        purchaseCount={spending.purchaseCount}
        showExcludeGiftsToggle={hasReceivedGifts}
        excludeReceivedGifts={excludeReceivedGifts}
        onExcludeReceivedGifts={setExclude}
        calibrating={lowsCalibrating}
        onInspect={setInspectMode}
        onOpenGlossary={onOpenGlossary}
      />

      {inspectMode ? (
        <ShelfInspectModal
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
          sort={inspectSort}
          onSort={setInspectSort}
          onClose={() => setInspectMode(null)}
          calibrating={lowsCalibrating}
        />
      ) : null}

      <div className="value-after-telemetry">
        {latestProgress ? (
          <div className="lows-refresh-row">
            <LowsLatestBar
              latest={latestProgress.latest}
              total={latestProgress.total}
            />
            {itadConnected ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="lows-refresh-inline"
                disabled={lowsRefreshing}
                onClick={() => void refreshLowsNow()}
              >
                <RefreshCwIcon
                  data-icon="inline-start"
                  className={lowsRefreshing ? "animate-spin" : undefined}
                />
                Refresh
              </Button>
            ) : null}
          </div>
        ) : null}

        <section className="spend-section cph-section value-secondary-beat">
          <div className="spend-section-head">
            <div>
              <h3>Spend vs playtime</h3>
              <p>
                Cost per hour on library titles with a paid amount
                {onOpenGlossary ? (
                  <>
                    {" · "}
                    <GlossaryHint termId="blended" onOpen={onOpenGlossary}>
                      blended rate
                    </GlossaryHint>
                  </>
                ) : null}
                .
              </p>
            </div>
          </div>

        <div className="cph-summary">
          <div className="cph-blended">
            <span className="cph-blended-label">Blended library rate</span>
            <strong className="mono">
              {costPerHour.blendedCostPerHour != null
                ? `${moneyHr(costPerHour.blendedCostPerHour)}/hr`
                : "—"}
            </strong>
            <p>
              {money(costPerHour.totalPaidMatched)} across{" "}
              {formatPlayHours(costPerHour.totalHoursMatched)}h on{" "}
              {costPerHour.playedPaid.length} played titles
              {costPerHour.unplayedPaid.length > 0
                ? ` · ${costPerHour.unplayedPaid.length} unplayed with spend`
                : ""}
            </p>
          </div>
          <div className="cph-spotlights">
            <CphSpotlight
              label="Best value"
              game={costPerHour.bestValue}
              money={money}
              moneyHr={moneyHr}
              tone="best"
              artwork={artwork}
            />
            <CphSpotlight
              label="Steepest /hr"
              game={costPerHour.worstValue}
              money={money}
              moneyHr={moneyHr}
              tone="worst"
              artwork={artwork}
            />
            <CphSpotlight
              label="Biggest unplayed"
              game={costPerHour.biggestUnplayed}
              money={money}
              moneyHr={moneyHr}
              tone="idle"
              artwork={artwork}
            />
          </div>
        </div>

        <div className="cph-list-head">
          <ToggleGroup
            value={[cphView]}
            onValueChange={(next) => {
              const v = next[0] as "best" | "worst" | "unplayed" | undefined;
              if (!v) return;
              setCphView(v);
              setCphLimit(12);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Cost per hour view"
          >
            <ToggleGroupItem value="best">Best /hr</ToggleGroupItem>
            <ToggleGroupItem value="worst">Steepest /hr</ToggleGroupItem>
            <ToggleGroupItem value="unplayed">Unplayed</ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="cph-list">
          {cphRows.length === 0 ? (
            <p className="muted">
              No matching titles yet — need paid line items and playtime hours.
            </p>
          ) : (
            cphRows.map((g, i) => (
              <CostPerHourRow
                key={`${g.title}-${g.steamAppId ?? i}`}
                game={g}
                rank={i + 1}
                maxHours={cphMaxHours}
                money={money}
                moneyHr={moneyHr}
                mode={cphView === "unplayed" ? "unplayed" : "value"}
                artwork={artwork}
              />
            ))
          )}
        </div>
        {cphRemaining > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setCphLimit((n) => n + 12)}
          >
            Load more · {cphRemaining} left
          </Button>
        ) : null}
      </section>
      </div>

      <div className="two-col signal-grid spend-secondary">
        <section className="spend-section panel-glass">
          <div className="spend-section-head">
            <div>
              <h3>Spend by month</h3>
              <p>Click a month to see titles, prices, and discounts</p>
            </div>
          </div>
          {spending.monthly.length === 0 ? (
            <p className="muted">No purchases parsed yet.</p>
          ) : (
            <MonthRail
              rows={spending.monthly}
              money={money}
              selectedMonth={selectedMonth}
              onSelectMonth={(month) =>
                setSelectedMonth((prev) => (prev === month ? null : month))
              }
            />
          )}
        </section>

        <section className="spend-section panel-glass">
          <div className="spend-section-head">
            <div>
              <h3>Payment mix</h3>
              <p>How money left the wallet</p>
            </div>
          </div>
          {spending.paymentMethods.length === 0 ? (
            <p className="muted">No wallet rows to chart yet.</p>
          ) : (
            <PaymentStack methods={spending.paymentMethods} money={money} />
          )}
        </section>
      </div>

      {selectedMonthRow ? (
        <MonthPurchasePanel
          month={selectedMonthRow.month}
          spent={selectedMonthRow.spent}
          lines={selectedMonthRow.lines}
          money={money}
          artwork={artwork}
          titleCatalog={titleCatalog}
          onClose={() => setSelectedMonth(null)}
        />
      ) : null}

      <section className="spend-section gifts-received-section">
        <div className="spend-section-head">
          <div>
            <h3>Gifts I received</h3>
            <p>
              Shows gifts Steam still lists, plus Gmail sync for older ones —
              including who sent each gift when known.
            </p>
          </div>
          <div className="gifts-received-side">
            {hasReceivedGifts ? (
              <span className="gifts-received-total mono cyan">
                {money(valuation.giftsReceived?.current ?? 0)}
              </span>
            ) : null}
            <div className="gifts-received-sync">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mailSyncing}
                onClick={() => setGmailWizardOpen(true)}
              >
                <RefreshCwIcon
                  data-icon="inline-start"
                  className={mailSyncing ? "animate-spin" : undefined}
                />
                {mailSyncing ? "Syncing…" : "Sync from Gmail"}
              </Button>
              {mailSyncing && mailSyncStatus ? (
                <span className="gifts-received-meta" aria-live="polite">
                  {mailSyncStatus.replace(/\s*—\s*closing window\.?$/i, "")}
                </span>
              ) : mailSyncError ? (
                <span className="gifts-received-meta gifts-received-meta-error">
                  {mailSyncError}
                </span>
              ) : mailSyncStatus ? (
                <span className="gifts-received-meta" aria-live="polite">
                  {mailSyncStatus}
                </span>
              ) : meta.mailGiftsLastSyncedAt ? (
                <span
                  className="gifts-received-meta"
                  title={new Date(meta.mailGiftsLastSyncedAt).toLocaleString()}
                >
                  Synced {formatQuietDate(meta.mailGiftsLastSyncedAt)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {hasReceivedGifts ? (
          <div className="purchase-rail">
            {receivedGames.map((g) => (
              <div key={g.title} className="purchase-chip-card">
                <SteamThumb
                  appId={g.steamAppId}
                  name={g.title}
                  artwork={artwork}
                />
                <div>
                  <strong>{g.title}</strong>
                  <small>
                    {g.giftedFrom
                      ? `From ${g.giftedFrom}`
                      : g.acquisitionNote ?? "Gifted to me"}
                  </small>
                </div>
                <span className="mono cyan">
                  {g.current != null && g.current > 0
                    ? money(g.current)
                    : g.lowest != null && g.lowest > 0
                      ? money(g.lowest)
                      : "—"}
                </span>
              </div>
            ))}
            {mailGifts
              .filter(
                (m) =>
                  !receivedGames.some((g) => giftTitlesMatch(g.title, m.title)),
              )
              .map((m) => (
                <div key={`mail-${m.title}-${m.importedAt}`} className="purchase-chip-card">
                  <SteamThumb appId={null} name={m.title} artwork={artwork} />
                  <div>
                    <strong>{m.title}</strong>
                    <small>
                      {m.fromPersona
                        ? `From ${m.fromPersona}`
                        : "Imported from Gmail"}
                      {m.receivedAt
                        ? ` · ${new Date(m.receivedAt).toLocaleDateString()}`
                        : ""}
                    </small>
                  </div>
                  <span className="mono cyan">—</span>
                </div>
              ))}
          </div>
        ) : (
          <p className="gifts-received-empty">
            No gifts yet. Use <strong>Sync from Gmail</strong>
            {onOpenGlossary ? (
              <>
                {" "}
                (
                <GlossaryHint termId="gmail-sync" onOpen={onOpenGlossary}>
                  what happens
                </GlossaryHint>
                )
              </>
            ) : null}{" "}
            to pull Steam gift emails into a local list.
          </p>
        )}
      </section>

      {!(giftsSent.spent > 0 || (valuation.giftsSentGames?.length ?? 0) > 0) ? (
        <p className="gifts-received-empty">
          No sent gifts in the purchase history.
        </p>
      ) : null}

      {giftsSent.spent > 0 || (valuation.giftsSentGames?.length ?? 0) > 0 ? (
        <section className="spend-section gifts-sent-section">
          <div className="spend-section-head">
            <div>
              <h3>Gifts I sent</h3>
              <p>
                Games you bought for others — shows who received each gift when
                Steam listed them.
              </p>
            </div>
            <span className="gifts-sent-total mono amber">
              {money(giftsSent.spent)}
            </span>
          </div>
          <div className="purchase-rail">
            {(valuation.giftsSentGames ?? []).map((g) => (
              <div key={g.title} className="purchase-chip-card">
                <SteamThumb
                  appId={g.steamAppId}
                  name={g.title}
                  artwork={artwork}
                />
                <div>
                  <strong>{g.title}</strong>
                  <small>
                    {g.giftedTo ? `To ${g.giftedTo}` : "Gifted away"}
                  </small>
                </div>
                <span className="mono amber">
                  {g.paid != null ? money(g.paid) : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <details className="spend-details">
        <summary>More ledger detail</summary>
        <div className="spend-details-body">
          <section className="spend-section">
            <div className="spend-section-head">
              <div>
                <h3>Habits</h3>
              </div>
            </div>
            <div className="habit-cloud">
              {spending.habits.map((h) => (
                <p key={h} className="habit-chip">
                  {h}
                </p>
              ))}
              <p className="habit-chip">
                Average {money(spending.avgPurchase)} · median{" "}
                {money(spending.medianPurchase)}
              </p>
              <p className="habit-chip accent">
                Sale savings {money(spending.saleSavings)} vs MSRP
              </p>
            </div>
          </section>

          <div className="two-col signal-grid">
            <section className="spend-section panel-glass">
              <div className="spend-section-head">
                <div>
                  <h3>Recent transactions</h3>
                </div>
              </div>
              <ul className="tx-rail">
                {recentPurchases.slice(0, 10).map((p, idx) => {
                  const title = p.items[0] ?? p.type;
                  const appId = resolveSteamAppId(title, titleCatalog);
                  return (
                    <li key={`${p.date}-${idx}`} className="tx-row">
                      <SteamThumb
                        appId={appId}
                        name={title}
                        artwork={artwork}
                      />
                      <div>
                        <strong>
                          {p.items.slice(0, 2).join(", ") || p.type}
                        </strong>
                        <small>
                          {p.date}
                          {p.refunded ? " · refunded" : ""}
                          {p.discountPct ? ` · ${p.discountPct}%` : ""}
                        </small>
                      </div>
                      <span className="mono">
                        {p.total != null
                          ? moneyFmt(p.total, p.currency ?? currency)
                          : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="spend-section panel-glass">
              <div className="spend-section-head">
                <div>
                  <h3>Spend by year</h3>
                </div>
              </div>
              <MonthRail
                rows={spending.yearly.map((y) => ({
                  month: y.year,
                  spent: y.spent,
                  count: 0,
                }))}
                money={money}
              />
              <div className="license-pills">
                {spending.licenseMix.map((l) => (
                  <span key={l.method} className="license-pill">
                    {l.method} · {l.count}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>
      </details>
    </div>
  );
}
