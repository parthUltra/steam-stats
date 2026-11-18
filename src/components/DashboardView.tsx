"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CircleHelpIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { DISPLAY_TZ_ATTR, displayTimeZone } from "@/components/dates";
import { formatDay } from "@/components/library/format";
import { GameDetail } from "@/components/library/GameDetail";
import { GameLibrary } from "@/components/library/GameLibrary";
import { buildRows, buildValueIndex } from "@/components/library/model";
import {
  useUrlState,
  type AppTab,
  type UrlPatch,
} from "@/components/library/use-url-state";
import { SpendingValue } from "@/components/SpendingValue";
import { GlossaryDrawer } from "@/components/GlossaryDrawer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useShortcutsPref } from "@/components/ui/use-shortcuts-pref";
import { useGmailSync } from "@/components/use-gmail-sync";
import { useItadKey } from "@/components/use-itad-key";
import type { LowsProgress, PriceStatus } from "@/components/DashboardClient";

const STEAM_MARK = (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      fill="currentColor"
      d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.476 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.606 0 11.979 0zM7.54 18.205l-1.523-.633c.266.521.729.94 1.303 1.157 1.203.46 2.572-.08 3.032-1.285.227-.601.177-1.269-.146-1.821-.322-.551-.869-.94-1.517-1.068-.649-.13-1.317.07-1.828.478L7.54 18.205zm10.356-8.305c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"
    />
  </svg>
);

/** Steam mark + product name; the only brand element in the app bar. */
export function AppBrand() {
  return (
    <div className="app-brand">
      <span className="app-brand-mark" aria-hidden>
        {STEAM_MARK}
      </span>
      <h1>Steam Stats</h1>
    </div>
  );
}

/**
 * Single-key shortcuts must not fire while typing, from a focused control
 * (Space/Enter/letters belong to it), or behind an open dialog.
 */
function shortcutBlocked(target: EventTarget | null): boolean {
  if (document.querySelector("[role='dialog'], [role='alertdialog']")) return true;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(
    target.closest(
      "input, textarea, select, button, a[href], summary, [role='button'], [role='tab'], [role='switch'], [role='listbox'], [role='menu'], [contenteditable='true']",
    ),
  );
}

const ISSUE_TITLE: Record<string, string> = {
  "price-cache-unreadable": "The price cache could not be read",
  "received-gifts-unreadable": "The received gifts file could not be read",
};

const ISSUE_EFFECT: Record<string, string> = {
  "price-cache-unreadable":
    "Shelf prices and store lows are missing until prices are refreshed, so Value totals are not meaningful right now.",
  "received-gifts-unreadable":
    "Gifts imported from Gmail are missing from the shelf and from Value.",
};

function PriceStatusControl({
  status,
  onRefresh,
}: {
  status: PriceStatus;
  onRefresh: () => void;
}) {
  const day = formatDay(status.updatedAt);
  const running = status.phase === "running";

  let text: React.ReactNode;
  let detail: string;
  if (running) {
    text = (
      <>
        Refreshing prices
        {status.total > 0 ? (
          <>
            {" "}
            <span className="mono">
              {status.latest}/{status.total}
            </span>
          </>
        ) : null}
      </>
    );
    detail = "Fetching current store prices and all-time lows.";
  } else if (status.phase === "error") {
    text = "Price refresh failed";
    detail = status.message ?? "The price refresh did not start.";
  } else if (!day) {
    text = "No prices stored yet";
    detail = "Store prices have not been fetched on this machine yet.";
  } else {
    text = (
      <>
        Prices stored {day}
        {status.phase === "offline" ? " · offline" : null}
      </>
    );
    detail =
      status.phase === "offline"
        ? "Offline mode: the weekly price refresh is skipped and stored prices are shown."
        : status.stale
          ? "Stored prices are more than a week old."
          : "Store prices refresh about once a week.";
  }

  return (
    <div className="price-status" data-phase={status.phase}>
      <p className="price-status-text" role="status" title={detail}>
        <span className="price-status-dot" aria-hidden />
        <span className="price-status-label">{text}</span>
        <span className="sr-only">. {detail}</span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Refresh store prices now"
        title="Refresh store prices now"
        disabled={running}
        onClick={onRefresh}
      >
        <RefreshCwIcon className={running ? "animate-spin" : undefined} />
      </Button>
    </div>
  );
}

