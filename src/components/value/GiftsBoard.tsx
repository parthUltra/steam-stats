"use client";

import { useId, useMemo, type ReactNode } from "react";
import { RefreshCwIcon } from "lucide-react";
import type { MailGiftSummary } from "@/lib/analytics/contracts";
import type { ValuationGame } from "@/lib/analytics/valuation";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";
import { steamStoreUrl } from "@/lib/steam/artwork";
import { GlossaryHint } from "@/components/GlossaryDrawer";
import { Button } from "@/components/ui/button";
import type { GmailSyncChrome } from "@/components/use-gmail-sync";
import { formatDay, sortTime } from "@/components/value/format";
import { giftTitlesMatch } from "@/components/value/gift-titles";
import { SteamThumb } from "@/components/value/SteamThumb";

type GiftRow = {
  title: string;
  appId: number | null;
  person: string | null;
  date: string | null;
  amount: number | null;
};

type Group = { person: string | null; rows: GiftRow[]; subtotal: number };

function groupByPerson(rows: GiftRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const key = r.person ?? "";
    const g = map.get(key) ?? { person: r.person, rows: [], subtotal: 0 };
    g.rows.push(r);
    g.subtotal += r.amount ?? 0;
    map.set(key, g);
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.rows.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
  }
  // Largest first; the unnamed group always last.
  return groups.sort(
    (a, b) =>
      Number(a.person == null) - Number(b.person == null) ||
      b.subtotal - a.subtotal,
  );
}

