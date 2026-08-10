"use client";

import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";

export function GmailSyncWizard({
  open,
  busy,
  onCancel,
  onContinue,
}: {
  open: boolean;
  busy?: boolean;
  onCancel: () => void;
  onContinue: () => void;
}) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="setup-wizard-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="gmail-wizard-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="setup-wizard-card">
        <h3 id="gmail-wizard-title">Sync gifts from Gmail</h3>
        <ol className="setup-wizard-steps">
          <li>
            A <strong>separate</strong> browser window opens with an isolated
            profile — your everyday Chrome stays open.
          </li>
          <li>Sign into the Gmail that receives Steam gift mail.</li>
          <li>
            Steam Stats searches gift emails, saves titles locally, then closes
            that window.
          </li>
        </ol>
        <p className="setup-wizard-note">
          No mail passwords are stored in this app. You can cancel anytime.
        </p>
        <div className="setup-wizard-actions">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={onContinue}
          >
            Continue
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
