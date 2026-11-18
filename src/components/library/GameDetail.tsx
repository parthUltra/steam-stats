"use client";

import { ExternalLinkIcon, XIcon } from "lucide-react";
import { SteamArt } from "@/components/SteamArt";
import {
  formatDay,
  formatHours,
  formatMoney,
  formatMoneyPerHour,
} from "@/components/library/format";
import { isRecent, isUnplayed, type ShelfRow } from "@/components/library/model";
import { steamStoreUrl } from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";

function Fact({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "paid" | "now" | "low";
}) {
  return (
    <div className="fact" data-tone={tone}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Everything the payload knows about one title: playtime facts always, money
 * facts only when the Value data has a row for it.
 */
export function GameDetail({
  row,
  totalTitles,
  totalHours,
  currency,
  artwork,
  onClose,
}: {
  row: ShelfRow | null;
  totalTitles: number;
  totalHours: number;
  currency: string;
  artwork?: Record<string, ArtworkUrls>;
  onClose: () => void;
}) {
  return (
    <Dialog open={row != null} onClose={onClose}>
      {row ? (
        <DialogSurface side="right" className="game-drawer">
          <Body
            row={row}
            totalTitles={totalTitles}
            totalHours={totalHours}
            currency={currency}
            artwork={artwork}
          />
        </DialogSurface>
      ) : null}
    </Dialog>
  );
}

function Body({
  row,
  totalTitles,
  totalHours,
  currency,
  artwork,
}: {
  row: ShelfRow;
  totalTitles: number;
  totalHours: number;
  currency: string;
  artwork?: Record<string, ArtworkUrls>;
}) {
  const { game, value } = row;
  const unplayed = isUnplayed(game);
  const last = formatDay(game.lastPlayedAt);
  const added = formatDay(game.addedAt);
  const share = totalHours > 0 ? (game.hoursForever / totalHours) * 100 : 0;
  const hasMoney =
    value != null &&
    (value.paid != null ||
      value.current != null ||
      value.lowest != null ||
      value.costPerHour != null);

  return (
    <>
      <div className="drawer-head">
        <DialogTitle className="drawer-title">{game.name}</DialogTitle>
        <DialogClose
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close details"
            />
          }
        >
          <XIcon />
        </DialogClose>
      </div>

      <div className="game-drawer-art">
        <SteamArt
          appId={game.appId}
          name={game.name}
          artwork={artwork}
          variant="header"
          framed={false}
          alt=""
          sizes="(max-width: 640px) 100vw, 416px"
          priority
        />
      </div>

      {game.fromFamily || unplayed || value?.onSale ? (
        <p className="game-drawer-tags">
          {game.fromFamily ? <span className="tag">Family Library</span> : null}
          {unplayed ? <span className="tag">Unplayed</span> : null}
          {value?.onSale ? <span className="tag">On sale now</span> : null}
        </p>
      ) : null}

      <section aria-labelledby="game-playtime-title" className="drawer-section">
        <h3 id="game-playtime-title">Playtime</h3>
        <dl className="fact-grid">
          <Fact label="Hours">
            {unplayed ? (
              "None yet"
            ) : (
              <>
                <span className="mono">{formatHours(game.hoursForever)}</span> h
              </>
            )}
          </Fact>
          <Fact label="Last played">{last ?? "No record"}</Fact>
          <Fact label="Past 2 weeks">
            {isRecent(game) ? (
              <>
                <span className="mono">{formatHours(game.hours2Weeks ?? 0)}</span>{" "}
                h
              </>
            ) : game.hours2Weeks == null ? (
              "No record"
            ) : (
              "None"
            )}
          </Fact>
          {added ? <Fact label="Added">{added}</Fact> : null}
          <Fact label="Rank by hours">
            <span className="mono">{row.rank}</span> of{" "}
            <span className="mono">{totalTitles}</span>
          </Fact>
          {!unplayed ? (
            <Fact label="Share of all playtime">
              <span className="mono">
                {share >= 10 ? share.toFixed(0) : share.toFixed(1)}%
              </span>
            </Fact>
          ) : null}
        </dl>
      </section>

      <section aria-labelledby="game-value-title" className="drawer-section">
        <h3 id="game-value-title">Value</h3>
        {hasMoney && value ? (
          <>
            <dl className="fact-grid">
              {value.paid != null ? (
                <Fact label="Paid" tone="paid">
                  <span className="mono">{formatMoney(value.paid, currency)}</span>
                </Fact>
              ) : null}
              {value.current != null ? (
                <Fact label="Shelf now" tone="now">
                  <span className="mono">
                    {formatMoney(value.current, currency)}
                  </span>
                </Fact>
              ) : null}
              {value.lowest != null ? (
                <Fact label="Lowest" tone="low">
                  <span className="mono">
                    {formatMoney(value.lowest, currency)}
                  </span>
                </Fact>
              ) : null}
              {value.costPerHour != null ? (
                <Fact label="Cost per hour">
                  <span className="mono">
                    {formatMoneyPerHour(value.costPerHour, currency)}
                  </span>
                </Fact>
              ) : null}
            </dl>
            {value.note ? <p className="drawer-note">{value.note}</p> : null}
          </>
        ) : (
          <p className="drawer-note">
            {game.fromFamily
              ? "Played through Family Library, so there is no purchase or price on record for it."
              : "No purchase or store price on record for this title."}
          </p>
        )}
      </section>

      <div className="drawer-foot">
        <Button
          render={
            <a
              href={steamStoreUrl(game.appId)}
              target="_blank"
              rel="noreferrer"
            />
          }
          nativeButton={false}
          size="lg"
          className="w-full"
        >
          View on Steam
          <ExternalLinkIcon data-icon="inline-end" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </Button>
      </div>
    </>
  );
}
