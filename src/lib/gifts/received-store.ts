import { readJsonFile, updateJsonFile } from "@/lib/data/json-store";
import { dataPath, ensureDataDir } from "@/lib/data/load-local";
import { normTitle, titlesSoftMatch } from "@/lib/analytics/acquisition";
import {
  parseSteamGiftEmails,
  type ParsedGiftEmail,
} from "@/lib/gifts/parse-steam-gift-email";

const FILE = "gifts-received.json";

export type ReceivedGiftRecord = {
  title: string;
  /** Steam persona who gifted the game */
  fromPersona?: string;
  sender?: string;
  subject?: string;
  giftUrl?: string;
  /** When Steam sent the email (ISO), if known */
  receivedAt?: string;
  source: ParsedGiftEmail["source"] | "manual" | "gmail";
  importedAt: string;
};

export type GiftsReceivedStore = {
  updatedAt: string;
  lastMailSyncedAt?: string;
  gifts: ReceivedGiftRecord[];
};

function normalizeStore(
  parsed: Partial<GiftsReceivedStore> | undefined,
): GiftsReceivedStore {
  return {
    updatedAt: parsed?.updatedAt ?? "",
    lastMailSyncedAt: parsed?.lastMailSyncedAt,
    gifts: Array.isArray(parsed?.gifts) ? parsed.gifts : [],
  };
}

/**
 * Locked read-modify-write with an atomic replace (previous file kept as
 * `.bak`). `change` always sees what is on disk right now, so the Gmail sync
 * and an API call cannot overwrite each other. Throws — writing nothing — if
 * the file exists but is corrupt.
 */
async function updateStore(
  change: (current: GiftsReceivedStore) => GiftsReceivedStore,
): Promise<GiftsReceivedStore> {
  await ensureDataDir();
  return updateJsonFile<GiftsReceivedStore>(
    dataPath(FILE),
    (disk) => change(normalizeStore(disk)),
    { backup: true },
  );
}

/**
 * Missing file → no gifts. A file that exists but cannot be parsed throws
 * `CorruptJsonFileError`: imported gifts are the owner's data, so they are
 * never silently replaced by an empty list.
 */
export async function loadReceivedGifts(): Promise<GiftsReceivedStore> {
  return normalizeStore(
    await readJsonFile<GiftsReceivedStore>(dataPath(FILE)),
  );
}

export async function clearReceivedGifts(): Promise<GiftsReceivedStore> {
  return updateStore(() => ({
    updatedAt: new Date().toISOString(),
    gifts: [],
  }));
}

function mergeGift(
  existing: ReceivedGiftRecord[],
  next: ParsedGiftEmail,
): ReceivedGiftRecord[] {
  const idx = existing.findIndex((g) => {
    if (next.giftUrl && g.giftUrl && next.giftUrl === g.giftUrl) return true;
    if (normTitle(g.title) === normTitle(next.title)) return true;
    // Soft-match only when we can't key by gift URL (avoid cross-wiring senders)
    if ((!next.giftUrl || !g.giftUrl) && titlesSoftMatch(g.title, next.title)) {
      return true;
    }
    return false;
  });
  const row: ReceivedGiftRecord = {
    title: next.title,
    fromPersona: next.fromPersona,
    sender: next.sender,
    subject: next.subject,
    giftUrl: next.giftUrl,
    receivedAt: next.receivedAt,
    source: "gmail",
    importedAt: new Date().toISOString(),
  };
  if (idx >= 0) {
    const copy = [...existing];
    const prev = copy[idx];
    copy[idx] = {
      ...prev,
      ...row,
      title:
        row.title.length >= (prev.title?.length ?? 0)
          ? row.title
          : prev.title || row.title,
      // Fresh parse wins when it knows the sender (fixes prior wrong stamps)
      fromPersona: row.fromPersona || prev.fromPersona,
      giftUrl: row.giftUrl || prev.giftUrl,
      receivedAt: row.receivedAt || prev.receivedAt,
      subject: row.subject || prev.subject,
    };
    return copy;
  }
  return [...existing, row];
}

export async function importReceivedGiftsFromText(
  text: string,
  opts?: {
    lastMailSyncedAt?: string;
    allowEmpty?: boolean;
  },
): Promise<{ store: GiftsReceivedStore; added: number; parsed: number }> {
  const parsed = text.trim() ? parseSteamGiftEmails(text) : [];
  if (!parsed.length && text.trim() && !opts?.allowEmpty) {
    // keep existing store but still allow caller to proceed
  }

  let before = 0;
  const store = await updateStore((current) => {
    let gifts = [...current.gifts];
    before = gifts.length;
    for (const g of parsed) {
      gifts = mergeGift(gifts, g);
    }
    return {
      updatedAt: new Date().toISOString(),
      lastMailSyncedAt: opts?.lastMailSyncedAt ?? current.lastMailSyncedAt,
      gifts,
    };
  });
  return {
    store,
    added: store.gifts.length - before,
    parsed: parsed.length,
  };
}

export async function markMailSynced(at = new Date().toISOString()) {
  return updateStore((current) => ({
    ...current,
    updatedAt: current.updatedAt || at,
    lastMailSyncedAt: at,
  }));
}
