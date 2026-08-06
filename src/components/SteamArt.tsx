"use client";

import { useMemo, useState } from "react";
import {
  artCandidates,
  steamCapsuleUrl,
  steamHeaderUrl,
  steamLibraryCapsuleUrl,
} from "@/lib/steam/artwork";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";

const ALT_HOSTS = [
  "shared.akamai.steamstatic.com",
  "cdn.cloudflare.steamstatic.com",
  "steamcdn-a.akamaihd.net",
  "shared.fastly.steamstatic.com",
] as const;

function withAltHosts(url: string): string[] {
  const out = [url];
  for (const host of ALT_HOSTS) {
    try {
      const u = new URL(url);
      if (u.hostname === host) continue;
      u.hostname = host;
      out.push(u.toString());
    } catch {
      // ignore
    }
  }
  return out;
}

/** Expand candidates across Steam CDN hosts (some assets 404 on one edge). */
export function expandedArtCandidates(
  appId: number,
  kind: "library" | "header" | "capsule",
  artwork?: Record<string, ArtworkUrls>,
): string[] {
  const base = artCandidates(appId, kind, artwork);
  // Always include classic CDN filenames as last-resort
  const legacy =
    kind === "library"
      ? steamLibraryCapsuleUrl(appId)
      : kind === "header"
        ? steamHeaderUrl(appId)
        : steamCapsuleUrl(appId);
  const seed = [...base, legacy];
  const out: string[] = [];
  for (const u of seed) {
    for (const v of withAltHosts(u)) {
      if (!out.includes(v)) out.push(v);
    }
  }
  return out;
}

type SteamArtProps = {
  appId: number | null | undefined;
  name: string;
  artwork?: Record<string, ArtworkUrls>;
  variant?: "capsule" | "portrait" | "header";
  className?: string;
  alt?: string;
  /** When false, only `className` is applied (hero banners). */
  framed?: boolean;
};

/**
 * Horizontal (capsule) / vertical (portrait) / header art with hashed-CDN
 * resolution and multi-host fallbacks.
 */
export function SteamArt({
  appId,
  name,
  artwork,
  variant = "capsule",
  className,
  alt,
  framed = true,
}: SteamArtProps) {
  const kind =
    variant === "portrait" ? "library" : variant === "header" ? "header" : "capsule";

  const candidates = useMemo(() => {
    if (!appId || appId <= 0) return [];
    return expandedArtCandidates(appId, kind, artwork);
  }, [appId, artwork, kind]);

  const [srcIdx, setSrcIdx] = useState(0);
  const candidateKey = candidates.join("\0");
  const [seenKey, setSeenKey] = useState(candidateKey);
  if (seenKey !== candidateKey) {
    setSeenKey(candidateKey);
    setSrcIdx(0);
  }

  const failed = !appId || appId <= 0 || srcIdx >= candidates.length;
  const variantClass =
    variant === "portrait"
      ? "portrait"
      : variant === "header"
        ? "header"
        : "capsule";
  const frameClass = framed
    ? `spend-thumb ${variantClass}`
    : "";

  if (failed) {
    if (!framed) return null;
    return (
      <div
        className={`spend-thumb spend-thumb-fallback ${variantClass} ${className ?? ""}`}
        aria-hidden
      >
        {name.slice(0, 1)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={candidates[srcIdx]}
      className={[frameClass, className].filter(Boolean).join(" ")}
      src={candidates[srcIdx]}
      alt={alt ?? ""}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setSrcIdx((i) => i + 1)}
    />
  );
}
