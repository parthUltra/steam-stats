"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { trapTab } from "@/components/ui/dialog";

/**
 * Centered modal card. `className` styles the full-screen overlay and
 * `cardClassName` the card inside it.
 *
 * Built on Base UI Dialog: focus moves into the card, Tab stays inside, Escape
 * and a press on the overlay close it (unless `busy`), page scroll locks, and
 * focus returns to the control that opened it.
 */
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
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          className={className}
          aria-labelledby={labelledBy}
          onKeyDown={trapTab}
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) onClose();
          }}
        >
          <div className={cardClassName}>{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
