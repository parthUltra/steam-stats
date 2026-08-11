"use client";

import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { Loader2Icon, XIcon } from "lucide-react";
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
import { GlossaryHint } from "@/components/GlossaryDrawer";
import {
  formatPlayHours,
  rankMedalClass,
  steamStoreUrl,
} from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { resolveArtworkAppId, resolveSteamAppId } from "@/lib/steam/resolve-app-id";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export function formatQuietDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function moneyFmt(n: number, currency: string) {
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

export function giftTitlesMatch(a: string, b: string): boolean {
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

export function moneyPerHourFmt(n: number, currency: string) {
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

export function SteamThumb({
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

export type InspectMode = "spent" | "shelfNow" | "lowest";
export type InspectSortKey = "alpha" | "price";
export type InspectSortDir = "asc" | "desc";
export type InspectSort = { key: InspectSortKey; dir: InspectSortDir };

export type ValuationGameRow = DashboardPayload["valuation"]["games"][number];

export type InspectRow = {
  game: ValuationGameRow;
  amount: number | null;
};

export function looksLikeAddonPack(title: string): boolean {
  return /\b(collaboration pack|collab pack|cosmetic pack|soundtrack|deluxe upgrade|season pass)\b/i.test(
    title,
  );
}

/** Hide freebie DLC / collab packs that only clutter Lowest (₹0, no live price). */
export function isRedundantLowestRow(
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

export function buildInspectRows(
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

export function ShelfInspectModal({
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
        ? "Live Steam store price per playable game."
        : "Steam all-time low when stored — bought titles without a low still appear as —.";

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

export function TelemetryDuel({
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
  onOpenGlossary,
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
  onOpenGlossary?: (termId?: string) => void;
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
          <h2 className="telemetry-title">Paid vs shelf</h2>
          <p className="telemetry-lede">
            Click a total to list every title. Wallet spend versus what the
            playable shelf costs today and at its store low
            {showExcludeGiftsToggle && excludeReceivedGifts
              ? " (gifts received excluded)."
              : "."}
            {calibrating
              ? " Lowest is still filling in — known lows first, shelf now where missing."
              : ""}
          </p>
        </div>
      </div>

      <div className="telemetry-duel telemetry-duel-triple">
        <button
          type="button"
          className="telemetry-stat spent telemetry-stat-btn"
          onClick={() => onInspect("spent")}
          aria-label={`You spent ${money(spent)}. Open title list.`}
        >
          <span className="telemetry-label">You spent</span>
          <strong className="telemetry-num amber">{money(spent)}</strong>
          <span className="telemetry-sub">
            {purchaseCount} library buys · open list
          </span>
        </button>
        <div
          className="telemetry-vs telemetry-vs-quiet"
          aria-label={
            ahead
              ? `Shelf ahead by ${money(delta)}`
              : `Shelf behind by ${money(delta)}`
          }
        >
          <span aria-hidden>{ahead ? "▲" : "▼"}</span>
          <small>{money(delta)}</small>
        </div>
        <button
          type="button"
          className="telemetry-stat now telemetry-stat-btn"
          onClick={() => onInspect("shelfNow")}
          aria-label={`Shelf now ${money(current)}. Open title list.`}
        >
          <span className="telemetry-label">Shelf now</span>
          <strong className="telemetry-num cyan">{money(current)}</strong>
          <span className="telemetry-sub">Live store · open list</span>
        </button>
        <button
          type="button"
          className="telemetry-stat low telemetry-stat-btn"
          onClick={() => onInspect("lowest")}
          aria-label={`Lowest ${money(lowest)}. Open title list.`}
        >
          <span className="telemetry-label">
            Lowest
            {calibrating ? (
              <Loader2Icon className="telemetry-lowest-spinner" aria-hidden />
            ) : null}
          </span>
          <strong className="telemetry-num rose">{money(lowest)}</strong>
          <span className="telemetry-sub">
            {calibrating
              ? "Still filling lows · open list"
              : "All-time low · open list"}
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
          <span className="cyan">
            {onOpenGlossary ? (
              <GlossaryHint termId="shelf-now" onOpen={onOpenGlossary}>
                Shelf now
              </GlossaryHint>
            ) : (
              "Shelf now"
            )}
          </span>
          <span className="rose">
            {onOpenGlossary ? (
              <GlossaryHint
                termId={calibrating ? "calibrating" : "lowest"}
                onOpen={onOpenGlossary}
              >
                Lowest
              </GlossaryHint>
            ) : (
              "Lowest"
            )}
          </span>
        </div>
      </div>

      {showExcludeGiftsToggle ? (
        <div className="telemetry-exclude">
          <Switch
            checked={excludeReceivedGifts}
            onCheckedChange={onExcludeReceivedGifts}
            size="sm"
            id="exclude-gifts-switch"
          />
          <label htmlFor="exclude-gifts-switch">
            Exclude gifts from shelf now &amp; lowest
          </label>
          {onOpenGlossary ? (
            <GlossaryHint termId="exclude-gifts" onOpen={onOpenGlossary}>
              what this does
            </GlossaryHint>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function LowsLatestBar({
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
      aria-label="Titles with fresh store lows"
    >
      <span className="lows-refresh-progress-label">
        <span>{allLatest ? "Up to date · 7d" : "Store lows · 7d"}</span>
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

export function formatMonthLabel(monthKey: string) {
  const [y, m] = monthKey.split("-");
  if (!y || !m) return monthKey;
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}

export function formatMonthShort(monthKey: string) {
  const [y, m] = monthKey.split("-");
  if (!y || !m) return monthKey;
  const d = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(d.getTime())) return monthKey;
  return d.toLocaleString(undefined, { month: "short", year: "2-digit" });
}

export function MonthRail({
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
                {formatMonthShort(r.month)}
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

export function MonthPurchasePanel({
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

export function PaymentStack({
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
      <div
        className="pay-bar"
        role="img"
        aria-label={methods
          .map(
            (m) =>
              `${m.method} ${Math.round((m.spent / total) * 100)} percent`,
          )
          .join(", ")}
      >
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
              aria-hidden
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


export function CphSpotlight({
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
      <div className={`cph-spotlight cph-spotlight-empty ${tone}`}>
        <div className="cph-spotlight-fallback" aria-hidden />
        <div>
          <span className="cph-spotlight-label">{label}</span>
          <p className="muted">No data yet</p>
        </div>
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

export function CostPerHourRow({
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
