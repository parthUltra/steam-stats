"use client";

import { useMemo, useState } from "react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import type { CostPerHourGame } from "@/lib/analytics/cost-per-hour";
import { effectiveShelfNow } from "@/lib/analytics/valuation";
import { SteamArt } from "@/components/SteamArt";
import {
  formatPlayHours,
  rankMedalClass,
  steamStoreUrl,
} from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { resolveSteamAppId } from "@/lib/steam/resolve-app-id";
import { Button } from "@/components/ui/button";
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

function TelemetryDuel({
  spent,
  current,
  lowest,
  money,
  purchaseCount,
  includeUnpaid,
  onToggleUnpaid,
  unpaidBoost,
}: {
  spent: number;
  current: number;
  lowest: number;
  money: (n: number) => string;
  purchaseCount: number;
  includeUnpaid: boolean;
  onToggleUnpaid: (v: boolean) => void;
  unpaidBoost: number;
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
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={includeUnpaid}
            onCheckedChange={onToggleUnpaid}
            size="sm"
          />
          <span>Include free &amp; gifted to me</span>
        </label>
      </div>

      <div className="telemetry-duel">
        <div className="telemetry-stat spent">
          <span className="telemetry-label">You spent</span>
          <strong className="telemetry-num amber">{money(spent)}</strong>
          <span className="telemetry-sub">{purchaseCount} library buys</span>
        </div>
        <div className="telemetry-vs" aria-hidden>
          <span>{ahead ? "▲" : "▼"}</span>
          <small>{money(delta)}</small>
        </div>
        <div className="telemetry-stat now">
          <span className="telemetry-label">Shelf now</span>
          <strong className="telemetry-num cyan">{money(current)}</strong>
          <span className="telemetry-sub">
            Low {money(lowest)}
            {includeUnpaid && unpaidBoost > 0
              ? ` · +${money(unpaidBoost)} unpaid`
              : ""}
          </span>
        </div>
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
          <span className="cyan">Market now</span>
          <span className="rose">Hist. low {money(lowest)}</span>
        </div>
      </div>
    </section>
  );
}

