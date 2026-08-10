import { titlesSoftMatch, normTitle } from "@/lib/analytics/acquisition";

export type ParsedGiftEmail = {
  title: string;
  /** Steam persona who sent the gift (e.g. "ded"), when present in the body */
  fromPersona?: string;
  sender?: string;
  subject?: string;
  giftUrl?: string;
  receivedAt?: string;
  source: "subject" | "body" | "link";
};

/** Decode common email transfer encodings enough for Steam gift text. */
function decodeEmailBody(raw: string): string {
  let text = raw;
  // Quoted-printable soft line breaks
  text = text.replace(/=\r?\n/g, "");
  text = text.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  // Very light HTML → text
  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCharCode(Number(n)),
    )
    .replace(/&quot;/gi, '"');
  return text;
}

function cleanTitle(raw: string): string | null {
  let t = raw
    .replace(/\s+/g, " ")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s*[.!]+\s*$/, "")
    .trim();
  // Steam subjects often insert "the game" before the title
  t = t.replace(/^(?:the\s+)?game\s+/i, "").trim();
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
    // Prefer richer metadata from body / later matches
    if (!existing.fromPersona && meta.fromPersona) {
      existing.fromPersona = meta.fromPersona;
    }
    if (!existing.giftUrl && meta.giftUrl) existing.giftUrl = meta.giftUrl;
    if (!existing.receivedAt && meta.receivedAt) {
      existing.receivedAt = meta.receivedAt;
    }
    // Replace junk / truncated titles with a better capture
    const existingJunk =
      /gift subscription|gift copy of/i.test(existing.title) ||
      existing.title.length < cleaned.length;
    if (
      (meta.source === "body" && existing.source !== "body") ||
      (existingJunk && !/gift subscription|gift copy of/i.test(cleaned))
    ) {
      existing.source = meta.source === "body" ? "body" : existing.source;
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

/**
 * Extract gift game titles from Steam gift notification email text / .eml.
 *
 * Formats:
 *   Subject: You've received a gift copy of the game PEAK on Steam
 *   Body:    Your friend ded has given you PEAK on Steam.
 *   Body:    Your friend 0nePunch has given you a gift subscription to the game
 *            Terraria on Steam.
 *   Link:    https://store.steampowered.com/account/ackgift/…
 */
export function parseSteamGiftEmails(rawInput: string): ParsedGiftEmail[] {
  const raw = rawInput.replace(/\0/g, "");
  const out: ParsedGiftEmail[] = [];

  // Split mbox-ish concatenations / sync blobs
  const chunks = raw.includes("\nFrom ")
    ? raw.split(/\n(?=From )/)
    : raw.includes("\n----\n")
      ? raw.split(/\n----\n/)
      : [raw];

  for (const chunk of chunks) {
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
    const baseMeta = {
      subject,
      sender: from,
      giftUrl,
      receivedAt,
    };

    const chunkStart = out.length;

    // Persona is often present even when the title wraps to the next line.
    const friendMatch = decoded.match(
      /your friend\s+(.+?)\s+has given you/i,
    );
    const personaFromBody = friendMatch?.[1]?.replace(/\s+/g, " ").trim();

    if (subject) {
      const subPatterns = [
        /you(?:'ve| have) received a gift copy of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?$/i,
        /you(?:'ve| have) been sent a gift(?: copy)? of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?$/i,
        /received a gift(?: copy)?(?: of)?(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?$/i,
        /gift copy of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?$/i,
        /^(.+?)\s+[—–-]\s+you(?:'ve| have) received a gift/i,
        /sent you a gift:\s*(.+)$/i,
      ];
      for (const re of subPatterns) {
        const m = subject.match(re);
        if (m?.[1]) {
          pushUnique(out, m[1], {
            ...baseMeta,
            fromPersona: personaFromBody,
            source: "subject",
          });
          break;
        }
      }
    }

    // Direct gift: "Your friend ded has given you PEAK on Steam."
    // Subscription (often wraps): "... given you a gift subscription to the game\nTerraria on Steam."
    const givenPatterns = [
      /(?:your friend\s+(.+?)\s+)?has given you\s+a gift subscription to(?:\s+the game)?\s+([\s\S]+?)\s+on Steam/gi,
      /(?:your friend\s+(.+?)\s+)?has given you\s+(?!a gift subscription)([\s\S]+?)\s+on Steam/gi,
    ];
    for (const givenRe of givenPatterns) {
      givenRe.lastIndex = 0;
      let gm: RegExpExecArray | null;
      while ((gm = givenRe.exec(decoded)) !== null) {
        const persona =
          gm[1]?.replace(/\s+/g, " ").trim() || personaFromBody || undefined;
        const title = gm[2].replace(/\s+/g, " ").trim();
        pushUnique(out, title, {
          ...baseMeta,
          fromPersona: persona,
          source: "body",
        });
      }
    }

    const bodyPatterns = [
      /(?:has|have) sent you a gift copy of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?(?:[.!]|\n|$)/gi,
      /sent you\s+(.+?)\s+as a gift/gi,
      /you(?:'ve| have) received a gift copy of(?:\s+the game)?\s+(.+?)(?:\s+on Steam)?(?:[.!]|\n|$)/gi,
      /accept (?:your |the )?gift of\s+(.+?)(?:[.!]|\n|$)/gi,
    ];
    for (const re of bodyPatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(decoded)) !== null) {
        pushUnique(out, m[1], {
          ...baseMeta,
          fromPersona: personaFromBody,
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
          fromPersona: personaFromBody,
          source: "link",
        });
      }
    }

    // Any titles from this email that still lack a sender get the body persona.
    if (personaFromBody) {
      for (let i = chunkStart; i < out.length; i++) {
        if (!out[i].fromPersona) out[i].fromPersona = personaFromBody;
      }
    }
  }

  return out;
}
