import { parse } from "date-fns";

export type PlayedGame = {
  appId: number;
  name: string;
  /** Lifetime hours on record */
  hoursForever: number;
  /** Hours in last 2 weeks if known */
  hours2Weeks: number | null;
  lastPlayedText: string | null;
  /** Epoch ms for sorting “recent”; null if unknown */
  lastPlayedAt: number | null;
  /** Minutes forever when sourced from JSON */
  minutesForever: number | null;
  /** Played via Steam Family Library (not permanently owned) */
  fromFamily?: boolean;
  /** License acquisition date (for unplayed / recently added shelf rows) */
  addedAt?: number | null;
  addedText?: string | null;
};

/** Parse Steam “LAST PLAYED” labels like "2 Aug", "14 Jul", "26 May 2025". */
export function parseLastPlayedAt(
  text: string | null | undefined,
  now = new Date(),
): number | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  const formats = ["d MMM yyyy", "d MMMM yyyy", "MMM d yyyy", "d MMM", "d MMMM"];
  for (const fmt of formats) {
    const d = parse(cleaned, fmt, now);
    if (Number.isNaN(d.getTime())) continue;
    // Year-less labels: if the date is in the future, roll back a year
    if (!/yyyy/i.test(fmt) && d.getTime() > now.getTime() + 24 * 60 * 60 * 1000) {
      d.setFullYear(d.getFullYear() - 1);
    }
    return d.getTime();
  }
  return null;
}

function decodeJsString(value: string): string {
  try {
    return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string;
  } catch {
    return value
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
        String.fromCharCode(parseInt(h, 16)),
      )
      .replace(/\\"/g, '"');
  }
}

/** Parse "2.3 hours" / "37 minutes" labels into hours. */
function parsePlayedDurationLabel(text: string | null | undefined): number | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  const hours = cleaned.match(/^([\d,.]+)\s*hours?$/i);
  if (hours) return Number(hours[1].replace(/,/g, ""));
  const minutes = cleaned.match(/^([\d,.]+)\s*minutes?$/i);
  if (minutes) return Number(minutes[1].replace(/,/g, "")) / 60;
  return null;
}

/** Merge playtime rows; prefer newer last-played and higher hours. */
export function mergePlayedGames(
  base: PlayedGame[],
  incoming: PlayedGame[],
): PlayedGame[] {
  const byId = new Map<number, PlayedGame>();
  for (const g of base) byId.set(g.appId, g);
  for (const g of incoming) {
    const prev = byId.get(g.appId);
    if (!prev) {
      byId.set(g.appId, g);
      continue;
    }
    const lastPlayedAt =
      Math.max(prev.lastPlayedAt ?? 0, g.lastPlayedAt ?? 0) ||
      prev.lastPlayedAt ||
      g.lastPlayedAt;
    const preferIncomingLast =
      (g.lastPlayedAt ?? 0) >= (prev.lastPlayedAt ?? 0) &&
      (g.lastPlayedAt ?? 0) > 0;
    byId.set(g.appId, {
      ...prev,
      name: prev.name || g.name,
      hoursForever: Math.max(prev.hoursForever, g.hoursForever),
      hours2Weeks: g.hours2Weeks ?? prev.hours2Weeks,
      minutesForever: Math.max(
        prev.minutesForever ?? 0,
        g.minutesForever ?? 0,
      ),
      lastPlayedAt,
      lastPlayedText: preferIncomingLast
        ? g.lastPlayedText ?? prev.lastPlayedText
        : prev.lastPlayedText ?? g.lastPlayedText,
      fromFamily: Boolean(prev.fromFamily && g.fromFamily),
    });
  }
  return [...byId.values()].sort((a, b) => b.hoursForever - a.hoursForever);
}

