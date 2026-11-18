"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import type { CostPerHourPayload } from "@/lib/analytics/contracts";
import type { CostPerHourGame } from "@/lib/analytics/cost-per-hour";
import type { ValueMapStat } from "@/lib/stats";
import { ValueMap } from "@/components/stats/ValueMap";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { formatPlayHours, steamStoreUrl } from "@/lib/steam/artwork";
import { GlossaryHint } from "@/components/GlossaryDrawer";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SteamThumb } from "@/components/value/SteamThumb";
import {
  nextSort,
  SortTh,
  type SortState,
} from "@/components/value/SortTh";

type SortKey = "cph" | "paid" | "hours" | "title";
type View = "best" | "worst" | "unplayed";

const COLLAPSED_ROWS = 10;

const PRESETS: Record<View, { set: "played" | "unplayed"; sort: SortState<SortKey> }> = {
  best: { set: "played", sort: { key: "cph", dir: "asc" } },
  worst: { set: "played", sort: { key: "cph", dir: "desc" } },
  unplayed: { set: "unplayed", sort: { key: "paid", dir: "desc" } },
};

function compare(a: CostPerHourGame, b: CostPerHourGame, key: SortKey) {
  if (key === "title") {
    return a.title.localeCompare(b.title, "en", { sensitivity: "base" });
  }
  if (key === "paid") return a.paid - b.paid;
  if (key === "hours") return a.hours - b.hours;
  return (a.costPerHour ?? Infinity) - (b.costPerHour ?? Infinity);
}

function GameName({ game }: { game: CostPerHourGame | null }) {
  if (!game) return <>none yet</>;
  return <strong>{game.title}</strong>;
}