function MonthRail({
  rows,
  money,
}: {
  rows: { month: string; spent: number; count: number }[];
  money: (n: number) => string;
}) {
  const slice = rows.slice(-14);
  const max = Math.max(...slice.map((r) => r.spent), 1);
  return (
    <div className="month-rail">
      {slice.map((r, i) => (
        <div
          key={r.month}
          className="month-rail-row"
          style={{ animationDelay: `${i * 35}ms` }}
        >
          <span className="month-rail-label">{r.month.replace(/^\d{2}/, "")}</span>
          <div className="month-rail-track">
            <span
              style={{
                ["--fill" as string]: Math.max(0.03, r.spent / max),
              }}
            />
          </div>
          <span className="month-rail-val mono">{money(r.spent)}</span>
        </div>
      ))}
    </div>
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

function kindChip(kind: DashboardPayload["valuation"]["games"][number]["kind"]) {
  if (kind === "gifted_to_me") return { label: "Gifted to me", className: "gift-in" };
  if (kind === "free") return { label: "Free", className: "free" };
  if (kind === "gifted_by_me") return { label: "Gifted away", className: "gift" };
  return { label: "Purchased", className: "lib" };
}

function DealCard({
  game,
  money,
  artwork,
}: {
  game: DashboardPayload["valuation"]["games"][number];
  money: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
}) {
  const paid = game.paid ?? 0;
  const nowListed =
    game.current != null && game.current > 0 ? game.current : null;
  const low = game.lowest != null && game.lowest > 0 ? game.lowest : null;
  const valueNow = effectiveShelfNow(game);
  const delta =
    valueNow != null && game.paid != null ? valueNow - paid : null;
  const goodDeal =
    game.kind === "purchased" &&
    paid > 0 &&
    valueNow != null &&
    valueNow > 0 &&
    paid < valueNow * 0.7;
  const chip = kindChip(game.kind);
  const paidLabel =
    game.isUnpaidShelf || paid === 0
      ? "Free"
      : game.paid != null
        ? money(paid)
        : "—";

  const body = (
    <>
      <SteamThumb
        appId={game.steamAppId}
        name={game.title}
        variant="portrait"
        artwork={artwork}
      />
      <div className="deal-card-body">
        <div className="deal-card-top">
          <span className={`deal-chip ${chip.className}`}>{chip.label}</span>
          {goodDeal ? <span className="deal-chip win">Under shelf</span> : null}
          {game.onSale ? <span className="deal-chip sale">On sale</span> : null}
          {nowListed == null && low != null ? (
            <span className="deal-chip muted-chip">Unlisted</span>
          ) : null}
        </div>
        <h4>{game.title}</h4>
        <div className="deal-prices">
          <div>
            <span>Paid</span>
            <strong className="amber">{paidLabel}</strong>
          </div>
          <div>
            <span>Now</span>
            <strong className="cyan">
              {nowListed != null ? money(nowListed) : "—"}
            </strong>
          </div>
          <div>
            <span>Low</span>
            <strong className="rose">{low != null ? money(low) : "—"}</strong>
          </div>
        </div>
        {game.isUnpaidShelf ? (
          <p className="deal-delta up">On your shelf · free from your wallet</p>
        ) : delta != null ? (
          <p className={`deal-delta ${delta >= 0 ? "up" : "down"}`}>
            {nowListed == null
              ? `Using hist. low · ${
                  delta >= 0
                    ? `+${money(delta)} vs paid`
                    : `${money(Math.abs(delta))} over low`
                }`
              : delta >= 0
                ? `+${money(delta)} vs today`
                : `${money(Math.abs(delta))} over today’s shelf`}
          </p>
        ) : (
          <p className="deal-delta muted">Awaiting price match</p>
        )}
      </div>
    </>
  );

  const cardClass = `deal-card ${game.isUnpaidShelf ? "unpaid" : ""} ${game.kind === "gifted_by_me" ? "gift" : ""}`;

  if (game.steamAppId) {
    return (
      <a
        className={cardClass}
        href={steamStoreUrl(game.steamAppId)}
        target="_blank"
        rel="noreferrer"
      >
        {body}
      </a>
    );
  }

  return <div className={cardClass}>{body}</div>;
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
  onRefreshPrices,
  refreshing,
}: {
  data: DashboardPayload;
  onRefreshPrices: () => void;
  refreshing: boolean;
}) {
  const { spending, valuation, recentPurchases, meta, costPerHour, artwork, playtime } =
    data;
  const currency = valuation.currency || spending.currency;
  const money = (n: number) => moneyFmt(n, currency);
  const moneyHr = (n: number) => moneyPerHourFmt(n, currency);
  const [includeUnpaid, setIncludeUnpaid] = useState(true);
  const [filter, setFilter] = useState<"all" | "paid" | "unpaid">("all");
  const [cphView, setCphView] = useState<"best" | "worst" | "unplayed">(
    "best",
  );
  const [cphLimit, setCphLimit] = useState(12);

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
  const shelf = includeUnpaid ? valuation.shelfFull : valuation.shelfPaidOnly;
  const unpaid = valuation.unpaidShelf;
  const giftsSent = valuation.giftsSent;

  const dealGames = useMemo(() => {
    let list = valuation.games.filter((g) => g.resolved);
    if (filter === "paid") list = list.filter((g) => g.kind === "purchased");
    if (filter === "unpaid") list = list.filter((g) => g.isUnpaidShelf);
    return list.slice(0, 18);
  }, [valuation.games, filter]);

  const biggestWithArt = useMemo(() => {
    return spending.biggestPurchases.slice(0, 8).map((p) => {
      const title = p.items[0] ?? "Purchase";
      return {
        ...p,
        title,
        appId: resolveSteamAppId(title, titleCatalog),
      };
    });
  }, [spending.biggestPurchases, titleCatalog]);

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

  return (
    <div className="spend-shell tab-panel">
      <div className="spend-toolbar">
        <div>
          <h2>Value & spending</h2>
          <p className="spend-lede">
            Paid vs market in one readout — gifts you sent stay off the shelf.
          </p>
        </div>
        <div className="spend-toolbar-actions">
          <Button
            type="button"
            onClick={onRefreshPrices}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing…" : "Refresh market prices"}
          </Button>
          <p className="meta-line meta-line-emphasis">
            {meta.priceCacheUpdatedAt
              ? `Quotes updated ${new Date(meta.priceCacheUpdatedAt).toLocaleString()}`
              : "No price cache yet — refresh to load market quotes"}
          </p>
        </div>
      </div>

      <TelemetryDuel
        spent={spent}
        current={shelf.current}
        lowest={shelf.lowest}
        money={money}
        purchaseCount={spending.purchaseCount}
        includeUnpaid={includeUnpaid}
        onToggleUnpaid={setIncludeUnpaid}
        unpaidBoost={unpaid.current}
      />

      {giftsSent.spent > 0 || (valuation.giftsSentGames?.length ?? 0) > 0 ? (
        <section className="spend-section gifts-sent-section">
          <div className="spend-section-head">
            <div>
              <h3>Gifts I sent</h3>
              <p>
                Wallet outflow for games bought for others — not part of your
                library value.
              </p>
            </div>
            <span className="gifts-sent-total mono amber">
              {money(giftsSent.spent)}
            </span>
          </div>
          <div className="purchase-rail">
            {(valuation.giftsSentGames ?? []).slice(0, 8).map((g) => (
              <div key={g.title} className="purchase-chip-card">
                <SteamThumb appId={g.steamAppId} name={g.title} artwork={artwork} />
                <div>
                  <strong>{g.title}</strong>
                  <small>Gifted away</small>
                </div>
                <span className="mono amber">
                  {g.paid != null ? money(g.paid) : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="spend-section cph-section">
        <div className="spend-section-head">
          <div>
            <h3>Spend vs playtime</h3>
            <p>
              Cost per hour on library titles with a paid amount. Gifts you
              sent are excluded.
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

      <section className="spend-section">
        <div className="spend-section-head">
          <div>
            <h3>Cost basis vs shelf</h3>
            <p>Steam cards with paid / now / lowest from transaction line items.</p>
          </div>
          <ToggleGroup
            value={[filter]}
            onValueChange={(next) => {
              const v = next[0] as "all" | "paid" | "unpaid" | undefined;
              if (v) setFilter(v);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Filter deals"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="paid">Purchased</ToggleGroupItem>
            <ToggleGroupItem value="unpaid">Free / gifted</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="deal-grid">
          {dealGames.map((g) => (
            <DealCard
              key={`${g.title}-${g.isGift ? "g" : "l"}`}
              game={g}
              money={money}
              artwork={artwork}
            />
          ))}
        </div>
      </section>

      <section className="spend-section">
        <div className="spend-section-head">
          <div>
            <h3>Biggest library purchases</h3>
            <p>High-ticket checkouts that shaped your shelf.</p>
          </div>
        </div>
        <div className="purchase-rail">
          {biggestWithArt.map((p) => (
            <div key={`${p.date}-${p.title}`} className="purchase-chip-card">
              <SteamThumb appId={p.appId} name={p.title} artwork={artwork} />
              <div>
                <strong>{p.title}</strong>
                {p.items.length > 1 ? (
                  <small>+{p.items.length - 1} more in checkout</small>
                ) : (
                  <small>{p.date}</small>
                )}
              </div>
              <span className="mono amber">{money(p.total)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="two-col signal-grid spend-secondary">
        <section className="spend-section panel-glass">
          <div className="spend-section-head">
            <div>
              <h3>Spend by month</h3>
              <p>What left the wallet over time</p>
            </div>
          </div>
          <MonthRail rows={spending.monthly} money={money} />
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
