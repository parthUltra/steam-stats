"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardPayload } from "@/lib/analytics/dashboard";
import { GameLibrary, type LibraryView } from "@/components/GameLibrary";
import { SpendingValue } from "@/components/SpendingValue";
import { GlossaryDrawer } from "@/components/GlossaryDrawer";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CircleHelpIcon } from "lucide-react";
import { useGmailSync } from "@/components/use-gmail-sync";
import { useItadKey } from "@/components/use-itad-key";
import type { LowsProgress } from "@/components/DashboardClient";

const STEAM_MARK = (
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden>
    <path
      fill="currentColor"
      d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.476 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.606 0 11.979 0zM7.54 18.205l-1.523-.633c.266.521.729.94 1.303 1.157 1.203.46 2.572-.08 3.032-1.285.227-.601.177-1.269-.146-1.821-.322-.551-.869-.94-1.517-1.068-.649-.13-1.317.07-1.828.478L7.54 18.205zm10.356-8.305c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"
    />
  </svg>
);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("[role='dialog'], [role='listbox']"));
}

export function DashboardView({
  data,
  onRefresh,
  lowsProgress,
  onRefreshLows,
}: {
  data: DashboardPayload;
  onRefresh?: () => Promise<void> | void;
  lowsProgress?: LowsProgress | null;
  onRefreshLows?: (opts?: { force?: boolean }) => Promise<void> | void;
}) {
  const [tab, setTab] = useState("library");
  const [libraryView, setLibraryView] = useState<LibraryView>("hours");
  const [libraryQuery, setLibraryQuery] = useState("");
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [glossaryFocus, setGlossaryFocus] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const gmail = useGmailSync(onRefresh);
  const itad = useItadKey(
    Boolean(data.meta.hasItadApiKey),
    onRefresh,
    onRefreshLows,
  );

  const openGlossary = useCallback((termId?: string) => {
    setGlossaryFocus(termId ?? null);
    setGlossaryOpen(true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) {
        if (e.key === "Escape" && e.target instanceof HTMLInputElement) {
          e.target.blur();
        }
        return;
      }

      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

      if (key === "/") {
        e.preventDefault();
        setTab("library");
        setLibraryView((v) => (v === "panorama" ? "hours" : v));
        queueMicrotask(() => searchRef.current?.focus());
        return;
      }

      if (key === "1" || key === "l") {
        e.preventDefault();
        setTab("library");
        return;
      }
      if (key === "2" || key === "v") {
        e.preventDefault();
        setTab("spending");
        return;
      }

      if (tab !== "library") return;

      if (key === "h") {
        e.preventDefault();
        setLibraryView("hours");
      } else if (key === "r") {
        e.preventDefault();
        setLibraryView("recent");
      } else if (key === "a") {
        e.preventDefault();
        setLibraryView("name");
      } else if (key === "p") {
        e.preventDefault();
        setLibraryView("panorama");
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab]);

  return (
    <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border/80 bg-card/80 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div
            className="pointer-events-none size-8 text-[#c7d5e0] [&_svg]:size-full"
            aria-hidden
          >
            {STEAM_MARK}
          </div>
          <div className="flex flex-col gap-0.5">
            <h1 className="text-xl font-bold tracking-tight">Steam Stats</h1>
            <p className="text-sm text-muted-foreground">
              Local library &amp; spend
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => openGlossary("shortcuts")}
            aria-label="Open glossary and shortcuts"
          >
            <CircleHelpIcon data-icon="inline-start" />
            Help
          </Button>
          <TabsList className="h-9">
            <TabsTrigger value="library" className="px-3.5">
              Library
            </TabsTrigger>
            <TabsTrigger value="spending" className="px-3.5">
              Value
            </TabsTrigger>
          </TabsList>
        </div>
      </header>

      <GlossaryDrawer
        open={glossaryOpen}
        focusId={glossaryFocus}
        onClose={() => setGlossaryOpen(false)}
      />

      <TabsContent value="library" className="mt-0 outline-none">
        <GameLibrary
          data={data}
          view={libraryView}
          onViewChange={setLibraryView}
          query={libraryQuery}
          onQueryChange={setLibraryQuery}
          searchInputRef={searchRef}
          onOpenGlossary={openGlossary}
        />
      </TabsContent>
      <TabsContent value="spending" className="mt-0 outline-none">
        <SpendingValue
          data={data}
          onOpenGlossary={openGlossary}
          lowsProgress={lowsProgress}
          gmail={gmail}
          itad={itad}
        />
      </TabsContent>
    </Tabs>
  );
}
