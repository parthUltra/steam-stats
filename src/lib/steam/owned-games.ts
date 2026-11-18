/**
 * Full Steam library playtime via the local session access token, merged with
 * the Steam Family Library games you've played.
 *
 * There is no Web API key path: a key cannot read the family library, so a
 * key-based fetch would silently lose every family flag. STEAM_API_KEY is not
 * read anywhere.
 */
import fs from "node:fs/promises";
import type { PlayedGame } from "@/lib/account-data/games-playtime";
import { safeErrorMessage } from "@/lib/data/redact";
import { isoUtcDate as isoDate } from "@/lib/dates";
import { isOffline, netFetch, rootPath } from "@/lib/runtime";

type OwnedGame = {
  appid: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  playtime_windows_forever?: number;
  playtime_mac_forever?: number;
  playtime_linux_forever?: number;
  playtime_deck_forever?: number;
  playtime_disconnected?: number;
  rtime_last_played?: number;
};

/**
 * What GetOwnedGames returns beyond total hours (declared on `PlayedGame`).
 * All optional: present only when Steam sent the field.
 */
export type OwnedGameDetail = Pick<
  PlayedGame,
  | "minutes2Weeks"
  | "minutesWindows"
  | "minutesMac"
  | "minutesLinux"
  | "minutesDeck"
  | "minutesDisconnected"
  | "rtimeLastPlayed"
>;

/** A library row from the Steam API (kept as an alias for existing callers). */
export type OwnedPlayedGame = PlayedGame;

/** Copy `value` to `key` only when Steam actually sent a number. */
function optional<K extends keyof OwnedGameDetail>(
  key: K,
  value: number | undefined,
): OwnedGameDetail {
  return typeof value === "number" && Number.isFinite(value)
    ? { [key]: value }
    : {};
}

type FamilySharedApp = {
  appid: number;
  name?: string;
  /** Minutes played by you on this shared title */
  rt_playtime?: number;
  rt_last_played?: number;
  /** 1 = game */
  app_type?: number;
  exclude_reason?: number;
  owner_steamids?: string[];
};

function mapOwnedGames(games: OwnedGame[]): OwnedPlayedGame[] {
  return games
    .map((g): OwnedPlayedGame => {
      const minutes = g.playtime_forever ?? 0;
      const minutes2w = g.playtime_2weeks ?? 0;
      const played = g.rtime_last_played != null && g.rtime_last_played > 0;
      const lastAt = played ? g.rtime_last_played! * 1000 : null;
      return {
        appId: g.appid,
        name: g.name ?? `App ${g.appid}`,
        hoursForever: minutes / 60,
        hours2Weeks: minutes2w > 0 ? minutes2w / 60 : null,
        lastPlayedText: lastAt ? isoDate(lastAt) : null,
        lastPlayedAt: lastAt,
        minutesForever: minutes,
        fromFamily: false,
        ...optional("minutes2Weeks", g.playtime_2weeks),
        ...optional("minutesWindows", g.playtime_windows_forever),
        ...optional("minutesMac", g.playtime_mac_forever),
        ...optional("minutesLinux", g.playtime_linux_forever),
        ...optional("minutesDeck", g.playtime_deck_forever),
        ...optional("minutesDisconnected", g.playtime_disconnected),
        ...(played ? { rtimeLastPlayed: g.rtime_last_played } : {}),
      };
    })
    .sort((a, b) => b.hoursForever - a.hoursForever);
}

const UA = { "User-Agent": "steam-stats-local/0.1" };

/**
 * One Steam Web API GET. The request URL can carry a session access token, so
 * it is never logged and never copied into an error: a transport failure is
 * re-thrown with a fixed label and a redacted message, without the original
 * error (whose message or `cause` may quote the URL).
 */