/** Parse community games page HTML (TOTAL PLAYED / LAST PLAYED cards). */
export function parseGamesPlayedHtml(html: string): PlayedGame[] {
  const byId = new Map<number, PlayedGame>();

  // Primary: visible card links with TOTAL PLAYED nearby in raw HTML
  const linkRe =
    /href="https:\/\/store\.steampowered\.com\/app\/(\d+)"[^>]*class="[^"]*wfG8VGEsVTw[^"]*"[^>]*>([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const appId = Number(match[1]);
    const name = match[2].replace(/\s+/g, " ").trim();
    const chunk = html.slice(match.index, match.index + 1200);
    const hoursMatch = chunk.match(
      /TOTAL PLAYED<\/span>\s*((?:[\d,.]+\s*(?:hours?|minutes?)))/i,
    );
    const lastMatch = chunk.match(/LAST PLAYED<\/span>\s*([^<]+)/i);
    const twoWeeksMatch = chunk.match(
      /LAST TWO WEEKS<\/span>\s*((?:[\d,.]+\s*(?:hours?|minutes?)))/i,
    );
    const hoursForever = parsePlayedDurationLabel(hoursMatch?.[1]) ?? 0;
    const hours2Weeks = parsePlayedDurationLabel(twoWeeksMatch?.[1]);
    const lastPlayedText = lastMatch
      ? lastMatch[1].replace(/\s+/g, " ").trim()
      : null;

    const existing = byId.get(appId);
    if (!existing || hoursForever > existing.hoursForever) {
      byId.set(appId, {
        appId,
        name,
        hoursForever,
        hours2Weeks,
        lastPlayedText,
        lastPlayedAt: parseLastPlayedAt(lastPlayedText),
        minutesForever: Math.round(hoursForever * 60),
      });
    } else if (existing && hours2Weeks != null && existing.hours2Weeks == null) {
      byId.set(appId, { ...existing, hours2Weeks });
    }
  }

  // Enrich / add from escaped SSR JSON.
  // Steam puts playtime_2weeks + rtime_last_played *after* playtime_forever.
  const jsonRe =
    /\\"appid\\":(\d+),\\"name\\":\\"((?:\\\\.|[^\\"])*)\\",\\"playtime_forever\\":(\d+)((?:(?!\\"appid\\":).){0,400})/g;
  while ((match = jsonRe.exec(html)) !== null) {
    const appId = Number(match[1]);
    const name = decodeJsString(match[2]);
    const minutesForever = Number(match[3]);
    const tail = match[4] ?? "";
    const twoWeeksMatch = tail.match(/\\"playtime_2weeks\\":(\d+)/);
    const rtimeMatch = tail.match(/\\"rtime_last_played\\":(\d+)/);
    const hoursForever = minutesForever / 60;
    const hours2Weeks = twoWeeksMatch
      ? Number(twoWeeksMatch[1]) / 60
      : null;
    const rtime = rtimeMatch ? Number(rtimeMatch[1]) : 0;
    const lastPlayedAt = rtime > 0 ? rtime * 1000 : null;

    const existing = byId.get(appId);
    if (!existing) {
      byId.set(appId, {
        appId,
        name,
        hoursForever,
        hours2Weeks,
        lastPlayedText: lastPlayedAt
          ? new Date(lastPlayedAt).toLocaleDateString()
          : null,
        lastPlayedAt,
        minutesForever,
      });
    } else {
      const nextLast =
        Math.max(existing.lastPlayedAt ?? 0, lastPlayedAt ?? 0) ||
        existing.lastPlayedAt;
      const preferJsonLast =
        (lastPlayedAt ?? 0) >= (existing.lastPlayedAt ?? 0) &&
        (lastPlayedAt ?? 0) > 0;
      byId.set(appId, {
        ...existing,
        hoursForever: Math.max(existing.hoursForever, hoursForever),
        hours2Weeks: hours2Weeks ?? existing.hours2Weeks,
        lastPlayedAt: nextLast,
        lastPlayedText: preferJsonLast
          ? new Date(lastPlayedAt!).toLocaleDateString()
          : existing.lastPlayedText,
        minutesForever: Math.max(
          existing.minutesForever ?? 0,
          minutesForever,
        ),
        name: existing.name || name,
      });
    }
  }

  return [...byId.values()]
    .filter((g) => g.name && g.appId > 0)
    .sort((a, b) => b.hoursForever - a.hoursForever);
}