export function CostPerHourTable({
  costPerHour,
  money,
  moneyHr,
  artwork,
  onOpenGlossary,
  notice,
  valueMap,
  currency,
}: {
  /** Paid-against-hours map drawn beside the table; absent on older payloads. */
  valueMap?: ValueMapStat | null;
  currency: string;
  costPerHour: CostPerHourPayload;
  money: (n: number) => string;
  moneyHr: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
  onOpenGlossary?: (termId?: string) => void;
  notice?: ReactNode;
}) {
  const [set, setSet] = useState<"played" | "unplayed">("played");
  const [sort, setSort] = useState<SortState<SortKey>>(PRESETS.best.sort);
  const [expanded, setExpanded] = useState(false);
  /** Title under the pointer or focus, in the table or on the map. */
  const [active, setActive] = useState<string | null>(null);
  const headingId = useId();
  const tableId = useId();

  const { playedPaid, unplayedPaid, bestValue, worstValue, biggestUnplayed } =
    costPerHour;
  const source = set === "played" ? playedPaid : unplayedPaid;

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...source].sort(
      (a, b) =>
        dir * compare(a, b, sort.key) ||
        a.title.localeCompare(b.title, "en", { sensitivity: "base" }),
    );
  }, [source, sort]);

  const rows = expanded ? sorted : sorted.slice(0, COLLAPSED_ROWS);
  const maxHours = Math.max(1, ...playedPaid.map((g) => g.hours));
  const showRate = set === "played";
  const hasMap = Boolean(valueMap && valueMap.points.length > 0);

  /** The preset that matches the current set and sort, if any. */
  const view = (Object.keys(PRESETS) as View[]).find(
    (v) =>
      PRESETS[v].set === set &&
      (v === "unplayed" ||
        (PRESETS[v].sort.key === sort.key && PRESETS[v].sort.dir === sort.dir)),
  );

  const onSort = (key: SortKey) =>
    setSort((s) => nextSort(s, key, key === "title" || key === "cph" ? "asc" : "desc"));

  return (
    <section className="v-panel v-cph" aria-labelledby={headingId}>
      <div className="v-panel-head">
        <div>
          <h3 id={headingId}>Cost per hour</h3>
          <p>
            <span className="mono">{playedPaid.length}</span> played{" "}
            {playedPaid.length === 1 ? "title" : "titles"} with a paid amount;{" "}
            <span className="mono">{unplayedPaid.length}</span> more paid for
            and unplayed (under 30 minutes).
          </p>
        </div>
        <div className="cph-blended">
          <span className="cph-blended-num mono">
            <span data-testid="kpi-cost-per-hour">
              {costPerHour.blendedCostPerHour != null
                ? moneyHr(costPerHour.blendedCostPerHour)
                : "—"}
            </span>
            {costPerHour.blendedCostPerHour != null ? (
              <span className="cph-blended-unit">/hr</span>
            ) : null}
          </span>
          <span className="cph-blended-cap">
            {onOpenGlossary ? (
              <GlossaryHint termId="blended" onOpen={onOpenGlossary}>
                blended rate
              </GlossaryHint>
            ) : (
              "blended rate"
            )}
            {": "}
            <span className="mono">{money(costPerHour.totalPaidMatched)}</span>{" "}
            over{" "}
            <span className="mono">
              {formatPlayHours(
                costPerHour.totalHoursPlayed ?? costPerHour.totalHoursMatched,
              )}
            </span>{" "}
            h
          </span>
        </div>
      </div>

      <p className="cph-highlights">
        Best value <GameName game={bestValue} />
        {bestValue?.costPerHour != null ? (
          <>
            {" "}
            at <span className="mono">{moneyHr(bestValue.costPerHour)}</span>/hr
          </>
        ) : null}
        . Steepest <GameName game={worstValue} />
        {worstValue?.costPerHour != null ? (
          <>
            {" "}
            at <span className="mono">{moneyHr(worstValue.costPerHour)}</span>/hr
          </>
        ) : null}
        . Largest unplayed <GameName game={biggestUnplayed} />
        {biggestUnplayed ? (
          <>
            , <span className="mono">{money(biggestUnplayed.paid)}</span>
          </>
        ) : null}
        .
      </p>

      <div className={hasMap ? "cph-body has-map" : "cph-body"}>
        {hasMap && valueMap ? (
          <ValueMap
            stat={valueMap}
            currency={currency}
            activeTitle={active}
            onActive={setActive}
          />
        ) : null}
        <div className="cph-list">
      <div className="cph-toolbar">
        <ToggleGroup
          value={view ? [view] : []}
          onValueChange={(next) => {
            const v = next[0] as View | undefined;
            if (!v) return;
            setSet(PRESETS[v].set);
            setSort(PRESETS[v].sort);
            setExpanded(false);
          }}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Cost per hour view"
        >
          <ToggleGroupItem value="best">Best</ToggleGroupItem>
          <ToggleGroupItem value="worst">Worst</ToggleGroupItem>
          <ToggleGroupItem value="unplayed">Unplayed</ToggleGroupItem>
        </ToggleGroup>
        <span className="cph-count" aria-live="polite">
          Showing <span className="mono">{rows.length}</span> of{" "}
          <span className="mono">{sorted.length}</span>{" "}
          {set === "played" ? "played" : "unplayed"}
        </span>
      </div>

      {sorted.length === 0 ? (
        <p className="v-empty">
          {set === "played"
            ? "No played titles with a paid amount yet. This needs purchase line items and playtime hours."
            : "Nothing paid for and left unplayed."}
        </p>
      ) : (
        <div className="v-table-wrap">
          <table id={tableId} className="v-table cph-table">
            <caption className="sr-only">
              {set === "played"
                ? "Played titles with a paid amount: paid, hours and cost per hour"
                : "Titles paid for and unplayed: paid and hours"}
            </caption>
            <thead>
              <tr>
                <th scope="col" className="v-num cph-col-rank">
                  <span className="sr-only">Rank</span>
                  <span aria-hidden>#</span>
                </th>
                <SortTh k="title" label="Title" sort={sort} onSort={onSort} />
                <SortTh k="paid" label="Paid" sort={sort} onSort={onSort} numeric />
                <SortTh k="hours" label="Hours" sort={sort} onSort={onSort} numeric />
                {showRate ? (
                  <SortTh k="cph" label="Cost / hr" sort={sort} onSort={onSort} numeric />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((g, i) => (
                <tr
                  key={`${g.title}-${g.steamAppId ?? "x"}`}
                  data-active={active === g.title ? "" : undefined}
                  onMouseEnter={() => setActive(g.title)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(g.title)}
                  onBlur={() => setActive(null)}
                >
                  <td className="v-num v-quiet cph-col-rank">{i + 1}</td>
                  <td className="v-cell-title">
                    <span className="v-title">
                      <SteamThumb
                        appId={g.steamAppId}
                        name={g.title}
                        artwork={artwork}
                      />
                      {g.steamAppId ? (
                        <a
                          href={steamStoreUrl(g.steamAppId)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {g.title}
                          <span className="sr-only"> (opens Steam store)</span>
                        </a>
                      ) : (
                        <span>{g.title}</span>
                      )}
                    </span>
                  </td>
                  <td className="v-num">{money(g.paid)}</td>
                  <td className="v-num">
                    <span className="cph-hours-cell">
                      {showRate ? (
                        <span className="cph-hours-meter" aria-hidden>
                          <span
                            style={{
                              width: `${Math.min(100, (g.hours / maxHours) * 100)}%`,
                            }}
                          />
                        </span>
                      ) : null}
                      <span>{formatPlayHours(g.hours)}</span>
                    </span>
                  </td>
                  {showRate ? (
                    <td className="v-num v-strong">
                      {g.costPerHour != null ? moneyHr(g.costPerHour) : "—"}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sorted.length > COLLAPSED_ROWS ? (
        <div className="cph-more">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={expanded}
            aria-controls={tableId}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? `Show first ${COLLAPSED_ROWS}`
              : `Show all ${sorted.length}`}
          </Button>
        </div>
      ) : null}

        </div>
      </div>

      {notice}
    </section>
  );
}
