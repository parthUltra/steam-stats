"use client";

import { RefreshCwIcon } from "lucide-react";
import { ModalShell } from "@/components/ModalShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ItadKeyChrome } from "@/components/use-itad-key";

/** The two-step IsThereAnyDeal key flow. Behaviour lives in `useItadKey`. */
export function ItadKeyDialog({ itad }: { itad: ItadKeyChrome }) {
  const {
    itadStep,
    setItadStep,
    itadKeyDraft,
    setItadKeyDraft,
    itadSaving,
    itadError,
    setItadError,
    continueToItadApps,
    saveItadKey,
  } = itad;

  return (
    <ModalShell
      open={Boolean(itadStep)}
      onClose={() => {
        if (!itadSaving) {
          setItadStep(null);
          setItadError(null);
        }
      }}
      labelledBy="itad-key-title"
      className="itad-key-overlay"
      cardClassName="itad-key-card"
      busy={itadSaving}
    >
      {itadStep === "explain" ? (
        <>
          <h3 id="itad-key-title">Connect store all-time lows</h3>
          <ol className="itad-key-steps">
            <li>
              Continue opens IsThereAnyDeal Apps in a new tab (sign in there if
              asked).
            </li>
            <li>
              Register an app (any name, e.g.{" "}
              <span className="mono">steam-stats</span>) and copy the API key.
            </li>
            <li>
              Come back here, paste the key. It stays on this machine only —
              then Lowest refreshes.
            </li>
          </ol>
          <p className="itad-key-note">
            No browser automation. You can cancel anytime.
          </p>
          <div className="itad-key-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setItadStep(null)}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={continueToItadApps}>
              Continue
            </Button>
          </div>
        </>
      ) : (
        <>
          <h3 id="itad-key-title">Paste your API key</h3>
          <p className="itad-key-note">
            After you create the key on IsThereAnyDeal, paste it below. If the
            other tab is still open, finish there first.
          </p>
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste IsThereAnyDeal API key"
            aria-label="IsThereAnyDeal API key"
            // The step's first button is gone after Continue: put focus on the field.
            autoFocus
            value={itadKeyDraft}
            onChange={(e) => setItadKeyDraft(e.target.value)}
            disabled={itadSaving}
          />
          {itadError ? <p className="itad-key-error">{itadError}</p> : null}
          <div className="itad-key-actions">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={itadSaving}
              onClick={() => {
                setItadStep(null);
                setItadError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={itadSaving}
              onClick={continueToItadApps}
            >
              Open Apps again
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={itadSaving || itadKeyDraft.trim().length < 16}
              onClick={() => void saveItadKey()}
            >
              {itadSaving ? (
                <>
                  <RefreshCwIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                  Saving…
                </>
              ) : (
                "Save key"
              )}
            </Button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
