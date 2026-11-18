"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import type {
  LibraryFilters,
  LibraryLayout,
  LibrarySort,
  PlayedFilter,
} from "@/components/library/model";

export type AppTab = "library" | "spending";

export type UrlState = {
  tab: AppTab;
  sort: LibrarySort;
  layout: LibraryLayout;
  filters: LibraryFilters;
  query: string;
  /** appId of the open game detail, if any. */
  game: number | null;
};

export type UrlPatch = Partial<{
  tab: AppTab;
  sort: LibrarySort;
  layout: LibraryLayout;
  played: PlayedFilter;
  family: boolean;
  recent: boolean;
  query: string;
  game: number | null;
}>;

const SORT_TO_PARAM: Record<LibrarySort, string | null> = {
  hours: null,
  recent: "recent",
  name: "az",
};

function parse(params: URLSearchParams): UrlState {
  const sortParam = params.get("sort");
  const viewParam = params.get("view");
  const showParam = params.get("show");
  const gameParam = Number(params.get("game"));
  return {
    tab: params.get("tab") === "value" ? "spending" : "library",
    sort: sortParam === "recent" ? "recent" : sortParam === "az" ? "name" : "hours",
    layout:
      viewParam === "list" ? "list" : viewParam === "panorama" ? "panorama" : "grid",
    filters: {
      played:
        showParam === "played" || showParam === "unplayed" ? showParam : "all",
      family: params.get("family") === "1",
      recent: params.get("recent") === "1",
    },
    query: params.get("q") ?? "",
    game: Number.isInteger(gameParam) && gameParam > 0 ? gameParam : null,
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string | null) {
  if (value == null || value === "") params.delete(key);
  else params.set(key, value);
}

/**
 * Write a patch into the query string with the History API. Next.js keeps
 * `useSearchParams` in sync with pushState/replaceState, so this re-renders
 * the client tree without a server round-trip. Params owned by other parts of
 * the app are left untouched.
 */
export function writeUrl(patch: UrlPatch, mode: "push" | "replace") {
  const params = new URLSearchParams(window.location.search);
  if (patch.tab !== undefined) {
    setOrDelete(params, "tab", patch.tab === "spending" ? "value" : null);
  }
  if (patch.sort !== undefined) {
    setOrDelete(params, "sort", SORT_TO_PARAM[patch.sort]);
  }
  if (patch.layout !== undefined) {
    setOrDelete(params, "view", patch.layout === "grid" ? null : patch.layout);
  }
  if (patch.played !== undefined) {
    setOrDelete(params, "show", patch.played === "all" ? null : patch.played);
  }
  if (patch.family !== undefined) {
    setOrDelete(params, "family", patch.family ? "1" : null);
  }
  if (patch.recent !== undefined) {
    setOrDelete(params, "recent", patch.recent ? "1" : null);
  }
  if (patch.query !== undefined) {
    setOrDelete(params, "q", patch.query.trim() ? patch.query : null);
  }
  if (patch.game !== undefined) {
    setOrDelete(params, "game", patch.game == null ? null : String(patch.game));
  }
  const qs = params.toString();
  const next = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (next === current) return;
  if (mode === "push") window.history.pushState(null, "", next);
  else window.history.replaceState(null, "", next);
}

/** Tab, shelf sort/view, filters, search and open game, read from the URL. */
export function useUrlState(): [UrlState, typeof writeUrl] {
  const searchParams = useSearchParams();
  const key = searchParams.toString();
  const state = useMemo(() => parse(new URLSearchParams(key)), [key]);
  return [state, writeUrl];
}
