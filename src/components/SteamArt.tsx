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

export type ArtKind = "library" | "header" | "capsule";

/** Pixel size of the 1× Steam asset for each kind (the 2× file doubles it). */
export const ART_SIZE: Record<ArtKind, { width: number; height: number }> = {
  library: { width: 300, height: 450 },
  header: { width: 460, height: 215 },
  capsule: { width: 231, height: 87 },
};

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
  kind: ArtKind,
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

/**
 * Steam publishes most art twice: `name.jpg` and `name_2x.jpg` in the same
 * folder. Given either, return the 1× URL (and the 2× one when it is known to
 * exist, i.e. when the resolved URL was the 2× file).
 */
export function artDensityPair(url: string): { lo: string; hi: string | null } {
  if (/_2x\.(jpe?g|png)(\?|$)/i.test(url)) {
    return { lo: url.replace(/_2x\.(jpe?g|png)(\?|$)/i, ".$1$2"), hi: url };
  }
  return { lo: url, hi: null };
}

type Source = { src: string; srcSet?: string };

/**
 * Ordered sources for one slot: the 1× file first (with the 2× file offered
 * through `srcset` for dense screens), then every fallback URL unchanged.
 */
function buildSources(
  appId: number,
  kind: ArtKind,
  artwork?: Record<string, ArtworkUrls>,
): Source[] {
  const candidates = expandedArtCandidates(appId, kind, artwork);
  const first = candidates[0];
  if (!first) return [];
  const { lo, hi } = artDensityPair(first);
  const w = ART_SIZE[kind].width;
  const out: Source[] = [];
  if (hi) {
    out.push({ src: lo, srcSet: `${lo} ${w}w, ${hi} ${w * 2}w` });
  } else {
    out.push({ src: lo });
  }
  for (const u of candidates) {
    if (u !== lo) out.push({ src: u });
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
  /** When false, only `className` is applied (the caller sizes the slot). */
  framed?: boolean;
  /**
   * CSS width of the slot, as an `<img sizes>` value. With it the browser
   * picks the 1× file on normal screens and the 2× file on dense ones.
   * Without it only the 1× file is offered.
   */
  sizes?: string;
  /** Above-the-fold art: load eagerly with high fetch priority. */
  priority?: boolean;
};

/**
 * Horizontal (capsule) / vertical (portrait) / header art with hashed-CDN
 * resolution and multi-host fallbacks. Always requests the smallest Steam
 * asset for the slot and reserves its box with width/height.
 */
export function SteamArt({
  appId,
  name,
  artwork,
  variant = "capsule",
  className,
  alt,
  framed = true,
  sizes,
  priority = false,
}: SteamArtProps) {
  const kind: ArtKind =
    variant === "portrait" ? "library" : variant === "header" ? "header" : "capsule";

  const sources = useMemo(() => {
    if (!appId || appId <= 0) return [];
    return buildSources(appId, kind, artwork);
  }, [appId, artwork, kind]);

  const [srcIdx, setSrcIdx] = useState(0);
  const sourceKey = sources[0]?.src ?? "";
  const [seenKey, setSeenKey] = useState(sourceKey);
  if (seenKey !== sourceKey) {
    setSeenKey(sourceKey);
    setSrcIdx(0);
  }

  const failed = !appId || appId <= 0 || srcIdx >= sources.length;
  const frameClass = framed ? `spend-thumb ${variant}` : "";

  const label = alt === "" ? "" : (alt?.trim() || name.trim() || "Game");

  if (failed) {
    if (!framed) {
      return (
        <div
          className={["steam-art-fallback", variant, className]
            .filter(Boolean)
            .join(" ")}
          role={label ? "img" : undefined}
          aria-label={label || undefined}
          aria-hidden={label ? undefined : true}
        >
          <span aria-hidden>{name.trim() || "No artwork"}</span>
        </div>
      );
    }
    return (
      <div
        className={`spend-thumb spend-thumb-fallback ${variant} ${className ?? ""}`}
        role="img"
        aria-label={label}
      >
        {(label || name).slice(0, 1).toUpperCase() || "?"}
      </div>
    );
  }

  const source = sources[srcIdx]!;
  const size = ART_SIZE[kind];
  const advance = () => setSrcIdx((i) => (sources[i]?.src === source.src ? i + 1 : i));

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={source.src}
      ref={(el) => {
        // An image that failed before hydration never fires onError here.
        if (el && el.complete && el.naturalWidth === 0 && el.currentSrc) {
          queueMicrotask(advance);
        }
      }}
      className={["steam-art", frameClass, className].filter(Boolean).join(" ")}
      src={source.src}
      srcSet={sizes ? source.srcSet : undefined}
      sizes={sizes && source.srcSet ? sizes : undefined}
      width={size.width}
      height={size.height}
      alt={label}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      referrerPolicy="no-referrer"
      onError={advance}
    />
  );
}
