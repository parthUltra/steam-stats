"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  "a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex='-1'])";

export function ModalShell({
  open,
  onClose,
  labelledBy,
  className,
  cardClassName,
  busy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  className: string;
  cardClassName: string;
  busy?: boolean;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const card = cardRef.current;
    const focusables = () =>
      [...(card?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
      );
    focusables()[0]?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, busy, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={className}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div ref={cardRef} className={cardClassName}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
