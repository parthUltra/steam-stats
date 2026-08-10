"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

const TERMS: { id: string; term: string; body: string }[] = [
  {
    id: "shelf-now",
    term: "Shelf now",
    body: "What your playable library would cost today on Steam India (live store price when known).",
  },
  {
    id: "lowest",
    term: "Lowest",
    body: "All-time low on Steam India from IsThereAnyDeal. While calibrating, missing lows fall back to shelf now so the total is not blank.",
  },
  {
    id: "calibrating",
    term: "Calibrating",
    body: "India lows are still being fetched or cached for this week. Progress shows under Paid vs shelf.",
  },
  {
    id: "blended",
    term: "Blended library rate",
    body: "Total paid on matched titles ÷ total hours on those titles — one cost-per-hour for the played paid set.",
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
    term: "Get India lows",
    body: "Connect a free IsThereAnyDeal API key (stored only on this machine) to fill historical Steam India lows.",
  },
  {
    id: "shortcuts",
    term: "Keyboard shortcuts",
    body: "1 or L · Library · 2 or V · Value · H / R / A / P · Hours / Recent / A–Z / Panorama · / · focus search · Esc · close dialogs.",
  },
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
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !focusId || typeof document === "undefined") return;
    const el = document.getElementById(`glossary-${focusId}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [open, focusId]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="glossary-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="glossary-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside className="glossary-drawer">
        <div className="glossary-drawer-head">
          <h2 id="glossary-title">Glossary</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Close glossary"
            onClick={onClose}
          >
            <XIcon />
          </Button>
        </div>
        <p className="glossary-lede">
          Plain meanings for Value and Library terms. Everything stays on this
          machine.
        </p>
        <dl className="glossary-list">
          {TERMS.map((t) => (
            <div
              key={t.id}
              id={`glossary-${t.id}`}
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
      </aside>
    </div>,
    document.body,
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
