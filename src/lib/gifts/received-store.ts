import fs from "node:fs/promises";
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

async function readStore(): Promise<GiftsReceivedStore> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(dataPath(FILE), "utf8");
    const parsed = JSON.parse(raw) as GiftsReceivedStore;
    return {
      updatedAt: parsed.updatedAt ?? "",
      lastMailSyncedAt: parsed.lastMailSyncedAt,
      gifts: Array.isArray(parsed.gifts) ? parsed.gifts : [],
    };
  } catch {
    return { updatedAt: "", gifts: [] };
  }
}

async function writeStore(store: GiftsReceivedStore) {
  await ensureDataDir();
  await fs.writeFile(dataPath(FILE), JSON.stringify(store, null, 2));
}

export async function loadReceivedGifts(): Promise<GiftsReceivedStore> {
  return readStore();
}

export async function clearReceivedGifts(): Promise<GiftsReceivedStore> {
  const empty: GiftsReceivedStore = {
    updatedAt: new Date().toISOString(),
    gifts: [],
  };
  await writeStore(empty);
  return empty;
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

  const current = await readStore();
  let gifts = [...current.gifts];
  const before = gifts.length;
  for (const g of parsed) {
    gifts = mergeGift(gifts, g);
  }
  const store: GiftsReceivedStore = {
    updatedAt: new Date().toISOString(),
    lastMailSyncedAt: opts?.lastMailSyncedAt ?? current.lastMailSyncedAt,
    gifts,
  };
  await writeStore(store);
  return {
    store,
    added: store.gifts.length - before,
    parsed: parsed.length,
  };
}

export async function markMailSynced(at = new Date().toISOString()) {
  const current = await readStore();
  const store: GiftsReceivedStore = {
    ...current,
    updatedAt: current.updatedAt || at,
    lastMailSyncedAt: at,
  };
  await writeStore(store);
  return store;
}