async function steamApiGet<T>(
  label: string,
  url: URL,
): Promise<T> {
  let res: Response;
  try {
    res = await netFetch(url.toString(), {
      headers: UA,
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`${label} failed: ${safeErrorMessage(err).split("?")[0]}`);
  }
  if (!res.ok) throw new Error(`${label} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function getOwnedGamesRequest(
  params: URLSearchParams,
): Promise<OwnedPlayedGame[]> {
  const url = new URL(
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
  );
  params.forEach((v, k) => url.searchParams.set(k, v));
  url.searchParams.set("include_appinfo", "1");
  url.searchParams.set("include_played_free_games", "1");
  url.searchParams.set("skip_unvetted_apps", "false");

  const data = await steamApiGet<{
    response?: { games?: OwnedGame[]; game_count?: number };
  }>("Steam GetOwnedGames", url);
  return mapOwnedGames(data.response?.games ?? []);
}

/** steamLoginSecure is `steamid||token` — token works as Web API access_token. */
export function parseSteamLoginSecure(
  value: string,
): { steamId: string; accessToken: string } | null {
  const decoded = decodeURIComponent(value);
  const parts = decoded.split("||");
  if (parts.length < 2) return null;
  const steamId = parts[0];
  const accessToken = parts.slice(1).join("||");
  if (!/^\d{17}$/.test(steamId) || !accessToken) return null;
  return { steamId, accessToken };
}

/**
 * Library via the session access token. The token stays in the query string:
 * `access_token=` is the only form these service endpoints are known to
 * accept. `steamApiGet` keeps the URL out of logs and errors.
 */
export async function fetchOwnedGamesWithAccessToken(
  steamId: string,
  accessToken: string,
): Promise<OwnedPlayedGame[]> {
  const params = new URLSearchParams({
    access_token: accessToken,
    steamid: steamId,
  });
  return getOwnedGamesRequest(params);
}

/**
 * Games available / played via Steam Family Library (not in GetOwnedGames).
 * Uses session access_token — Web API keys cannot call this.
 */
export async function fetchFamilyPlayedGames(
  accessToken: string,
): Promise<OwnedPlayedGame[]> {
  const groupUrl = new URL(
    "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/",
  );
  groupUrl.searchParams.set("access_token", accessToken);
  groupUrl.searchParams.set("include_family_group_response", "true");

  const groupData = await steamApiGet<{
    response?: {
      family_groupid?: string | number;
      is_not_member_of_any_group?: boolean;
    };
  }>("GetFamilyGroupForUser", groupUrl);
  const groupId = groupData.response?.family_groupid;
  if (
    groupData.response?.is_not_member_of_any_group ||
    groupId == null ||
    groupId === "" ||
    groupId === "0"
  ) {
    return [];
  }

  const sharedUrl = new URL(
    "https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/",
  );
  sharedUrl.searchParams.set("access_token", accessToken);
  sharedUrl.searchParams.set("family_groupid", String(groupId));
  // include_own=false → other members' libraries only
  sharedUrl.searchParams.set("include_own", "false");
  sharedUrl.searchParams.set("include_excluded", "false");
  sharedUrl.searchParams.set("include_free", "false");

  const sharedData = await steamApiGet<{
    response?: { apps?: FamilySharedApp[] };
  }>("GetSharedLibraryApps", sharedUrl);
  const apps = sharedData.response?.apps ?? [];

  return apps
    .filter((a) => (a.app_type == null || a.app_type === 1) && (a.rt_playtime ?? 0) > 0)
    .map((a): OwnedPlayedGame => {
      const minutes = a.rt_playtime ?? 0;
      const played = a.rt_last_played != null && a.rt_last_played > 0;
      const lastAt = played ? a.rt_last_played! * 1000 : null;
      return {
        appId: a.appid,
        name: a.name ?? `App ${a.appid}`,
        hoursForever: minutes / 60,
        hours2Weeks: null,
        lastPlayedText: lastAt ? isoDate(lastAt) : null,
        lastPlayedAt: lastAt,
        minutesForever: minutes,
        fromFamily: true,
        ...(played ? { rtimeLastPlayed: a.rt_last_played } : {}),
      };
    })
    .sort((a, b) => b.hoursForever - a.hoursForever);
}

/** Merge owned + family-played; owned wins ownership flag, hours take max. */
export function mergeOwnedAndFamily(
  owned: OwnedPlayedGame[],
  familyPlayed: OwnedPlayedGame[],
): OwnedPlayedGame[] {
  const byId = new Map<number, OwnedPlayedGame>();
  for (const g of owned) {
    byId.set(g.appId, { ...g, fromFamily: false });
  }
  for (const g of familyPlayed) {
    const prev = byId.get(g.appId);
    if (!prev) {
      byId.set(g.appId, g);
      continue;
    }
    // Already owned — keep owned, boost hours/last-played if family record is richer
    byId.set(g.appId, {
      ...prev,
      fromFamily: false,
      hoursForever: Math.max(prev.hoursForever, g.hoursForever),
      minutesForever: Math.max(
        prev.minutesForever ?? 0,
        g.minutesForever ?? 0,
      ),
      lastPlayedAt:
        Math.max(prev.lastPlayedAt ?? 0, g.lastPlayedAt ?? 0) ||
        prev.lastPlayedAt ||
        g.lastPlayedAt,
      lastPlayedText: g.lastPlayedAt && (g.lastPlayedAt ?? 0) >= (prev.lastPlayedAt ?? 0)
        ? g.lastPlayedText ?? prev.lastPlayedText
        : prev.lastPlayedText ?? g.lastPlayedText,
      name: prev.name || g.name,
    });
  }
  return [...byId.values()].sort((a, b) => b.hoursForever - a.hoursForever);
}

type StorageState = {
  cookies?: { name: string; value: string; domain?: string }[];
};

/** Load full library using Playwright session cookies (local .steam-session). */
export async function fetchOwnedGamesFromSteamSession(): Promise<{
  games: OwnedPlayedGame[];
  steamId: string;
  familyPlayedCount: number;
} | null> {
  // Offline: bail before the session cookie file is ever opened.
  if (isOffline()) return null;
  const statePath = rootPath(".steam-session", "storage-state.json");
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch {
    return null;
  }

  let state: StorageState;
  try {
    state = JSON.parse(raw) as StorageState;
  } catch {
    return null;
  }

  const secure = state.cookies?.find((c) => c.name === "steamLoginSecure");
  if (!secure?.value) return null;

  const parsed = parseSteamLoginSecure(secure.value);
  if (!parsed) return null;

  const owned = await fetchOwnedGamesWithAccessToken(
    parsed.steamId,
    parsed.accessToken,
  );

  let familyPlayed: OwnedPlayedGame[] = [];
  try {
    familyPlayed = await fetchFamilyPlayedGames(parsed.accessToken);
  } catch {
    // Family API optional — still return owned
  }

  const games = mergeOwnedAndFamily(owned, familyPlayed);
  return {
    games,
    steamId: parsed.steamId,
    familyPlayedCount: familyPlayed.filter(
      (f) => !owned.some((o) => o.appId === f.appId),
    ).length,
  };
}