export function extractSteamIdFromGamesHtml(html: string): string | null {
  const m =
    html.match(/\\"steamid\\":\\"(\d{17})\\"/) ||
    html.match(/"steamid"\s*:\s*"(\d{17})"/);
  return m?.[1] ?? null;
}

export type PlaytimeAnalytics = {
  steamId: string | null;
  gameCount: number;
  gamesPlayed: number;
  totalHours: number;
  recentHours2Weeks: number;
  topGames: PlayedGame[];
  games: PlayedGame[];
  source: "account-data-html" | "steam-api" | "merged";
};

export function buildPlaytimeAnalytics(
  games: PlayedGame[],
  opts?: { steamId?: string | null; source?: PlaytimeAnalytics["source"] },
): PlaytimeAnalytics {
  const played = games.filter((g) => g.hoursForever > 0);
  return {
    steamId: opts?.steamId ?? null,
    gameCount: games.length,
    gamesPlayed: played.length,
    totalHours: games.reduce((s, g) => s + g.hoursForever, 0),
    recentHours2Weeks: games.reduce(
      (s, g) => s + (g.hours2Weeks ?? 0),
      0,
    ),
    topGames: [...games].sort((a, b) => b.hoursForever - a.hoursForever).slice(0, 15),
    games: [...games].sort((a, b) => b.hoursForever - a.hoursForever),
    source: opts?.source ?? "account-data-html",
  };
}

function compactTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/™|®/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function libraryTitlesMatch(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/™|®/g, "").replace(/\s+/g, " ").trim();
  const nb = b.toLowerCase().replace(/™|®/g, "").replace(/\s+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ca = compactTitleKey(a);
  const cb = compactTitleKey(b);
  return ca.length >= 4 && ca === cb;
}

export type OwnedLicenseHint = {
  item: string;
  dateText: string;
  addedAt: number | null;
};

/**
 * Attach license added-dates to played games and add owned titles that have
 * never been played (missing from GetOwnedGames / HTML playtime scrapes).
 */
export function augmentPlayedWithOwnedLicenses(
  games: PlayedGame[],
  licenses: OwnedLicenseHint[],
  resolveAppId: (title: string) => number | null,
): PlayedGame[] {
  const byId = new Map<number, PlayedGame>();
  for (const g of games) byId.set(g.appId, { ...g });

  const findExisting = (title: string): PlayedGame | undefined => {
    for (const g of byId.values()) {
      if (libraryTitlesMatch(g.name, title)) return g;
    }
    return undefined;
  };

  for (const lic of licenses) {
    const title = lic.item.trim();
    if (!title) continue;
    const existing = findExisting(title);
    if (existing) {
      const nextAdded =
        Math.max(existing.addedAt ?? 0, lic.addedAt ?? 0) ||
        existing.addedAt ||
        lic.addedAt;
      const preferLic =
        (lic.addedAt ?? 0) >= (existing.addedAt ?? 0) && (lic.addedAt ?? 0) > 0;
      byId.set(existing.appId, {
        ...existing,
        addedAt: nextAdded,
        addedText: preferLic
          ? lic.dateText || existing.addedText
          : existing.addedText ?? lic.dateText,
      });
      continue;
    }

    const appId = resolveAppId(title);
    if (appId == null || appId <= 0 || byId.has(appId)) continue;

    byId.set(appId, {
      appId,
      name: title,
      hoursForever: 0,
      hours2Weeks: null,
      lastPlayedText: null,
      lastPlayedAt: null,
      minutesForever: 0,
      fromFamily: false,
      addedAt: lic.addedAt,
      addedText: lic.dateText || null,
    });
  }

  return [...byId.values()].sort((a, b) => b.hoursForever - a.hoursForever);
}
