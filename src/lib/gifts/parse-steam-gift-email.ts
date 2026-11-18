import { titlesSoftMatch, normTitle } from "@/lib/analytics/acquisition";

export type ParsedGiftEmail = {
  title: string;
  /** Steam persona who sent the gift (e.g. "friend-two"), when present in the body */
  fromPersona?: string;
  sender?: string;
  subject?: string;
  giftUrl?: string;
  receivedAt?: string;
  source: "subject" | "body" | "link";
};

const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const latin1 = new TextDecoder("latin1");

/**
 * Decode quoted-printable. "=E2=84=A2" is three *bytes* of one UTF-8
 * character (™), so a whole run of escapes is decoded together — turning each
 * byte into its own character gives "â\u0084¢". Escapes are upper-case hex
 * (RFC 2045), which also keeps a literal "a=b" in a gift note intact.
 */
function decodeQuotedPrintable(text: string): string {
  return text
    .replace(/=\r?\n/g, "") // soft line breaks
    .replace(/(?:=[0-9A-F]{2})+/g, (run) => {
      const bytes = Uint8Array.from(
        run.split("=").slice(1),
        (hex) => parseInt(hex, 16),
      );
      try {
        return utf8Strict.decode(bytes);
      } catch {
        // not UTF-8: an ISO-8859-1 mail
        return latin1.decode(bytes);
      }
    });
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  trade: "™",
  reg: "®",
  copy: "©",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (whole, dec?: string, hex?: string, name?: string) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
      const code = dec ? Number(dec) : parseInt(hex!, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    },
  );
}

/** Decode common email transfer encodings enough for Steam gift text. */
function decodeEmailBody(raw: string): string {
  // Very light HTML → text
  return decodeEntities(
    decodeQuotedPrintable(raw)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  );
}

/**
 * Split a scrape / mbox blob into one message per gift email.
 *
 * Prefer our sync separator (`----`). Never split on bare `From Name` lines inside
 * Steam gift notes (e.g. "From Abhi, Arbaaz…") — that used to merge many gifts
 * into one chunk and stamp the first sender onto the rest.
 */
