import type { StatsInput } from "./types";
import { DAY_MS } from "./util";

export type DormancyBucketId = "month" | "half" | "year" | "older" | "unknown";

export type DormancyBucket = {
  id: DormancyBucketId;
  count: number;
  /** Lifetime hours on the games in this bucket. */
  hours: number;
};

export type ShelvedGame = {
  appId: number;
  name: string;
  hours: number;
  lastPlayedAt: number;
  idleDays: number;
};

export type DormancyStat = {
  /** Snapshot time the idle spans are measured against. */
  asOf: number;
  playedCount: number;
  buckets: DormancyBucket[];
  /** 10+ hour games untouched for a year or more, most-played first. */
  shelved: ShelvedGame[];
  shelvedCount: number;
};

const ORDER: DormancyBucketId[] = ["month", "half", "year", "older", "unknown"];
const SHELVED_MIN_HOURS = 10;
const SHELVED_LIMIT = 6;

function bucketFor(idleDays: number): DormancyBucketId {
  if (idleDays < 30) return "month";
  if (idleDays < 180) return "half";
  if (idleDays < 365) return "year";
  return "older";
}

export function dormancy(input: StatsInput): DormancyStat | null {
  const played = input.playedGames.filter((g) => g.hoursForever > 0);
  if (!played.length || !(input.now > 0)) return null;

  const buckets = new Map<DormancyBucketId, DormancyBucket>(
    ORDER.map((id) => [id, { id, count: 0, hours: 0 }]),
  );
  const shelved: ShelvedGame[] = [];
  for (const g of played) {
    const known = g.lastPlayedAt != null && g.lastPlayedAt > 0;
    // A last-played stamp after the snapshot counts as "just played".
    const idleDays = known
      ? Math.max(0, (input.now - (g.lastPlayedAt as number)) / DAY_MS)
      : null;
    const bucket = buckets.get(idleDays == null ? "unknown" : bucketFor(idleDays))!;
    bucket.count += 1;
    bucket.hours += g.hoursForever;
    if (idleDays != null && idleDays >= 365 && g.hoursForever >= SHELVED_MIN_HOURS) {
      shelved.push({
        appId: g.appId,
        name: g.name,
        hours: g.hoursForever,
        lastPlayedAt: g.lastPlayedAt as number,
        idleDays,
      });
    }
  }
  shelved.sort((a, b) => b.hours - a.hours || a.name.localeCompare(b.name));

  return {
    asOf: input.now,
    playedCount: played.length,
    buckets: ORDER.map((id) => buckets.get(id)!),
    shelved: shelved.slice(0, SHELVED_LIMIT),
    shelvedCount: shelved.length,
  };
}
