"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"

/**
 * Modal surfaces on Base UI Dialog: focus moves in, Tab is trapped, Escape and
 * outside press close, page scroll locks, focus returns to the opener.
 *
 * `side="right"` is the drawer (glossary, game detail); `side="center"` is a
 * centered card.
 */
function Dialog({
  open,
  onClose,
  dismissible = true,
  children,
}: {
  open: boolean
  onClose: () => void
  /** False while a pending action must not be interrupted. */
  dismissible?: boolean
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && dismissible) onClose()
      }}
    >
      {children}
    </DialogPrimitive.Root>
  )
}

const TABBABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

/**
 * Wrap Tab at the edges of a dialog synchronously. Base UI's focus guards do
 * the same one frame later; this closes that gap for fast key repeats.
 */
function trapTab(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "Tab") return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      !el.hasAttribute("data-base-ui-focus-guard") &&
      el.tabIndex >= 0 &&
      el.getClientRects().length > 0,
  )
  if (items.length === 0) {
    e.preventDefault()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === e.currentTarget)) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && active === last) {
    e.preventDefault()
    first.focus()
  }
}

function DialogSurface({
  side = "center",
  className,
  children,
  ...props
}: DialogPrimitive.Popup.Props & {
  side?: "center" | "right"
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="dialog-backdrop" />
      <DialogPrimitive.Popup
        data-slot="dialog"
        data-side={side}
        className={cn("dialog-surface", className)}
        {...props}
        onKeyDown={(e) => {
          trapTab(e)
          props.onKeyDown?.(e)
        }}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

const DialogTitle = DialogPrimitive.Title
const DialogDescription = DialogPrimitive.Description
const DialogClose = DialogPrimitive.Close

export { Dialog, DialogSurface, trapTab, DialogTitle, DialogDescription, DialogClose }
