/**
 * Leitura pura (testável) da página pública do anúncio do Airbnb.
 * Fonte: script `data-deferred-state-0` (JSON interno) + meta `og:title`.
 * Nada aqui faz rede; quem chama baixa o HTML.
 */

export type PublicRoom = { room: string; beds: string };

export type PublicListing = {
  descriptions: string[];
  amenities: string[];
  unavailable: string[];
  /** Ex.: "Espaço inteiro: apartamento". */
  spaceType?: string | null;
  guests?: number | null;
  bedrooms?: number | null;
  beds?: number | null;
  bathrooms?: number | null;
  /** "Onde você vai dormir": um item por cômodo. */
  roomsBeds?: PublicRoom[];
  /** Regras estruturadas + orientações do anfitrião, uma por linha (formato do anúncio). */
  houseRules?: string | null;
  /** Segurança e propriedade, uma por linha. */
  safety?: string | null;
  cover?: string | null;
};

const stripHtml = (h: string) =>
  h
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const num = (t: string): number | null => {
  const m = t.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

/** Lê "3 hóspedes · 1 quarto · 2 camas · 1 banheiro" (pt/en/es) em contagens. */
export function parseCapacity(items: string[]): Pick<PublicListing, "guests" | "bedrooms" | "beds" | "bathrooms"> {
  const out: Pick<PublicListing, "guests" | "bedrooms" | "beds" | "bathrooms"> = {
    guests: null,
    bedrooms: null,
    beds: null,
    bathrooms: null,
  };
  for (const raw of items) {
    const t = raw.trim().toLowerCase();
    if (/h[oó]spede|guest|hu[eé]sped/.test(t)) out.guests ??= num(t);
    else if (/banheir|bath|baño|lavabo/.test(t)) out.bathrooms ??= /meio|half|medio/.test(t) && num(t) === null ? 0.5 : num(t);
    else if (/est[uú]dio|studio/.test(t) && out.bedrooms === null) out.bedrooms = 0;
    else if (/quarto|bedroom|dormit|habitaci/.test(t)) out.bedrooms ??= num(t);
    else if (/\bcamas?\b|\bbeds?\b/.test(t)) out.beds ??= num(t);
  }
  return out;
}

function ugc(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v.text === "string") return v.text;
  const c = v.content ?? v;
  return String(c?.localizedStringWithTranslationPreference ?? c?.localizedString ?? c?.source ?? "");
}

function detailGroups(node: any): string {
  const lines: string[] = [];
  for (const g of node?.groupItems ?? []) {
    for (const it of g?.items ?? []) {
      const title = String(it?.title ?? "").trim();
      const desc = stripHtml(ugc(it?.description)).trim();
      if (it?.type === "HOUSE_RULES_ADDITIONAL_RULES") {
        if (desc) lines.push("Regras adicionais:", desc);
        continue;
      }
      if (title) lines.push(desc ? `${title}\n${desc}` : title);
    }
  }
  return lines.join("\n").trim();
}

function findPdp(root: any): any {
  let found: any = null;
  const walk = (n: any, d: number) => {
    if (found || !n || typeof n !== "object" || d > 12) return;
    if (n.pdpPresentation && typeof n.pdpPresentation === "object") {
      found = n.pdpPresentation;
      return;
    }
    for (const v of Array.isArray(n) ? n : Object.values(n)) walk(v, d + 1);
  };
  walk(root, 0);
  return found;
}

export function parsePublicListingHtml(html: string): PublicListing | null {
  const m = html.match(/<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let root: unknown;
  try {
    root = JSON.parse(m[1]!);
  } catch {
    return null;
  }
  const descriptions = new Set<string>();
  const amenities = new Set<string>();
  const unavailable = new Set<string>();
  const walk = (n: any, depth: number) => {
    if (!n || typeof n !== "object" || depth > 40) return;
    if (Array.isArray(n)) {
      for (const x of n) walk(x, depth + 1);
      return;
    }
    if (typeof n.htmlText === "string") {
      const t = stripHtml(n.htmlText);
      if (t.length > 20) descriptions.add(t);
    }
    if (typeof n.__typename === "string" && /Amenity/i.test(n.__typename) && typeof n.title === "string") {
      const label = [n.title, typeof n.subtitle === "string" && n.subtitle ? `(${n.subtitle})` : ""].join(" ").trim();
      (n.available === false ? unavailable : amenities).add(label);
    }
    for (const v of Object.values(n)) walk(v, depth + 1);
  };
  walk(root, 0);

  const pdp = findPdp(root) ?? {};
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? "";
  const overviewItems: string[] = Array.isArray(pdp.overview?.items) ? pdp.overview.items.map(String) : [];
  const capItems = overviewItems.length ? overviewItems : og.split("·").map((s) => s.trim());
  const cap = parseCapacity(capItems);
  if (cap.guests == null && typeof pdp.personCapacity === "number") cap.guests = pdp.personCapacity;

  const roomsBeds: PublicRoom[] = [];
  for (const st of pdp.sleepingArrangements?.stops ?? []) {
    const room = String(st?.name ?? "").trim();
    const beds = (st?.description?.descriptions ?? [])
      .map((d: any) => String(d?.text ?? "").trim())
      .filter(Boolean)
      .join(", ");
    if (room || beds) roomsBeds.push({ room: room.slice(0, 80), beds: beds.slice(0, 200) });
  }

  const spaceRaw = String(pdp.overview?.title ?? "").trim();
  const spaceType = spaceRaw ? spaceRaw.replace(/\s+(em|in|en)\s+[^:]+$/i, "").trim() : null;

  const coverRaw =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, "&") ?? null;
  const cover = coverRaw && /^https:\/\//.test(coverRaw) ? coverRaw.replace(/\?im_w=\d+.*$/, "") : null;

  return {
    descriptions: [...descriptions],
    amenities: [...amenities],
    unavailable: [...unavailable],
    spaceType: spaceType || null,
    ...cap,
    roomsBeds,
    houseRules: detailGroups(pdp.rules) || null,
    safety: detailGroups(pdp.safetyAndProperty) || null,
    cover,
  };
}