function GiftTable({
  caption,
  groups,
  unnamed,
  amountLabel,
  showDate,
  money,
  artwork,
}: {
  caption: string;
  groups: Group[];
  unnamed: string;
  amountLabel: string;
  showDate: boolean;
  money: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
}) {
  const cols = showDate ? 3 : 2;
  return (
    <div className="v-table-wrap">
      <table className="v-table v-gift-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            {showDate ? (
              <th scope="col" className="v-col-date">
                Received
              </th>
            ) : null}
            <th scope="col" className="v-num">
              {amountLabel}
            </th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.person ?? "unnamed"}>
            <tr className="v-group-row">
              <th scope="rowgroup" colSpan={cols - 1}>
                <span className="v-group-name">{g.person ?? unnamed}</span>
                <span className="v-group-count">
                  {g.rows.length} {g.rows.length === 1 ? "gift" : "gifts"}
                </span>
              </th>
              <td className="v-num">{g.subtotal > 0 ? money(g.subtotal) : "—"}</td>
            </tr>
            {g.rows.map((r) => (
              <tr key={`${r.title}-${r.date ?? ""}`}>
                <td className="v-cell-title">
                  <span className="v-title">
                    <SteamThumb appId={r.appId} name={r.title} artwork={artwork} />
                    {r.appId ? (
                      <a
                        href={steamStoreUrl(r.appId)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {r.title}
                        <span className="sr-only"> (opens Steam store)</span>
                      </a>
                    ) : (
                      <span>{r.title}</span>
                    )}
                  </span>
                </td>
                {showDate ? (
                  <td className="v-col-date v-quiet">
                    {r.date ? formatDay(r.date) : "—"}
                  </td>
                ) : null}
                <td className="v-num v-quiet">
                  {r.amount != null ? money(r.amount) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

export function GiftsBoard({
  receivedGames,
  sentGames,
  mailGifts,
  receivedWorth,
  sentPaid,
  lastSyncedAt,
  gmail,
  money,
  artwork,
  onOpenGlossary,
  notice,
}: {
  receivedGames: ValuationGame[];
  sentGames: ValuationGame[];
  mailGifts: MailGiftSummary[];
  receivedWorth: number;
  sentPaid: number;
  lastSyncedAt: string | null;
  gmail: GmailSyncChrome;
  money: (n: number) => string;
  artwork?: Record<string, ArtworkUrls>;
  onOpenGlossary?: (termId?: string) => void;
  notice?: ReactNode;
}) {
  const receivedId = useId();
  const sentId = useId();
  const { mailSyncing, mailSyncError, mailSyncStatus, setGmailWizardOpen } = gmail;

  const received = useMemo(() => {
    const rows: GiftRow[] = receivedGames.map((g) => {
      const mail = mailGifts.find((m) => giftTitlesMatch(g.title, m.title));
      return {
        title: g.title,
        appId: g.steamAppId,
        person: g.giftedFrom ?? mail?.fromPersona ?? null,
        // Steam's licence date when the payload has it, else the gift email's.
        date: g.receivedAt ?? mail?.receivedAt ?? null,
        amount:
          g.current != null && g.current > 0
            ? g.current
            : g.lowest != null && g.lowest > 0
              ? g.lowest
              : null,
      };
    });
    for (const m of mailGifts) {
      if (receivedGames.some((g) => giftTitlesMatch(g.title, m.title))) continue;
      rows.push({
        title: m.title,
        appId: null,
        person: m.fromPersona,
        date: m.receivedAt,
        amount: null,
      });
    }
    return rows;
  }, [receivedGames, mailGifts]);

  const sent = useMemo<GiftRow[]>(
    () =>
      sentGames.map((g) => ({
        title: g.title,
        appId: g.steamAppId,
        person: g.giftedTo ?? null,
        date: null,
        amount: g.paid,
      })),
    [sentGames],
  );

  const receivedGroups = useMemo(() => groupByPerson(received), [received]);
  const sentGroups = useMemo(() => groupByPerson(sent), [sent]);
  const span = useMemo(() => {
    const dated = received
      .filter((r) => sortTime(r.date) > 0)
      .sort((a, b) => sortTime(a.date) - sortTime(b.date));
    if (dated.length === 0) return null;
    const first = formatDay(dated[0].date);
    const last = formatDay(dated[dated.length - 1].date);
    return first === last ? first : `${first} to ${last}`;
  }, [received]);

  const syncLine = mailSyncing && mailSyncStatus
    ? mailSyncStatus.replace(/\s*—\s*closing window\.?$/i, "")
    : mailSyncError
      ? null
      : mailSyncStatus
        ? mailSyncStatus
        : lastSyncedAt
          ? `Gmail synced ${formatDay(lastSyncedAt)}`
          : null;

  return (
    <section className="v-panel v-gifts" aria-label="Gifts">
      <div className="v-gifts-col" role="group" aria-labelledby={receivedId}>
        <div className="v-panel-head">
          <div>
            <h3 id={receivedId}>Gifts received</h3>
            <p>
              {received.length === 0 ? (
                "None listed yet."
              ) : (
                <>
                  <span className="mono">{received.length}</span>{" "}
                  {received.length === 1 ? "gift" : "gifts"} from{" "}
                  <span className="mono">
                    {receivedGroups.filter((g) => g.person).length}
                  </span>{" "}
                  {receivedGroups.filter((g) => g.person).length === 1
                    ? "person"
                    : "people"}
                  {span ? `, ${span}` : ""}
                  .
                </>
              )}
            </p>
          </div>
          {received.length > 0 ? (
            <div className="v-figure">
              <span className="v-figure-num mono cyan">{money(receivedWorth)}</span>
              <span className="v-figure-cap">worth today</span>
            </div>
          ) : null}
        </div>

        {received.length > 0 ? (
          <GiftTable
            caption="Gifts received, grouped by sender"
            groups={receivedGroups}
            unnamed="Sender not recorded"
            amountLabel="Worth today"
            showDate
            money={money}
            artwork={artwork}
          />
        ) : (
          <p className="v-empty">
            Steam lists no gifts on this account. Sync from Gmail
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
            pulls Steam gift emails into a local list.
          </p>
        )}

        {notice}

        <div className="v-gifts-sync">
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
          <span className="v-gifts-sync-text" aria-live="polite">
            {mailSyncError ? (
              <span className="v-error">{mailSyncError}</span>
            ) : (
              syncLine
            )}
          </span>
        </div>
      </div>

      <div className="v-gifts-col" role="group" aria-labelledby={sentId}>
        <div className="v-panel-head">
          <div>
            <h3 id={sentId}>Gifts sent</h3>
            <p>
              {sent.length === 0 ? (
                "No sent gifts in the purchase history."
              ) : (
                <>
                  <span className="mono">{sent.length}</span>{" "}
                  {sent.length === 1 ? "gift" : "gifts"} to{" "}
                  <span className="mono">
                    {sentGroups.filter((g) => g.person).length}
                  </span>{" "}
                  {sentGroups.filter((g) => g.person).length === 1
                    ? "person"
                    : "people"}
                  . Not counted in paid above.
                </>
              )}
            </p>
          </div>
          {sent.length > 0 || sentPaid > 0 ? (
            <div className="v-figure">
              <span className="v-figure-num mono amber">{money(sentPaid)}</span>
              <span className="v-figure-cap">you paid</span>
            </div>
          ) : null}
        </div>
        {sent.length > 0 ? (
          <GiftTable
            caption="Gifts sent, grouped by recipient"
            groups={sentGroups}
            unnamed="Recipient not recorded"
            amountLabel="Paid"
            showDate={false}
            money={money}
            artwork={artwork}
          />
        ) : null}
      </div>
    </section>
  );
}