export function DashboardView({
  data,
  onRefresh,
  lowsProgress,
  onRefreshLows,
  priceStatus,
}: {
  data: DashboardPayload;
  onRefresh?: () => Promise<void> | void;
  lowsProgress?: LowsProgress | null;
  onRefreshLows?: (opts?: { force?: boolean }) => Promise<void> | void;
  priceStatus?: PriceStatus;
}) {
  const [url, writeUrl] = useUrlState();
  const { tab, sort, layout, filters } = url;

  // The search box owns its text; the URL mirrors it (debounced) and feeds it
  // back on back/forward.
  const [query, setQuery] = useState(url.query);
  const queryTimer = useRef<number | null>(null);
  const changeQuery = useCallback(
    (next: string) => {
      setQuery(next);
      if (queryTimer.current != null) window.clearTimeout(queryTimer.current);
      queryTimer.current = window.setTimeout(() => {
        queryTimer.current = null;
        writeUrl({ query: next }, "replace");
      }, 250);
    },
    [writeUrl],
  );
  useEffect(() => {
    const onPop = () => {
      setQuery(new URLSearchParams(window.location.search).get("q") ?? "");
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (queryTimer.current != null) window.clearTimeout(queryTimer.current);
    };
  }, []);

  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryFocus, setGlossaryFocus] = useState<string | null>(null);
  const [shortcutsOn] = useShortcutsPref();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const gmail = useGmailSync(onRefresh, onRefreshLows);
  const itad = useItadKey(
    Boolean(data.meta.hasItadApiKey),
    onRefresh,
    onRefreshLows,
  );

  const openGlossary = useCallback((termId?: string) => {
    setGlossaryFocus(termId ?? null);
    setGlossaryOpen(true);
  }, []);

  const rows = useMemo(
    () => buildRows(data.playtime.games, buildValueIndex(data)),
    [data],
  );
  const openRow = useMemo(
    () =>
      url.game == null
        ? null
        : (rows.find((r) => r.game.appId === url.game) ?? null),
    [rows, url.game],
  );
  // Opening a game adds a history entry, so Back closes the drawer. Closing
  // it by hand steps back over that entry instead of stacking another one.
  const gamePushed = useRef(false);
  const openGame = useCallback(
    (appId: number) => {
      gamePushed.current = true;
      writeUrl({ game: appId }, "push");
    },
    [writeUrl],
  );
  const closeGame = useCallback(() => {
    if (gamePushed.current) {
      gamePushed.current = false;
      window.history.back();
    } else {
      writeUrl({ game: null }, "replace");
    }
  }, [writeUrl]);

  const patchLibrary = useCallback(
    (patch: UrlPatch) => writeUrl(patch, "push"),
    [writeUrl],
  );

  // Scroll position is remembered per tab: saved when leaving a tab (by click,
  // shortcut or Back/Forward) and restored once the other tab is in the DOM.
  const scrollByTab = useRef<Record<AppTab, number>>({ library: 0, spending: 0 });
  const tabRef = useRef(tab);
  const firstTabRender = useRef(true);
  useEffect(() => {
    const onPop = () => {
      scrollByTab.current[tabRef.current] = window.scrollY;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useLayoutEffect(() => {
    tabRef.current = tab;
    if (firstTabRender.current) {
      firstTabRender.current = false;
      return;
    }
    // The incoming panel can reach full height a frame or two after it
    // mounts, so keep asking until the saved offset is reachable.
    const target = scrollByTab.current[tab] ?? 0;
    let frame = 0;
    let tries = 0;
    const restore = () => {
      window.scrollTo(0, target);
      if (Math.abs(window.scrollY - target) > 1 && tries++ < 12) {
        frame = window.requestAnimationFrame(restore);
      }
    };
    restore();
    return () => window.cancelAnimationFrame(frame);
  }, [tab]);

  const setTab = useCallback(
    (next: AppTab) => {
      scrollByTab.current[tabRef.current] = window.scrollY;
      writeUrl({ tab: next }, "push");
    },
    [writeUrl],
  );

  useEffect(() => {
    if (!shortcutsOn) return;
    const focusHeading = (id: string) => {
      // After a shortcut swaps the view, put focus on its heading so the next
      // Tab starts from the new content.
      window.setTimeout(() => {
        document.getElementById(id)?.focus({ preventScroll: true });
      }, 0);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.defaultPrevented || e.repeat) return;
      if (shortcutBlocked(e.target)) return;

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (key === "/") {
        e.preventDefault();
        if (tab !== "library") setTab("library");
        if (layout === "panorama") writeUrl({ layout: "grid" }, "push");
        window.setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (key === "1" || key === "l") {
        e.preventDefault();
        setTab("library");
        focusHeading("library-title");
        return;
      }
      if (key === "2" || key === "v") {
        e.preventDefault();
        setTab("spending");
        focusHeading("main");
        return;
      }

      if (tab !== "library") return;

      const patch: UrlPatch | null =
        key === "h"
          ? { sort: "hours", ...(layout === "panorama" ? { layout: "grid" } : {}) }
          : key === "r"
            ? { sort: "recent", ...(layout === "panorama" ? { layout: "grid" } : {}) }
            : key === "a"
              ? { sort: "name", ...(layout === "panorama" ? { layout: "grid" } : {}) }
              : key === "g"
                ? { layout: "grid" }
                : key === "t"
                  ? { layout: "list" }
                  : key === "p"
                    ? { layout: "panorama" }
                    : null;
      if (patch) {
        e.preventDefault();
        writeUrl(patch, "push");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcutsOn, tab, layout, setTab, writeUrl]);

  const wide = tab === "library";

  return (
    <Tabs
      value={tab}
      onValueChange={(next) => setTab(next === "spending" ? "spending" : "library")}
      className="app"
    >
      {/* Stamps the render's time zone so the browser formats dates the same way. */}
      <header className="app-bar" {...{ [DISPLAY_TZ_ATTR]: displayTimeZone() }}>
        <div className="app-bar-inner shell" data-wide={wide}>
          <AppBrand />
          <TabsList className="app-tabs" aria-label="Sections">
            <TabsTrigger value="library">Library</TabsTrigger>
            <TabsTrigger value="spending">Value</TabsTrigger>
          </TabsList>
          <div className="app-bar-end">
            {priceStatus ? (
              <PriceStatusControl
                status={priceStatus}
                onRefresh={() => void onRefreshLows?.({ force: true })}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="app-help"
              onClick={() => openGlossary("shortcuts")}
              aria-label="Help: glossary and keyboard shortcuts"
            >
              <CircleHelpIcon data-icon="inline-start" />
              <span className="app-help-label">Help</span>
            </Button>
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="shell app-main" data-wide={wide}>
        {/* An unreadable cache file changes every number below: say so first. */}
        {(data.meta.dataIssues ?? []).length > 0 ? (
          <div className="app-issue" role="status">
            <TriangleAlertIcon aria-hidden />
            <div>
              {(data.meta.dataIssues ?? []).map((issue) => (
                <p key={issue.code}>
                  <strong>{ISSUE_TITLE[issue.code] ?? "A cache file is unreadable"}.</strong>{" "}
                  {ISSUE_EFFECT[issue.code] ?? "The dashboard is showing what it could read without it."}{" "}
                  <span className="app-issue-file">
                    {issue.backup
                      ? `${issue.file} was left untouched; a backup is at ${issue.backup}.`
                      : `${issue.file} was left untouched; there is no backup.`}
                  </span>
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <TabsContent value="library" tabIndex={-1} className="app-panel">
          <GameLibrary
            data={data}
            rows={rows}
            sort={sort}
            layout={layout}
            filters={filters}
            query={query}
            onQueryChange={changeQuery}
            onPatch={patchLibrary}
            searchInputRef={searchRef}
            onOpenGlossary={openGlossary}
            onOpenGame={openGame}
          />
        </TabsContent>
        <TabsContent value="spending" tabIndex={-1} className="app-panel">
          <SpendingValue
            data={data}
            onOpenGlossary={openGlossary}
            lowsProgress={lowsProgress}
            gmail={gmail}
            itad={itad}
          />
        </TabsContent>
      </main>

      <GlossaryDrawer
        open={glossaryOpen}
        focusId={glossaryFocus}
        onClose={() => setGlossaryOpen(false)}
      />
      <GameDetail
        row={openRow}
        totalTitles={rows.length}
        totalHours={data.playtime.totalHours}
        currency={data.valuation.currency || data.spending.currency}
        artwork={data.artwork}
        onClose={closeGame}
      />
    </Tabs>
  );
}
