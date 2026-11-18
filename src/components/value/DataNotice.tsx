"use client";

import { ChevronDownIcon, InfoIcon } from "lucide-react";

/**
 * One gap in the data behind a number on screen: what is missing, and what it
 * does to the figures. `fix` is the one thing the owner can do about it.
 */
export type DataNote = {
  id: string;
  /** Short statement of the gap: "13 titles have no store price". */
  label: string;
  /** What it does to the numbers. */
  detail: string;
  fix?: string;
};

/**
 * The single data-quality pattern for the Value tab: one quiet line that sits
 * inside the board it qualifies and opens to the full explanation. Several
 * gaps share one line, so notices never stack into banners.
 */
export function DataNotice({
  notes,
  about,
}: {
  notes: DataNote[];
  /** What the notes qualify, for the accessible name: "these totals". */
  about: string;
}) {
  if (notes.length === 0) return null;
  const shown = notes.slice(0, 2);
  const more = notes.length - shown.length;
  return (
    <details className="v-notice">
      <summary aria-label={`${notes.length} data ${notes.length === 1 ? "note" : "notes"} about ${about}`}>
        <InfoIcon className="v-notice-icon" aria-hidden />
        <span className="v-notice-line">
          {shown.map((n, i) => (
            <span key={n.id}>
              {i > 0 ? <span aria-hidden> · </span> : null}
              {n.label}
            </span>
          ))}
          {more > 0 ? (
            <span>
              <span aria-hidden> · </span>
              {more} more
            </span>
          ) : null}
        </span>
        <ChevronDownIcon className="v-notice-chevron" aria-hidden />
      </summary>
      <ul className="v-notice-list">
        {notes.map((n) => (
          <li key={n.id}>
            <strong>{n.label}.</strong> {n.detail}
            {n.fix ? <span className="v-notice-fix"> {n.fix}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
