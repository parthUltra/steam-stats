import type { PlayedGame } from "@/lib/account-data";
import type { ArtworkUrls } from "@/lib/steam/artwork-resolve";

const CDN = "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps";
const SUB_CDN =
  "https://shared.akamai.steamstatic.com/store_item_assets/steam/subs";

/** Steam CDN artwork helpers (public store assets). */
export function steamHeaderUrl(appId: number) {
  return `${CDN}/${appId}/header.jpg`;
}

export function steamLibraryCapsuleUrl(appId: number) {
  return `${CDN}/${appId}/library_600x900.jpg`;
}

export function steamCapsuleUrl(appId: number) {
  return `${CDN}/${appId}/capsule_231x87.jpg`;
}

/** Package / bundle (sub) assets — used when storesearch returns a sub id. */
export function steamPackageHeaderUrl(packageId: number) {
  return `${SUB_CDN}/${packageId}/header.jpg`;
}

export function steamPackageCapsuleUrl(packageId: number) {
  return `${SUB_CDN}/${packageId}/capsule_231x87.jpg`;
}

export function steamStoreUrl(appId: number) {
  return `https://store.steampowered.com/app/${appId}`;
}

/** Prefer GetItems-resolved URLs; fall back to legacy CDN paths. */
export function resolveLibraryArt(
  appId: number,
  artwork?: Record<string, ArtworkUrls>,
): string {
  return artwork?.[String(appId)]?.library ?? steamLibraryCapsuleUrl(appId);
}

export function resolveHeaderArt(
  appId: number,
  artwork?: Record<string, ArtworkUrls>,
): string {
  return artwork?.[String(appId)]?.header ?? steamHeaderUrl(appId);
}

export function resolveCapsuleArt(
  appId: number,
  artwork?: Record<string, ArtworkUrls>,
): string {
  return artwork?.[String(appId)]?.capsule ?? steamCapsuleUrl(appId);
}

/** Deduped candidate URLs for <img onError> fallback chains. */
export function artCandidates(
  appId: number,
  kind: "library" | "header" | "capsule",
  artwork?: Record<string, ArtworkUrls>,
): string[] {
  const resolved =
    kind === "library"
      ? resolveLibraryArt(appId, artwork)
      : kind === "header"
        ? resolveHeaderArt(appId, artwork)
        : resolveCapsuleArt(appId, artwork);
  const legacy =
    kind === "library"
      ? steamLibraryCapsuleUrl(appId)
      : kind === "header"
        ? steamHeaderUrl(appId)
        : steamCapsuleUrl(appId);

  const extras =
    kind === "capsule"
      ? [resolveHeaderArt(appId, artwork), steamHeaderUrl(appId)]
      : kind === "header"
        ? [resolveCapsuleArt(appId, artwork), steamCapsuleUrl(appId)]
        : [
            // Packages often lack library capsules — try package header/capsule
            steamPackageHeaderUrl(appId),
            steamPackageCapsuleUrl(appId),
            resolveHeaderArt(appId, artwork),
            steamHeaderUrl(appId),
          ];

  const packageFallbacks =
    kind === "header"
      ? [steamPackageHeaderUrl(appId), steamPackageCapsuleUrl(appId)]
      : kind === "capsule"
        ? [steamPackageCapsuleUrl(appId), steamPackageHeaderUrl(appId)]
        : [];

  const out: string[] = [];
  for (const u of [resolved, ...extras, legacy, ...packageFallbacks]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

export function formatPlayHours(h: number) {
  if (h >= 100) return `${Math.round(h)}`;
  if (h >= 10) return h.toFixed(1);
  return h.toFixed(1);
}

/** Medal class for ranked lists: 1 gold, 2 silver, 3 bronze, else plain. */
export function rankMedalClass(rank: number): string {
  if (rank === 1) return "rank-medal gold";
  if (rank === 2) return "rank-medal silver";
  if (rank === 3) return "rank-medal bronze";
  return "rank-medal";
}

export type LibraryGameView = PlayedGame & {
  shareOfTop: number;
};
