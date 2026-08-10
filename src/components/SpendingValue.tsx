"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2Icon, RefreshCwIcon, XIcon } from "lucide-react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import type { CostPerHourGame } from "@/lib/analytics/cost-per-hour";
import {
  effectiveShelfLowest,
  effectiveShelfLowestBestKnown,
  effectiveShelfNow,
} from "@/lib/analytics/valuation";
import { isRedundantPackSku } from "@/lib/analytics/edition-packs";
import { titlesSoftMatch } from "@/lib/analytics/acquisition";
import { SteamArt } from "@/components/SteamArt";
import {
  formatPlayHours,
  rankMedalClass,
  steamStoreUrl,
} from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { resolveArtworkAppId, resolveSteamAppId } from "@/lib/steam/resolve-app-id";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";

function moneyFmt(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`;
  }
}

function giftTitlesMatch(a: string, b: string): boolean {
  const loose = (t: string) =>
    t
      .toLowerCase()
      .replace(/™|®/g, "")
      .replace(/[-–—:!?.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return (
    loose(a) === loose(b) ||
    titlesSoftMatch(a, b) ||
    a.toLowerCase() === b.toLowerCase()
  );
}

function moneyPerHourFmt(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: n < 10 ? 2 : 0,
    }).format(n);
  } catch {
    return `${currency} ${n < 10 ? n.toFixed(2) : Math.round(n).toLocaleString()}`;
  }
}

function SteamThumb({
  appId,
  name,
  variant = "capsule",
  artwork,
}: {
  appId: number | null;
  name: string;
  variant?: "capsule" | "portrait";
  artwork?: Record<string, ArtworkUrls>;
}) {
  return (
    <SteamArt
      appId={appId}
      name={name}
      variant={variant}
      artwork={artwork}
    />
  );
}

type InspectMode = "spent" | "shelfNow" | "lowest";
type InspectSortKey = "alpha" | "price";
type InspectSortDir = "asc" | "desc";
type InspectSort = { key: InspectSortKey; dir: InspectSortDir };

type ValuationGameRow = DashboardPayload["valuation"]["games"][number];

type InspectRow = {
  game: ValuationGameRow;
  amount: number | null;
};

function looksLikeAddonPack(title: string): boolean {
  return /\b(collaboration pack|collab pack|cosmetic pack|soundtrack|deluxe upgrade|season pass)\b/i.test(
    title,
  );
}

/** Hide freebie DLC / collab packs that only clutter Lowest (₹0, no live price). */
function isRedundantLowestRow(
  game: ValuationGameRow,
  games: ValuationGameRow[],
): boolean {
  if (isRedundantPackSku(game, games)) return true;

  // Complimentary free rows: Butcher's Circus, Dredge collab, etc.
  if (game.kind === "free") return true;

  // Free/unresolved addon sharing the base game's Steam app id
  if (
    game.steamAppId != null &&
    looksLikeAddonPack(game.title) &&
    games.some(
      (o) =>
        o !== game &&
        o.steamAppId === game.steamAppId &&
        o.kind !== "free" &&
        !looksLikeAddonPack(o.title),
    )
  ) {
    return true;
  }

  return false;
}

function buildInspectRows(
  games: ValuationGameRow[],
  mode: InspectMode,
  opts?: { calibrating?: boolean },
): InspectRow[] {
  const rows: InspectRow[] = [];
  for (const game of games) {
    if (game.kind === "gifted_by_me") continue;

    if (mode === "spent") {
      // Include pack/collection purchases — they are real wallet spend
      if (game.paid != null && game.paid > 0) {
        rows.push({ game, amount: game.paid });
      }
      continue;
    }

    if (mode === "shelfNow") {
      if (isRedundantPackSku(game, games)) continue;
      // Don't list free addon packs that only exist as collab/DLC rows
      if (game.kind === "free" && looksLikeAddonPack(game.title)) continue;
      if (
        game.kind === "free" &&
        game.steamAppId != null &&
        games.some(
          (o) =>
            o !== game &&
            o.steamAppId === game.steamAppId &&
            o.kind !== "free",
        )
      ) {
        continue;
      }
      const now = effectiveShelfNow(game);
      if (now != null) rows.push({ game, amount: now });
      continue;
    }

    // Lowest
    if (isRedundantLowestRow(game, games)) continue;

    const low = opts?.calibrating
      ? effectiveShelfLowestBestKnown(game)
      : effectiveShelfLowest(game);
    const bought =
      (game.paid != null && game.paid > 0) || game.kind === "purchased";
    const onShelf = effectiveShelfNow(game) != null;
    if (low != null || bought || onShelf) {
      rows.push({ game, amount: low });
    }
  }
  return rows;
}

function ShelfInspectModal({
  mode,
  total,
  games,
  money,
  artwork,
  sort,
  onSort,
  onClose,
  calibrating,
}: {
  mode: InspectMode;
  total: number;
  games: ValuationGameRow[];
  money: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
  sort: InspectSort;
  onSort: (s: InspectSort) => void;
  onClose: () => void;
  calibrating?: boolean;
}) {
  const title =
    mode === "spent" ? "You spent" : mode === "shelfNow" ? "Shelf now" : "Lowest";
  const tone =
    mode === "spent" ? "amber" : mode === "shelfNow" ? "cyan" : "rose";
  const blurb =
    mode === "spent"
      ? "What you paid per library title (wallet purchases)."
      : mode === "shelfNow"
        ? "Live Steam India price per playable game."
        : "Steam India all-time low when stored — bought titles without a low still appear as —.";

  const rows = useMemo(() => {
    const list = buildInspectRows(games, mode, { calibrating });
    const dir = sort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      if (sort.key === "alpha") {
        return (
          dir *
            a.game.title.localeCompare(b.game.title, undefined, {
              sensitivity: "base",
            }) || (a.amount ?? 0) - (b.amount ?? 0)
        );
      }
      const aa = a.amount;
      const bb = b.amount;
      // Missing lows sort to the end
      if (aa == null && bb == null) {
        return a.game.title.localeCompare(b.game.title, undefined, {
          sensitivity: "base",
        });
      }
      if (aa == null) return 1;
      if (bb == null) return -1;
      return (
        dir * (aa - bb) ||
        a.game.title.localeCompare(b.game.title, undefined, {
          sensitivity: "base",
        })
      );
    });
    return list;
  }, [games, mode, sort, calibrating]);

  const toggleSort = (key: InspectSortKey) => {
    if (sort.key === key) {
      onSort({ key, dir: sort.dir === "asc" ? "desc" : "asc" });
      return;
    }
    // Default: A–Z ascending, price descending (highest first)
    onSort({ key, dir: key === "price" ? "desc" : "asc" });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const alphaLabel = sort.key === "alpha" && sort.dir === "desc" ? "Z–A" : "A–Z";
  const priceLabel =
    sort.key === "price" && sort.dir === "asc" ? "Price ↑" : "Price ↓";

  return createPortal(
    <div
      className="shelf-inspect-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="shelf-inspect-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shelf-inspect-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shelf-inspect-head">
          <div className="shelf-inspect-head-top">
            <h3 id="shelf-inspect-title">{title}</h3>
            <div className="shelf-inspect-tools">
              <div
                className="shelf-inspect-sort"
                role="group"
                aria-label="Sort games"
              >
                <button
                  type="button"
                  className={
                    sort.key === "alpha"
                      ? "shelf-inspect-sort-btn is-active"
                      : "shelf-inspect-sort-btn"
                  }
                  onClick={() => toggleSort("alpha")}
                  aria-pressed={sort.key === "alpha"}
                  title="Sort by name — click again to reverse"
                >
                  {alphaLabel}
                </button>
                <button
                  type="button"
                  className={
                    sort.key === "price"
                      ? "shelf-inspect-sort-btn is-active"
                      : "shelf-inspect-sort-btn"
                  }
                  onClick={() => toggleSort("price")}
                  aria-pressed={sort.key === "price"}
                  title="Sort by price — click again to reverse"
                >
                  {priceLabel}
                </button>
              </div>
              <button
                type="button"
                className="shelf-inspect-close"
                onClick={onClose}
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
            </div>
          </div>
          <p className="shelf-inspect-blurb">
            {blurb}{" "}
            <strong className={`mono ${tone}`}>{money(total)}</strong>
            {rows.length > 0 ? ` · ${rows.length} titles` : ""}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="shelf-inspect-empty">Nothing to show for this total.</p>
        ) : (
          <div className="shelf-inspect-scroll">
            <div className="shelf-inspect-grid">
              {rows.map(({ game, amount }) => {
                const body = (
                  <>
                    <div className="shelf-inspect-art">
                      <SteamThumb
                        appId={game.steamAppId}
                        name={game.title}
                        variant="portrait"
                        artwork={artwork}
                      />
                    </div>
                    <div className="shelf-inspect-card-body">
                      <h4>{game.title}</h4>
                      <strong className={`mono ${tone}`}>
                        {amount != null ? money(amount) : "—"}
                      </strong>
                    </div>
                  </>
                );
                if (game.steamAppId) {
                  return (
                    <a
                      key={game.title}
                      className="shelf-inspect-card"
                      href={steamStoreUrl(game.steamAppId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {body}
                    </a>
                  );
                }
                return (
                  <div key={game.title} className="shelf-inspect-card">
                    {body}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function TelemetryDuel({
  spent,
  current,
  lowest,
  money,
  purchaseCount,
  showExcludeGiftsToggle,
  excludeReceivedGifts,
  onExcludeReceivedGifts,
  calibrating,
  onInspect,
}: {
  spent: number;
  current: number;
  lowest: number;
  money: (n: number) => string;
  purchaseCount: number;
  showExcludeGiftsToggle: boolean;
  excludeReceivedGifts: boolean;
  onExcludeReceivedGifts: (v: boolean) => void;
  calibrating?: boolean;
  onInspect: (mode: InspectMode) => void;
}) {
  const max = Math.max(spent, current, lowest, 1);
  const ahead = current >= spent;
  const delta = Math.abs(current - spent);
  const spentPct = (spent / max) * 100;
  const nowPct = (current / max) * 100;

  return (
    <section className="telemetry">
      <div className="telemetry-head">
        <div>
          <h3>Paid vs shelf</h3>
          <p className="telemetry-lede">
            Click a total to inspect every title. Spent is wallet purchases;
            shelf now and lowest value playable games
            {showExcludeGiftsToggle && excludeReceivedGifts
              ? " (gifts received excluded)."
              : "."}
            {calibrating
              ? " Lowest is still calibrating — hist low when known, else shelf now."
              : ""}
          </p>
        </div>
        {showExcludeGiftsToggle ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={excludeReceivedGifts}
              onCheckedChange={onExcludeReceivedGifts}
              size="sm"
            />
            <span>Exclude gifts from shelf now &amp; lowest</span>
          </label>
        ) : null}
      </div>

      <div className="telemetry-duel telemetry-duel-triple">
        <button
          type="button"
          className="telemetry-stat spent telemetry-stat-btn"
          onClick={() => onInspect("spent")}
        >
          <span className="telemetry-label">You spent</span>
          <strong className="telemetry-num amber">{money(spent)}</strong>
          <span className="telemetry-sub">{purchaseCount} library buys · view</span>
        </button>
        <div className="telemetry-vs" aria-hidden>
          <span>{ahead ? "▲" : "▼"}</span>
          <small>{money(delta)}</small>
        </div>
        <button
          type="button"
          className="telemetry-stat now telemetry-stat-btn"
          onClick={() => onInspect("shelfNow")}
        >
          <span className="telemetry-label">Shelf now</span>
          <strong className="telemetry-num cyan">{money(current)}</strong>
          <span className="telemetry-sub">Live India · view</span>
        </button>
        <button
          type="button"
          className="telemetry-stat low telemetry-stat-btn"
          onClick={() => onInspect("lowest")}
        >
          <span className="telemetry-label">
            Lowest
            {calibrating ? (
              <Loader2Icon className="telemetry-lowest-spinner" aria-hidden />
            ) : null}
          </span>
          <strong className="telemetry-num rose">{money(lowest)}</strong>
          <span className="telemetry-sub">
            {calibrating ? "Calibrating · view" : "India hist · view"}
          </span>
        </button>
      </div>

      <div className="tug">
        <div className="tug-track">
          <span
            className="tug-spent"
            style={{ ["--fill" as string]: spentPct / 100 }}
          />
          <span
            className="tug-now"
            style={{ ["--fill" as string]: nowPct / 100 }}
          />
        </div>
        <div className="tug-legend">
          <span className="amber">Paid</span>
          <span className="cyan">Shelf now</span>
          <span className="rose">Lowest</span>
        </div>
      </div>
    </section>
  );
}

function LowsLatestBar({
  latest,
  total,
}: {
  latest: number;
  total: number;
}) {
  if (total <= 0) return null;
  const clamped = Math.max(0, Math.min(latest, total));
  const pct = Math.min(100, Math.round((clamped / total) * 100));
  const allLatest = clamped >= total;

  return (
    <div
      className="lows-refresh-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={clamped}
      aria-label="Titles with fresh India lows"
    >
      <span className="lows-refresh-progress-label">
        <span>{allLatest ? "Up to date · 7d" : "India lows · 7d"}</span>
      </span>
      <div className="lows-refresh-progress-track">
        <span
          className="lows-refresh-progress-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="lows-refresh-progress-count mono">
        {clamped}/{total}
      </span>
    </div>
  );
}

function formatMonthLabel(monthKey: string) {
  const [y, m] = monthKey.split("-");
  if (!y || !m) return monthKey;
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

function MonthRail({
  rows,
  money,
  selectedMonth,
  onSelectMonth,
}: {
  rows: { month: string; spent: number; count: number }[];
  money: (n: number) => string;
  selectedMonth?: string | null;
  onSelectMonth?: (month: string) => void;
}) {
  // Newest first — every month with spend, no truncation
  const ordered = [...rows].reverse();
  const max = Math.max(...ordered.map((r) => r.spent), 1);
  const total = ordered.reduce((s, r) => s + r.spent, 0);
  const interactive = Boolean(onSelectMonth);

  return (
    <div className="month-rail-wrap">
      <div className="month-rail">
        {ordered.map((r, i) => {
          const active = selectedMonth === r.month;
          const className = `month-rail-row${interactive ? " is-button" : ""}${active ? " is-active" : ""}`;
          const inner = (
            <>
              <span className="month-rail-label">
                {r.month.replace(/^\d{2}/, "")}
              </span>
              <div className="month-rail-track">
                <span
                  style={{
                    ["--fill" as string]: Math.max(0.03, r.spent / max),
                  }}
                />
              </div>
              <span className="month-rail-val mono">{money(r.spent)}</span>
            </>
          );
          if (interactive) {
            return (
              <button
                key={r.month}
                type="button"
                className={className}
                style={{ animationDelay: `${Math.min(i, 24) * 28}ms` }}
                onClick={() => onSelectMonth?.(r.month)}
                aria-pressed={active}
                aria-label={`${formatMonthLabel(r.month)}, ${money(r.spent)}, ${r.count} purchases`}
              >
                {inner}
              </button>
            );
          }
          return (
            <div
              key={r.month}
              className={className}
              style={{ animationDelay: `${Math.min(i, 24) * 28}ms` }}
            >
              {inner}
            </div>
          );
        })}
      </div>
      {ordered.length > 0 ? (
        <p className="month-rail-total mono">
          <span>Total</span>
          <strong>{money(total)}</strong>
        </p>
      ) : null}
    </div>
  );
}

function MonthPurchasePanel({
  month,
  spent,
  lines,
  money,
  artwork,
  titleCatalog,
  onClose,
}: {
  month: string;
  spent: number;
  lines: {
    title: string;
    amount: number;
    date: string;
    discountPct: number | null;
    listAmount: number | null;
  }[];
  money: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
  titleCatalog: { title: string; steamAppId: number | null }[];
  onClose: () => void;
}) {
  const cards = useMemo(
    () =>
      lines.map((line) => ({
        ...line,
        appId: resolveArtworkAppId(line.title, titleCatalog),
      })),
    [lines, titleCatalog],
  );

  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [month]);

  return (
    <section
      ref={panelRef}
      className="spend-section month-detail"
      aria-live="polite"
    >
      <div className="spend-section-head">
        <div>
          <h3>{formatMonthLabel(month)}</h3>
          <p>
            {cards.length} title{cards.length === 1 ? "" : "s"} · {money(spent)}{" "}
            library spend
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Back to months
        </Button>
      </div>
      <div className="month-purchase-grid">
        {cards.map((line, idx) => {
          // Discount vs real list (receipt or Steam INR retail) — never cart blend %
          const off =
            line.listAmount != null && line.listAmount > line.amount
              ? Math.round((1 - line.amount / line.listAmount) * 100)
              : null;
          const body = (
            <>
              <SteamThumb
                appId={line.appId}
                name={line.title}
                variant="portrait"
                artwork={artwork}
              />
              <div className="month-purchase-body">
                <div className="month-purchase-top">
                  {off != null && off > 0 ? (
                    <span className="deal-chip sale">−{off}%</span>
                  ) : (
                    <span className="deal-chip muted-chip">Paid</span>
                  )}
                  <span className="month-purchase-date">{line.date}</span>
                </div>
                <h4>{line.title}</h4>
                <div className="month-purchase-prices">
                  {line.listAmount != null && line.listAmount > line.amount ? (
                    <span className="month-purchase-list mono">
                      {money(line.listAmount)}
                    </span>
                  ) : null}
                  <strong className="mono amber">{money(line.amount)}</strong>
                </div>
              </div>
            </>
          );
          if (line.appId) {
            return (
              <a
                key={`${line.title}-${line.date}-${idx}`}
                className="month-purchase-card"
                href={steamStoreUrl(line.appId)}
                target="_blank"
                rel="noreferrer"
              >
                {body}
              </a>
            );
          }
          return (
            <div
              key={`${line.title}-${line.date}-${idx}`}
              className="month-purchase-card"
            >
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PaymentStack({
  methods,
  money,
}: {
  methods: { method: string; spent: number; count: number }[];
  money: (n: number) => string;
}) {
  const total = methods.reduce((s, m) => s + m.spent, 0) || 1;
  const colors = ["#66c0f4", "#3ee0d5", "#ffb347", "#ff6b8a", "#8b9aab"];
  return (
    <div className="pay-stack">
      <div className="pay-bar" aria-hidden>
        {methods.map((m, i) => (
          <span
            key={m.method}
            style={{
              width: `${(m.spent / total) * 100}%`,
              background: colors[i % colors.length],
            }}
            title={m.method}
          />
        ))}
      </div>
      <ul className="pay-list">
        {methods.map((m, i) => (
          <li key={m.method}>
            <span
              className="pay-dot"
              style={{ background: colors[i % colors.length] }}
            />
            <span className="pay-name">{m.method}</span>
            <span className="mono">
              {money(m.spent)}
              <small>
                {Math.round((m.spent / total) * 100)}% · {m.count}×
              </small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}


function CphSpotlight({
  label,
  game,
  money,
  moneyHr,
  tone,
  artwork,
}: {
  label: string;
  game: CostPerHourGame | null;
  money: (n: number) => string;
  moneyHr: (n: number) => string;
  tone: "best" | "worst" | "idle";
  artwork?: Record<string, ArtworkUrls>;
}) {
  if (!game) {
    return (
      <div className={`cph-spotlight ${tone}`}>
        <span className="cph-spotlight-label">{label}</span>
        <p className="muted">No data yet</p>
      </div>
    );
  }

  const inner = (
    <>
      <SteamThumb
        appId={game.steamAppId}
        name={game.title}
        variant="portrait"
        artwork={artwork}
      />
      <div>
        <span className="cph-spotlight-label">{label}</span>
        <strong>{game.title}</strong>
        <div className="cph-spotlight-stats">
          <span className="mono">
            {game.costPerHour != null
              ? `${moneyHr(game.costPerHour)}/hr`
              : "Unplayed"}
          </span>
          <span className="muted">
            {money(game.paid)} · {formatPlayHours(game.hours)}h
          </span>
        </div>
      </div>
    </>
  );

  if (game.steamAppId) {
    return (
      <a
        className={`cph-spotlight ${tone}`}
        href={steamStoreUrl(game.steamAppId)}
        target="_blank"
        rel="noreferrer"
      >
        {inner}
      </a>
    );
  }
  return <div className={`cph-spotlight ${tone}`}>{inner}</div>;
}

function CostPerHourRow({
  game,
  rank,
  maxHours,
  money,
  moneyHr,
  mode,
  artwork,
}: {
  game: CostPerHourGame;
  rank: number;
  maxHours: number;
  money: (n: number) => string;
  moneyHr: (n: number) => string;
  mode: "value" | "unplayed";
  artwork?: Record<string, ArtworkUrls>;
}) {
  const pct = maxHours > 0 ? Math.min(100, (game.hours / maxHours) * 100) : 0;
  const body = (
    <>
      <span className={`cph-rank ${rankMedalClass(rank)}`}>#{rank}</span>
      <SteamThumb appId={game.steamAppId} name={game.title} artwork={artwork} />
      <div className="cph-row-main">
        <strong>{game.title}</strong>
        <div className="cph-row-meta">
          <span>{money(game.paid)} paid</span>
          <span>·</span>
          <span>
            {mode === "unplayed"
              ? game.hours > 0
                ? `${formatPlayHours(game.hours)}h · under 30m`
                : "0h played"
              : `${formatPlayHours(game.hours)}h played`}
          </span>
        </div>
        {mode === "value" ? (
          <div className="cph-bar" aria-hidden>
            <span style={{ ["--fill" as string]: pct / 100 }} />
          </div>
        ) : null}
      </div>
      <div className="cph-row-rate">
        {game.costPerHour != null ? (
          <>
            <strong className="mono">{moneyHr(game.costPerHour)}</strong>
            <span>/hr</span>
          </>
        ) : (
          <strong className="mono rose">—</strong>
        )}
      </div>
    </>
  );

  if (game.steamAppId) {
    return (
      <a
        className="cph-row"
        href={steamStoreUrl(game.steamAppId)}
        target="_blank"
        rel="noreferrer"
      >
        {body}
      </a>
    );
  }
  return <div className="cph-row">{body}</div>;
}

export function SpendingValue({
  data,
  onRefresh,
}: {
  data: DashboardPayload;
  onRefresh?: () => Promise<void> | void;
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
  const [mailSyncing, setMailSyncing] = useState(false);
  const [mailSyncError, setMailSyncError] = useState<string | null>(null);
  const [mailSyncStatus, setMailSyncStatus] = useState<string | null>(null);
  const [itadConnected, setItadConnected] = useState(
    Boolean(meta.hasItadApiKey),
  );
  const [itadStep, setItadStep] = useState<"explain" | "paste" | null>(null);
  const [itadKeyDraft, setItadKeyDraft] = useState("");
  const [itadSaving, setItadSaving] = useState(false);
  const [itadError, setItadError] = useState<string | null>(null);
  const [itadStatus, setItadStatus] = useState<string | null>(null);
  const [latestProgress, setLatestProgress] = useState<{
    latest: number;
    total: number;
  } | null>(null);

  const receivedGames = valuation.giftsReceivedGames ?? [];
  const mailGifts = meta.mailGifts ?? [];
  const hasReceivedGifts = receivedGames.length > 0 || mailGifts.length > 0;
  const giftsSent = valuation.giftsSent;

  const syncGmail = useCallback(async () => {
    setMailSyncing(true);
    setMailSyncError(null);
    setMailSyncStatus(
      "Opening a separate browser window for Gmail — your other windows stay open.",
    );
    try {
      const res = await fetch("/api/gifts-received", { method: "POST" });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        status?: { phase?: string; message?: string; error?: string };
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "Gmail sync failed to start");
      }
      if (json.message) setMailSyncStatus(json.message);

      const deadline = Date.now() + 12 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const poll = await fetch("/api/gifts-received");
        const body = (await poll.json()) as {
          sync?: {
            phase?: string;
            running?: boolean;
            message?: string;
            error?: string;
            added?: number;
            parsed?: number;
            total?: number;
          };
        };
        const sync = body.sync;
        if (sync?.message) setMailSyncStatus(sync.message);

        if (sync?.phase === "done") {
          const added = sync.added ?? 0;
          const total = sync.total ?? 0;
          setMailSyncStatus(
            added > 0
              ? `Added ${added} · ${total} total`
              : total > 0
                ? `Up to date · ${total} gifts`
                : "No new gifts found",
          );
          await onRefresh?.();
          return;
        }
        if (sync?.phase === "error") {
          throw new Error(sync.error || sync.message || "Gmail sync failed");
        }
        if (
          !sync?.running &&
          sync?.phase &&
          sync.phase !== "starting" &&
          sync.phase !== "awaiting_login" &&
          sync.phase !== "scraping"
        ) {
          // finished without done — treat as error if still idle/error
          if (sync.phase === "idle") {
            throw new Error("Gmail sync did not start. Try again.");
          }
        }
      }
      throw new Error("Timed out waiting for Gmail sync to finish.");
    } catch (err) {
      setMailSyncError(err instanceof Error ? err.message : "Gmail sync failed");
      setMailSyncStatus(null);
    } finally {
      setMailSyncing(false);
    }
  }, [onRefresh]);

  // Clear the one-line success flash so it doesn’t sit under the heading.
  useEffect(() => {
    if (mailSyncing || mailSyncError || !mailSyncStatus) return;
    const t = window.setTimeout(() => setMailSyncStatus(null), 4000);
    return () => window.clearTimeout(t);
  }, [mailSyncing, mailSyncError, mailSyncStatus]);

  useEffect(() => {
    setItadConnected(Boolean(meta.hasItadApiKey));
  }, [meta.hasItadApiKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("steam-stats-exclude-received-gifts");
      if (raw === "1") setExcludeReceivedGifts(true);
    } catch {
      // ignore
    }
  }, []);

  const openItadExplain = useCallback(() => {
    setItadError(null);
    setItadStatus(null);
    setItadKeyDraft("");
    setItadStep("explain");
  }, []);

  const continueToItadApps = useCallback(() => {
    window.open("https://isthereanydeal.com/apps/", "_blank", "noopener,noreferrer");
    setItadStep("paste");
  }, []);

  const ensureWeeklyLows = useCallback(async (opts?: { force?: boolean }) => {
    try {
      await fetch("/api/refresh-prices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: Boolean(opts?.force) }),
      });
    } catch {
      // ignore — bar still shows stored coverage
    }
  }, []);

  const saveItadKey = useCallback(async () => {
    setItadSaving(true);
    setItadError(null);
    try {
      const res = await fetch("/api/itad-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: itadKeyDraft }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.error || "Could not save API key");
      }
      setItadConnected(true);
      setItadStep(null);
      setItadKeyDraft("");
      setItadSaving(false);
      setItadStatus(json.message || "Key saved.");
      void onRefresh?.();
      // Force one weekly refresh so the new key is used once, then stored for ~7 days
      void ensureWeeklyLows({ force: true });
    } catch (err) {
      setItadError(err instanceof Error ? err.message : "Could not save API key");
      setItadStatus(null);
      setItadSaving(false);
    }
  }, [ensureWeeklyLows, itadKeyDraft, onRefresh]);

  // Poll stored weekly coverage; kick a refresh only when stale / not running
  useEffect(() => {
    let cancelled = false;
    let lastLatest = -1;

    const poll = async () => {
      try {
        const res = await fetch("/api/refresh-prices");
        const body = (await res.json()) as {
          latest?: number;
          total?: number;
          running?: boolean;
          weekFresh?: boolean;
        };
        if (cancelled) return;
        const latest = body.latest ?? 0;
        const total = body.total ?? 0;
        if (total > 0) setLatestProgress({ latest, total });
        if (latest !== lastLatest && lastLatest >= 0) {
          void onRefresh?.();
        }
        lastLatest = latest;
        if (!body.running && body.weekFresh === false) {
          void ensureWeeklyLows();
        }
      } catch {
        // ignore
      }
    };

    void ensureWeeklyLows();
    void poll();
    const id = window.setInterval(() => void poll(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ensureWeeklyLows, onRefresh]);

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
          <h2>Value & spending</h2>
          <p className="spend-lede">
            Paid vs market in one readout.
          </p>
        </div>
        <div className="spend-toolbar-actions">
          <p className="meta-line meta-line-emphasis">
            {meta.priceCacheUpdatedAt
              ? `Quotes updated ${new Date(meta.priceCacheUpdatedAt).toLocaleString()}`
              : "Market quotes load automatically"}
          </p>
          {!itadConnected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openItadExplain}
            >
              Get India lows
            </Button>
          ) : null}
          {itadStatus ? <p className="meta-line">{itadStatus}</p> : null}
          {itadError && !itadStep ? (
            <p className="meta-line" style={{ color: "#f87171" }}>
              {itadError}
            </p>
          ) : null}
        </div>
      </div>

      {itadStep && typeof document !== "undefined"
        ? createPortal(
            <div
              className="itad-key-overlay"
              role="dialog"
              aria-modal="true"
              aria-labelledby="itad-key-title"
              onClick={(e) => {
                if (e.target === e.currentTarget && !itadSaving) {
                  setItadStep(null);
                  setItadError(null);
                }
              }}
            >
              <div className="itad-key-card">
                {itadStep === "explain" ? (
                  <>
                    <h3 id="itad-key-title">Get Steam India all-time lows</h3>
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
                        Come back here, paste the key, and steam-stats stores
                        it locally — then refreshes Lowest.
                      </li>
                    </ol>
                    <p className="itad-key-note">
                      No browser automation. Your key stays on this machine
                      only.
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
              </div>
            </div>,
            document.body,
          )
        : null}

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
          <LowsLatestBar
            latest={latestProgress.latest}
            total={latestProgress.total}
          />
        ) : null}

        <section className="spend-section cph-section">
          <div className="spend-section-head">
            <div>
              <h3>Spend vs playtime</h3>
              <p>
                Cost per hour on library titles with a paid amount.
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
          <MonthRail
            rows={spending.monthly}
            money={money}
            selectedMonth={selectedMonth}
            onSelectMonth={(month) =>
              setSelectedMonth((prev) => (prev === month ? null : month))
            }
          />
        </section>

        <section className="spend-section panel-glass">
          <div className="spend-section-head">
            <div>
              <h3>Payment mix</h3>
              <p>How money left the wallet</p>
            </div>
          </div>
          <PaymentStack methods={spending.paymentMethods} money={money} />
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
                onClick={() => void syncGmail()}
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
                  Synced{" "}
                  {new Date(meta.mailGiftsLastSyncedAt).toLocaleDateString(
                    undefined,
                    {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    },
                  )}
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
            No gifts yet. Use <strong>Sync from Gmail</strong> to pull Steam
            gift emails.
          </p>
        )}
      </section>

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