export function splitGiftEmailChunks(raw: string): string[] {
  const text = raw.replace(/\0/g, "");
  if (text.includes("\n----\n")) {
    return text
      .split(/\n----\n/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  // Real mbox envelope lines look like: From someone@host ...
  if (/^From \S+@/m.test(text) || /\nFrom \S+@/.test(text)) {
    return text
      .split(/\n(?=From \S+@)/)
      .map((c) => c.trim())
      .filter(Boolean);
  }
  return [text.trim()].filter(Boolean);
}

function cleanTitle(raw: string): string | null {
  let t = raw
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s*\.+$/g, "")
    .trim();
  // Steam's template says "… a gift copy of the game <Title>". Only that exact
  // lower-case phrase is boilerplate; "Game Dev Tycoon" and "The Game of
  // Life 2" are titles.
  t = t.replace(/^the game\s+(?=\S)/, "").trim();
  // Drop trailing boilerplate
  t = t
    .replace(/\s+on Steam$/i, "")
    .replace(/\s+for Steam$/i, "")
    .replace(/\s+to your Steam library$/i, "")
    .trim();
  // Reject captures that still look like sentence fragments
  if (/^(a |the )?gift copy of\b/i.test(t)) return null;
  if (/^(a |the )?gift subscription\b/i.test(t)) return null;
  if (/^subscription to the game\b/i.test(t)) return null;
  if (t.length < 2 || t.length > 180) return null;
  if (/^(https?:|www\.|steam|gift|you|they|friend)/i.test(t) && t.length < 8) {
    return null;
  }
  if (/noreply|steampowered|unsubscribe|accept gift|view gift/i.test(t)) {
    return null;
  }
  return t;
}

function sourceRank(source: ParsedGiftEmail["source"]): number {
  if (source === "body") return 3;
  if (source === "link") return 2;
  return 1;
}

function pushUnique(
  out: ParsedGiftEmail[],
  title: string,
  meta: Omit<ParsedGiftEmail, "title">,
) {
  const cleaned = cleanTitle(title);
  if (!cleaned) return;
  const key = normTitle(cleaned);
  const existing = out.find(
    (g) =>
      normTitle(g.title) === key || titlesSoftMatch(g.title, cleaned),
  );
  if (existing) {
    const preferMeta = sourceRank(meta.source) >= sourceRank(existing.source);

    // Body (or equal/better) may correct a wrong persona from a subject stub.
    if (meta.fromPersona) {
      if (!existing.fromPersona || preferMeta) {
        existing.fromPersona = meta.fromPersona;
      }
    }
    if (meta.giftUrl && (!existing.giftUrl || preferMeta)) {
      existing.giftUrl = meta.giftUrl;
    }
    if (meta.receivedAt && (!existing.receivedAt || preferMeta)) {
      existing.receivedAt = meta.receivedAt;
    }
    if (meta.subject && (!existing.subject || preferMeta)) {
      existing.subject = meta.subject;
    }
    if (meta.sender && (!existing.sender || preferMeta)) {
      existing.sender = meta.sender;
    }

    // Replace junk / truncated titles with a better capture
    const existingJunk =
      /gift subscription|gift copy of/i.test(existing.title) ||
      existing.title.length < cleaned.length;
    if (
      preferMeta ||
      (existingJunk && !/gift subscription|gift copy of/i.test(cleaned))
    ) {
      existing.source = preferMeta ? meta.source : existing.source;
      existing.title = cleaned;
    }
    return;
  }
  out.push({ title: cleaned, ...meta });
}

function extractGiftUrl(text: string): string | undefined {
  const m = text.match(
    /https?:\/\/store\.steampowered\.com\/account\/ackgift\/[A-Fa-f0-9]+(?:\?[^\s"'<>]*)?/i,
  );
  return m?.[0];
}

function extractDateHeader(decoded: string): string | undefined {
  const m = decoded.match(/^Date:\s*(.+)$/im);
  if (!m?.[1]) return undefined;
  const t = Date.parse(m[1].trim());
  if (!Number.isFinite(t)) return undefined;
  return new Date(t).toISOString();
}

/** Map each gift title in this message to the persona in its own sentence. */
function personasByTitleInChunk(decoded: string): Map<string, string> {
  const map = new Map<string, string>();
  const patterns = [
    /your friend\s+(.+?)\s+has given you\s+a gift subscription to\s+([\s\S]+?)\s+on Steam/gi,
    /your friend\s+(.+?)\s+has given you\s+(?!a gift subscription)([\s\S]+?)\s+on Steam/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(decoded)) !== null) {
      const persona = m[1]?.replace(/\s+/g, " ").trim();
      const title = cleanTitle(m[2].replace(/\s+/g, " ").trim());
      if (!persona || !title) continue;
      map.set(normTitle(title), persona);
    }
  }
  return map;
}

/**
 * Extract gift game titles from Steam gift notification email text / .eml.
 *
 * Formats:
 *   Subject: You've received a gift copy of the game SKYLINE on Steam
 *   Body:    Your friend friend-one has given you SKYLINE on Steam.
 *   Body:    Your friend friend-one has given you a gift subscription to the game
 *            Terraria on Steam.
 *   Link:    https://store.steampowered.com/account/ackgift/…
 */
export function parseSteamGiftEmails(rawInput: string): ParsedGiftEmail[] {
  const out: ParsedGiftEmail[] = [];

  for (const chunk of splitGiftEmailChunks(rawInput)) {
    const decoded = decodeEmailBody(chunk);
    const subjectMatch = decoded.match(/^Subject:\s*(.+)$/im);
    const subject = subjectMatch?.[1]?.replace(/\s+/g, " ").trim();
    const fromMatch = decoded.match(/^From:\s*(.+)$/im);
    const from = fromMatch?.[1]
      ?.replace(/<[^>]+>/g, "")
      .replace(/["']/g, "")
      .trim();
    const giftUrl = extractGiftUrl(decoded);
    const receivedAt = extractDateHeader(decoded);
    const personasByTitle = personasByTitleInChunk(decoded);
    const baseMeta = {
      subject,
      sender: from,
      giftUrl,
      receivedAt,
    };

    const personaForTitle = (title: string): string | undefined => {
      const cleaned = cleanTitle(title);
      if (!cleaned) return undefined;
      const exact = personasByTitle.get(normTitle(cleaned));
      if (exact) return exact;
      for (const [key, persona] of personasByTitle) {
        if (titlesSoftMatch(key, cleaned)) return persona;
      }
      return undefined;
    };

    if (subject) {
      const subPatterns = [
        /you(?:'ve| have) received a gift copy of\s+(.+?)(?:\s+on Steam)?$/i,
        /you(?:'ve| have) been sent a gift(?: copy)? of\s+(.+?)(?:\s+on Steam)?$/i,
        /received a gift(?: copy)?(?: of)?\s+(.+?)(?:\s+on Steam)?$/i,
        /gift copy of\s+(.+?)(?:\s+on Steam)?$/i,
        /^(.+?)\s+[—–-]\s+you(?:'ve| have) received a gift/i,
        /sent you a gift:\s*(.+)$/i,
      ];
      for (const re of subPatterns) {
        const m = subject.match(re);
        if (m?.[1]) {
          // Subject-only stubs must not inherit another gift's sender.
          pushUnique(out, m[1], {
            ...baseMeta,
            fromPersona: personaForTitle(m[1]),
            source: "subject",
          });
          break;
        }
      }
    }

    // Direct gift: "Your friend friend-one has given you SKYLINE on Steam."
    // Subscription (often wraps): "... given you a gift subscription to the game\nTerraria on Steam."
    const givenPatterns = [
      /(?:your friend\s+(.+?)\s+)?has given you\s+a gift subscription to\s+([\s\S]+?)\s+on Steam/gi,
      /(?:your friend\s+(.+?)\s+)?has given you\s+(?!a gift subscription)([\s\S]+?)\s+on Steam/gi,
    ];
    for (const givenRe of givenPatterns) {
      givenRe.lastIndex = 0;
      let gm: RegExpExecArray | null;
      while ((gm = givenRe.exec(decoded)) !== null) {
        const title = gm[2].replace(/\s+/g, " ").trim();
        const persona =
          gm[1]?.replace(/\s+/g, " ").trim() ||
          personaForTitle(title) ||
          undefined;
        pushUnique(out, title, {
          ...baseMeta,
          fromPersona: persona,
          source: "body",
        });
      }
    }

    const bodyPatterns = [
      /(?:has|have) sent you a gift copy of\s+(.+?)(?:\s+on Steam)?(?:[.!]|\n|$)/gi,
      /sent you\s+(.+?)\s+as a gift/gi,
      /you(?:'ve| have) received a gift copy of\s+(.+?)(?:\s+on Steam)?(?:[.!]|\n|$)/gi,
      /accept (?:your |the )?gift of\s+(.+?)(?:[.!]|\n|$)/gi,
    ];
    for (const re of bodyPatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(decoded)) !== null) {
        pushUnique(out, m[1], {
          ...baseMeta,
          fromPersona: personaForTitle(m[1]),
          source: "body",
        });
      }
    }

    // store.steampowered.com/app/123456/Game_Name/
    const linkRe =
      /store\.steampowered\.com\/app\/\d+\/([^/\s"?#]+)\/?/gi;
    let lm: RegExpExecArray | null;
    while ((lm = linkRe.exec(decoded)) !== null) {
      const fromSlug = decodeURIComponent(lm[1])
        .replace(/_/g, " ")
        .replace(/\+/g, " ");
      if (
        /gift/i.test(subject ?? "") ||
        /gift|has given you|ackgift/i.test(decoded.slice(0, 2500))
      ) {
        pushUnique(out, fromSlug, {
          ...baseMeta,
          fromPersona: personaForTitle(fromSlug),
          source: "link",
        });
      }
    }
  }

  return out;
}
