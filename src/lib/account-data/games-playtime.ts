import * as cheerio from "cheerio";
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

/** Parse community games page HTML (TOTAL PLAYED / LAST PLAYED cards). */
export function parseGamesPlayedHtml(html: string): PlayedGame[] {
  const $ = cheerio.load(html);
  const byId = new Map<number, PlayedGame>();

  // Primary: visible card links with TOTAL PLAYED nearby in raw HTML
  const linkRe =
    /href="https:\/\/store\.steampowered\.com\/app\/(\d+)"[^>]*class="[^"]*wfG8VGEsVTw[^"]*"[^>]*>([^<]+)<\/a>/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) !== null) {
    const appId = Number(match[1]);
    const name = match[2].replace(/\s+/g, " ").trim();
    const chunk = html.slice(match.index, match.index + 1200);
    const hoursMatch = chunk.match(/TOTAL PLAYED<\/span>\s*([\d,.]+)\s*hours?/i);
    const lastMatch = chunk.match(/LAST PLAYED<\/span>\s*([^<]+)/i);
    const hoursForever = hoursMatch
      ? Number(hoursMatch[1].replace(/,/g, ""))
      : 0;
    const lastPlayedText = lastMatch
      ? lastMatch[1].replace(/\s+/g, " ").trim()
      : null;

    const existing = byId.get(appId);
    if (!existing || hoursForever > existing.hoursForever) {
      byId.set(appId, {
        appId,
        name,
        hoursForever,
        hours2Weeks: null,
        lastPlayedText,
        lastPlayedAt: parseLastPlayedAt(lastPlayedText),
        minutesForever: Math.round(hoursForever * 60),
      });
    }
  }

  // Enrich / add from escaped SSR JSON (recently played often has minutes)
  const jsonRe =
    /\\"appid\\":(\d+),\\"name\\":\\"([^\\"]+)\\"([\s\S]{0,400}?)\\"playtime_forever\\":(\d+)/g;
  while ((match = jsonRe.exec(html)) !== null) {
    const appId = Number(match[1]);
    const name = decodeJsString(match[2]);
    const tail = match[3] ?? "";
    const minutesForever = Number(match[4]);
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
      byId.set(appId, {
        ...existing,
        hoursForever: Math.max(existing.hoursForever, hoursForever),
        hours2Weeks: hours2Weeks ?? existing.hours2Weeks,
        lastPlayedAt: Math.max(
          existing.lastPlayedAt ?? 0,
          lastPlayedAt ?? 0,
        ) || existing.lastPlayedAt,
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
