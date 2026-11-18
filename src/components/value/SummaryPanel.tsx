"use client";

import type { ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { GlossaryHint } from "@/components/GlossaryDrawer";
import { Switch } from "@/components/ui/switch";
import type { InspectMode } from "@/components/value/inspect-rows";

type Total = {
  mode: InspectMode;
  tone: "paid" | "now" | "low";
  name: string;
  note: string;
  value: number;
  testId: string;
};

/**
 * The answer to "was this money well spent?" on one flat board: the three
 * totals as bars on a single shared scale, each one a button that opens its
 * per-title list. A reference line marks what was paid across all three rows.
 */
export function SummaryPanel({
  spent,
  current,
  lowest,
  money,
  purchaseCount,
  titlesPriced,
  titlesConsidered,
  showExcludeGiftsToggle,
  excludeReceivedGifts,
  onExcludeReceivedGifts,
  calibrating,
  onInspect,
  onOpenGlossary,
  notice,
  hindsight,
  lowsStatus,
}: {
  spent: number;
  current: number;
  lowest: number;
  money: (n: number) => string;
  purchaseCount: number;
  titlesPriced: number;
  titlesConsidered: number;
  showExcludeGiftsToggle: boolean;
  excludeReceivedGifts: boolean;
  onExcludeReceivedGifts: (v: boolean) => void;
  calibrating: boolean;
  onInspect: (mode: InspectMode) => void;
  onOpenGlossary?: (termId?: string) => void;
  notice?: ReactNode;
  /** Paid-against-all-time-low drill-down. */
  hindsight?: ReactNode;
  lowsStatus?: ReactNode;
}) {
  const max = Math.max(spent, current, lowest, 1);
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / max) * 100))}%`;

  const totals: Total[] = [
    {
      mode: "spent",
      tone: "paid",
      name: "Paid",
      note: `${purchaseCount} ${purchaseCount === 1 ? "purchase" : "purchases"}`,
      value: spent,
      testId: "kpi-net-spent",
    },
    {
      mode: "shelfNow",
      tone: "now",
      name: "Shelf now",
      note: `${titlesPriced} of ${titlesConsidered} shelf titles priced`,
      value: current,
      testId: "kpi-shelf-now",
    },
    {
      mode: "lowest",
      tone: "low",
      name: "Lowest",
      note: calibrating ? "all-time lows, still filling in" : "all-time lows",
      value: lowest,
      testId: "kpi-shelf-lowest",
    },
  ];

  const nowDelta = current - spent;
  const lowDelta = lowest - spent;
  const ratio = spent > 0 ? current / spent : null;
  /** Without a single priced title there is no shelf figure to compare with. */
  const hasPrices = current > 0;

  return (
    <section className="v-panel v-summary" aria-labelledby="value-heading">
      <div className="v-panel-head">
        <div>
          <h2 id="value-heading">Value</h2>
          <p className="v-verdict">
            {spent <= 0 ? (
              <>No paid purchases parsed yet.</>
            ) : !hasPrices ? (
              <>
                No store prices are available right now, so what you paid cannot
                be compared with the shelf yet.
              </>
            ) : nowDelta >= 0 ? (
              <>
                Buying this shelf today would cost{" "}
                <strong className="mono">{money(nowDelta)}</strong> more than
                you paid
                {ratio != null && ratio >= 1.05 ? (
                  <>
                    {" "}
                    (<span className="mono">{ratio.toFixed(1)}×</span>)
                  </>
                ) : null}
                .
              </>
            ) : (
              <>
                You paid <strong className="mono">{money(-nowDelta)}</strong>{" "}
                more than this shelf costs today.
              </>
            )}{" "}
            {spent > 0 && hasPrices ? (
              lowDelta >= 0 ? (
                <>
                  Even at every title&apos;s all-time low it would cost{" "}
                  <span className="mono">{money(lowDelta)}</span> more.
                </>
              ) : (
                <>
                  At every title&apos;s all-time low it would have cost{" "}
                  <span className="mono">{money(-lowDelta)}</span> less.
                </>
              )
            ) : null}
            {showExcludeGiftsToggle && excludeReceivedGifts
              ? " Gifts received are excluded."
              : ""}
          </p>
        </div>
      </div>

      <ul
        className="v-totals"
        style={{ ["--paid-pct" as string]: pct(spent) }}
      >
        {totals.map((t) => (
          <li key={t.mode}>
            <button
              type="button"
              className="v-total"
              data-tone={t.tone}
              onClick={() => onInspect(t.mode)}
              aria-label={`${t.name}: ${money(t.value)}, ${t.note}. Show titles.`}
            >
              <span className="v-total-label">
                <span className="v-total-name">{t.name}</span>
                <span className="v-total-note">{t.note}</span>
              </span>
              <span className="v-total-track" aria-hidden>
                {t.value > 0 ? (
                  <span className="v-total-fill" style={{ width: pct(t.value) }} />
                ) : null}
              </span>
              <span className="v-total-num mono" data-testid={t.testId}>
                {money(t.value)}
              </span>
              <ChevronRightIcon className="v-total-go" aria-hidden />
            </button>
          </li>
        ))}
      </ul>

      <p className="v-summary-key">
        Bars share one scale; the line marks what you paid. Select a total to
        list its titles.
        {onOpenGlossary ? (
          <>
            {" "}
            <GlossaryHint termId="shelf-now" onOpen={onOpenGlossary}>
              Shelf now
            </GlossaryHint>
            {", "}
            <GlossaryHint
              termId={calibrating ? "calibrating" : "lowest"}
              onOpen={onOpenGlossary}
            >
              Lowest
            </GlossaryHint>
          </>
        ) : null}
      </p>

      {notice}

      {hindsight}

      <div className="v-panel-foot v-summary-foot">
        {showExcludeGiftsToggle ? (
          <div className="v-switch-row">
            <Switch
              checked={excludeReceivedGifts}
              onCheckedChange={onExcludeReceivedGifts}
              size="sm"
              id="exclude-gifts-switch"
              aria-labelledby="exclude-gifts-label"
            />
            <label id="exclude-gifts-label" htmlFor="exclude-gifts-switch">
              Exclude gifts received from shelf now and lowest
            </label>
            {onOpenGlossary ? (
              <GlossaryHint termId="exclude-gifts" onOpen={onOpenGlossary}>
                what this does
              </GlossaryHint>
            ) : null}
          </div>
        ) : (
          <span />
        )}
        {lowsStatus}
      </div>
    </section>
  );
}
