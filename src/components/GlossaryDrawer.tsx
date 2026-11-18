"use client";

import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useShortcutsPref } from "@/components/ui/use-shortcuts-pref";

const TERMS: { id: string; term: string; body: React.ReactNode }[] = [
  {
    id: "shelf-now",
    term: "Shelf now",
    body: "What your playable library would cost today on Steam (live store price when known).",
  },
  {
    id: "lowest",
    term: "Lowest",
    body: "Steam all-time low from IsThereAnyDeal. While calibrating, missing lows fall back to shelf now so the total is not blank.",
  },
  {
    id: "calibrating",
    term: "Calibrating",
    body: "Store lows are still being fetched or cached for this week. Progress shows under Paid vs shelf.",
  },
  {
    id: "blended",
    term: "Blended library rate",
    body: "Total paid on the played titles you paid for, divided by their hours: one cost per hour for the whole set. Each title played under an hour counts as one hour in the division, so no title's rate can exceed what it cost; the hours shown beside the rate are the hours actually played.",
  },
  {
    id: "exclude-gifts",
    term: "Exclude gifts",
    body: "Drops gifts you received from shelf now and lowest totals so the duel reflects what you paid for.",
  },
  {
    id: "gmail-sync",
    term: "Sync from Gmail",
    body: "Opens a separate browser window (isolated profile) so you can sign into Gmail and import Steam gift emails. Your everyday browser stays untouched.",
  },
  {
    id: "india-lows",
    term: "Get store lows",
    body: "Connect a free IsThereAnyDeal API key (stored only on this machine) to fill historical Steam store lows.",
  },
  {
    id: "price-refresh",
    term: "Store prices",
    body: "Shelf prices and store lows are cached on this machine and refreshed about once a week when you open the dashboard. The header shows when they were last stored; the refresh button there starts a new pass.",
  },
  {
    id: "partial-library",
    term: "Partial library",
    body: (
      <>
        The shelf was read from your Account Data games page, which can list
        fewer titles than you own. Run{" "}
        <code className="mono">npm run fetch:owned-games</code> to load the
        full owned set. If Steam asks you to sign in again, run{" "}
        <code className="mono">npm run launch</code> first.
      </>
    ),
  },
  {
    id: "panorama",
    term: "Panorama",
    body: "Every title with at least 30 minutes of playtime as one wall of store art. Rows get shorter as hours drop, so the tallest art is what you played most. Download saves the same wall as a PNG.",
  },
];

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["1", "L"], action: "Library" },
  { keys: ["2", "V"], action: "Value" },
  { keys: ["/"], action: "Search the shelf" },
  { keys: ["H"], action: "Sort by hours" },
  { keys: ["R"], action: "Sort by recent" },
  { keys: ["A"], action: "Sort A–Z" },
  { keys: ["G"], action: "Grid view" },
  { keys: ["T"], action: "List view" },
  { keys: ["P"], action: "Panorama view" },
  { keys: ["Esc"], action: "Close a dialog, or clear the search" },
];

export function GlossaryDrawer({
  open,
  onClose,
  focusId,
}: {
  open: boolean;
  onClose: () => void;
  focusId?: string | null;
}) {
  const [shortcutsOn, setShortcutsOn] = useShortcutsPref();

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogSurface side="right" className="help-drawer">
        <div className="drawer-head">
          <DialogTitle className="drawer-title">Help</DialogTitle>
          <DialogClose
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Close help"
              />
            }
          >
            <XIcon />
          </DialogClose>
        </div>
        <DialogDescription className="drawer-lede">
          Shortcuts and plain meanings for Library and Value terms. Everything
          stays on this machine.
        </DialogDescription>

        <section
          id="glossary-shortcuts"
          aria-labelledby="help-shortcuts-title"
          className={
            focusId === "shortcuts" ? "help-block help-block-focus" : "help-block"
          }
        >
          <div className="help-block-head">
            <h3 id="help-shortcuts-title">Keyboard shortcuts</h3>
            <label className="help-switch">
              <span>{shortcutsOn ? "On" : "Off"}</span>
              <Switch
                checked={shortcutsOn}
                onCheckedChange={(v) => setShortcutsOn(Boolean(v))}
                aria-label="Single-key shortcuts"
              />
            </label>
          </div>
          <dl
            className="shortcut-list"
            data-disabled={shortcutsOn ? undefined : "true"}
          >
            {SHORTCUTS.map((s) => (
              <div key={s.action}>
                <dt>
                  {s.keys.map((k, i) => (
                    <span key={k}>
                      {i > 0 ? <span className="shortcut-or"> or </span> : null}
                      <kbd>{k}</kbd>
                    </span>
                  ))}
                </dt>
                <dd>{s.action}</dd>
              </div>
            ))}
          </dl>
          <p className="help-note">
            Single keys are ignored with Ctrl, Alt, ⌘ or Shift held, while you
            type, while a button or link has focus, and while a dialog is open.
            In Panorama, arrow keys move between titles.
          </p>
        </section>

        <section aria-labelledby="help-glossary-title" className="help-block">
          <div className="help-block-head">
            <h3 id="help-glossary-title">Glossary</h3>
          </div>
          <dl className="glossary-list">
            {TERMS.map((t) => (
              <div
                key={t.id}
                id={`glossary-${t.id}`}
                ref={
                  focusId === t.id
                    ? (el) => el?.scrollIntoView({ block: "center" })
                    : undefined
                }
                className={
                  focusId === t.id
                    ? "glossary-item glossary-item-focus"
                    : "glossary-item"
                }
              >
                <dt>{t.term}</dt>
                <dd>{t.body}</dd>
              </div>
            ))}
          </dl>
        </section>
      </DialogSurface>
    </Dialog>
  );
}

export function GlossaryHint({
  termId,
  children,
  onOpen,
}: {
  termId: string;
  children: React.ReactNode;
  onOpen: (termId: string) => void;
}) {
  return (
    <button
      type="button"
      className="glossary-hint"
      onClick={() => onOpen(termId)}
      aria-label={`Explain ${typeof children === "string" ? children : termId}`}
    >
      {children}
      <span className="glossary-hint-mark" aria-hidden>
        ?
      </span>
    </button>
  );
}
