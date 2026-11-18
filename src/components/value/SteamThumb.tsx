"use client";

import { SteamArt } from "@/components/SteamArt";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";

/**
 * Small decorative capsule in a fixed well. The well has its own fill and
 * border, so art that is still loading (or missing) reads as a placeholder and
 * not as an empty stretch of the row. The title is always printed beside it,
 * so the image carries no alt text.
 */
export function SteamThumb({
  appId,
  name,
  artwork,
}: {
  appId: number | null;
  name: string;
  artwork?: Record<string, ArtworkUrls>;
}) {
  return (
    <span className="v-thumb" aria-hidden>
      <SteamArt
        appId={appId}
        name={name}
        variant="capsule"
        artwork={artwork}
        framed={false}
        alt=""
        className="v-thumb-img"
      />
    </span>
  );
}
