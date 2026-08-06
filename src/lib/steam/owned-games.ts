/**
 * Full Steam library playtime via Web API key or local session access token.
 * Also merges Steam Family Library games you've played.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { PlayedGame } from "@/lib/account-data/games-playtime";

type OwnedGame = {
  appid: number;
  name?: string;
  playtime_forever?: number;
  playtime_2weeks?: number;
  rtime_last_played?: number;
};

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

function mapOwnedGames(games: OwnedGame[]): PlayedGame[] {
  return games
    .map((g) => {
      const minutes = g.playtime_forever ?? 0;
      const minutes2w = g.playtime_2weeks ?? 0;
      const lastAt =
        g.rtime_last_played && g.rtime_last_played > 0
          ? g.rtime_last_played * 1000
          : null;
      const last = lastAt ? new Date(lastAt).toLocaleDateString() : null;
      return {
        appId: g.appid,
        name: g.name ?? `App ${g.appid}`,
        hoursForever: minutes / 60,
        hours2Weeks: minutes2w > 0 ? minutes2w / 60 : null,
        lastPlayedText: last,
        lastPlayedAt: lastAt,
        minutesForever: minutes,
        fromFamily: false,
      } satisfies PlayedGame;
    })
    .sort((a, b) => b.hoursForever - a.hoursForever);
}

async function getOwnedGamesRequest(params: URLSearchParams): Promise<PlayedGame[]> {
  const url = new URL(
    "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/",
  );
  params.forEach((v, k) => url.searchParams.set(k, v));
  url.searchParams.set("include_appinfo", "1");
  url.searchParams.set("include_played_free_games", "1");
  url.searchParams.set("skip_unvetted_apps", "false");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "steam-stats-local/0.1" },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Steam GetOwnedGames failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    response?: { games?: OwnedGame[]; game_count?: number };
  };
  return mapOwnedGames(data.response?.games ?? []);
}

export async function fetchOwnedGamesPlaytime(
  steamId: string,
  apiKey: string,
): Promise<PlayedGame[]> {
  const params = new URLSearchParams({
    key: apiKey,
    steamid: steamId,
  });
  return getOwnedGamesRequest(params);
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

export async function fetchOwnedGamesWithAccessToken(
  steamId: string,
  accessToken: string,
): Promise<PlayedGame[]> {
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
): Promise<PlayedGame[]> {
  const groupUrl = new URL(
    "https://api.steampowered.com/IFamilyGroupsService/GetFamilyGroupForUser/v1/",
  );
  groupUrl.searchParams.set("access_token", accessToken);
  groupUrl.searchParams.set("include_family_group_response", "true");

  const groupRes = await fetch(groupUrl.toString(), {
    headers: { "User-Agent": "steam-stats-local/0.1" },
    cache: "no-store",
  });
  if (!groupRes.ok) {
    throw new Error(`GetFamilyGroupForUser failed: HTTP ${groupRes.status}`);
  }
  const groupData = (await groupRes.json()) as {
    response?: {
      family_groupid?: string | number;
      is_not_member_of_any_group?: boolean;
    };
  };
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

  const sharedRes = await fetch(sharedUrl.toString(), {
    headers: { "User-Agent": "steam-stats-local/0.1" },
    cache: "no-store",
  });
  if (!sharedRes.ok) {
    throw new Error(`GetSharedLibraryApps failed: HTTP ${sharedRes.status}`);
  }
  const sharedData = (await sharedRes.json()) as {
    response?: { apps?: FamilySharedApp[] };
  };
  const apps = sharedData.response?.apps ?? [];

  return apps
    .filter((a) => (a.app_type == null || a.app_type === 1) && (a.rt_playtime ?? 0) > 0)
    .map((a) => {
      const minutes = a.rt_playtime ?? 0;
      const lastAt =
        a.rt_last_played && a.rt_last_played > 0
          ? a.rt_last_played * 1000
          : null;
      return {
        appId: a.appid,
        name: a.name ?? `App ${a.appid}`,
        hoursForever: minutes / 60,
        hours2Weeks: null,
        lastPlayedText: lastAt ? new Date(lastAt).toLocaleDateString() : null,
        lastPlayedAt: lastAt,
        minutesForever: minutes,
        fromFamily: true,
      } satisfies PlayedGame;
    })
    .sort((a, b) => b.hoursForever - a.hoursForever);
}

/** Merge owned + family-played; owned wins ownership flag, hours take max. */
export function mergeOwnedAndFamily(
  owned: PlayedGame[],
  familyPlayed: PlayedGame[],
): PlayedGame[] {
  const byId = new Map<number, PlayedGame>();
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
  games: PlayedGame[];
  steamId: string;
  familyPlayedCount: number;
} | null> {
  const statePath = path.join(
    process.cwd(),
    ".steam-session",
    "storage-state.json",
  );
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

  let familyPlayed: PlayedGame[] = [];
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
