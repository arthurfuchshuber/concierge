import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AirbnbInput = z.object({
  propertyId: z.string().uuid().optional(),
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .transform((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
    .pipe(z.string().url("Cole um link válido"))
    .refine((u) => {
      try {
        const parsed = new URL(u);
        const hostOk = /^(?:[a-z0-9-]+\.)?airbnb\.[a-z.]+$/i.test(parsed.hostname);
        const pathOk = /^\/(rooms|h)\//i.test(parsed.pathname);
        return hostOk && pathOk;
      } catch {
        return false;
      }
    }, "Use um link público do anúncio (airbnb.com/h/... ou /rooms/...)"),
});

export type AirbnbAmenity = { name: string; available: boolean };
export type AirbnbRoomBeds = { room: string; beds: string };

export type AirbnbImportResult = {
  name: string | null;
  /** Descrição curta em texto livre. Grava em `properties.short_description`
   * — NUNCA em `properties.tagline`, que é um seletor fixo de "Tipo do
   * guia" (3 opções) e não texto livre; escrever a descrição ali deixava o
   * campo "sem seleção" na tela (bug encontrado em 03/09/2026). */
  short_description: string | null;
  city: string | null;
  country: string | null;
  checkin_time: string | null;
  checkin_time_max: string | null;
  checkout_time: string | null;
  gallery_images: string[];
  hero_image_url: string | null;
  // Campos "ampliados" (pedido do cliente em 03/09/2026): avaliação, resumo
  // de hóspedes/quartos/camas/banheiros, descrição completa (atrás do
  // "Mostrar mais"), quartos+camas individuais, comodidades completas
  // (incluindo riscadas/indisponíveis) e o conteúdo de "O que você deve
  // saber" (regras da casa, cancelamento, segurança). Estes dependem de
  // simular cliques em botões "Mostrar mais"/"Saiba mais" do Airbnb — ver
  // AIRBNB_EXPAND_ACTIONS — por isso são mais sujeitos a falhar
  // silenciosamente se o Airbnb mudar o HTML dessas telas. A varredura
  // diária (refreshStaleAirbnbListings) monitora isso e avisa os admins do
  // SaaS via push quando detecta uma queda anormal nesses campos.
  rating: number | null;
  guest_count: number | null;
  bedroom_count: number | null;
  bed_count: number | null;
  bathroom_count: number | null;
  description_full: string | null;
  rooms_beds: AirbnbRoomBeds[];
  amenities: AirbnbAmenity[];
  house_rules: string | null;
  cancellation_policy: string | null;
  safety_info: string | null;
};

type FirecrawlAction =
  | { type: "wait"; milliseconds: number }
  | { type: "click"; selector: string; all?: boolean }
  | { type: "scroll"; selector?: string; direction?: "up" | "down"; amount?: number };

type FirecrawlScrapeOptions = {
  formats?: Array<string | { type: "json"; schema?: Record<string, unknown>; prompt?: string }>;
  onlyMainContent?: boolean;
  waitFor?: number;
  actions?: FirecrawlAction[];
};

// Sequência de cliques "melhor esforço" pra revelar conteúdo que o Airbnb
// esconde atrás de "Mostrar mais"/"Saiba mais" antes de ler a página:
// descrição completa, comodidades (todas, incluindo riscadas, atrás do
// "Mostrar todas as X comodidades") e o modal "O que você deve saber"
// (regras da casa, cancelamento, segurança) com suas próprias expansões
// internas. Os seletores usam correspondência parcial de aria-label
// (`*=`), que tende a sobreviver a redesigns melhor que classes CSS
// ofuscadas — mas o Airbnb não documenta esse HTML publicamente, então
// isto é uma aposta educada, não uma garantia. Se um seletor não achar
// nada, o Firecrawl segue em frente sem travar a extração (por isso os
// cliques ficam numa tentativa separada, com uma tentativa mais simples
// como rede de segurança logo depois — ver scrapeAirbnbListing).
const AIRBNB_EXPAND_ACTIONS: FirecrawlAction[] = [
  { type: "wait", milliseconds: 1200 },
  { type: "click", selector: "button[aria-label*='descri' i], button[aria-expanded='false']", all: true },
  { type: "wait", milliseconds: 500 },
  { type: "click", selector: "button[aria-label*='comodidades' i], button[aria-label*='amenities' i]" },
  { type: "wait", milliseconds: 900 },
  { type: "click", selector: "button[aria-label*='saiba mais' i], button[aria-label*='know' i], a[aria-label*='saiba mais' i]", all: true },
  { type: "wait", milliseconds: 900 },
  { type: "click", selector: "[role='dialog'] button[aria-label*='mostrar mais' i], [role='dialog'] button[aria-label*='show more' i]", all: true },
  { type: "wait", milliseconds: 500 },
];

async function scrapeWithFirecrawl(apiKey: string, url: string, options: FirecrawlScrapeOptions): Promise<unknown> {
  const response = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, ...options }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : response.statusText;
    throw new Error(message || `Firecrawl retornou HTTP ${response.status}`);
  }

  return payload;
}

function normalizeHour(hour: number, minute: number, meridiem?: string | null): string {
  let h = hour;
  if (meridiem) {
    const m = meridiem.toLowerCase();
    if (m === "pm" && h < 12) h += 12;
    else if (m === "am" && h === 12) h = 0;
  }
  h = Math.min(23, Math.max(0, h));
  return `${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function pickTimes(text?: string | null): string[] {
  if (!text) return [];
  const results: string[] = [];
  // Match "3:00 PM", "15:00", "3 PM", "15h", optionally with AM/PM suffix.
  const re = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm|h)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const hh = parseInt(m[1], 10);
    if (isNaN(hh) || hh > 23) continue;
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (mm > 59) continue;
    const mer = m[3] && m[3].toLowerCase() !== "h" ? m[3] : null;
    // Skip lone single digits with no minutes and no meridiem (likely noise).
    if (!m[2] && !m[3]) continue;
    results.push(normalizeHour(hh, mm, mer));
  }
  return results;
}

function pickTime(text?: string | null): string | null {
  return pickTimes(text)[0] ?? null;
}

// Schema de extração via Firecrawl — único lugar que define o que "importar
// do Airbnb" significa. Usado tanto pelo import manual (botão "Importar")
// quanto pela sincronização automática diária (refreshStaleAirbnbListings),
// pra nunca os dois divergirem no que é lido do anúncio.
const AIRBNB_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Title or name of the listing" },
    description: { type: "string", description: "Short description / tagline (1-2 sentences)" },
    city: { type: "string", description: "City name only" },
    country: { type: "string", description: "Country name only" },
    checkin_time: { type: "string", description: "Check-in start time as displayed, e.g. '15:00' or '3:00 PM' or 'After 3:00 PM'. If a range is shown (e.g. 'Between 3:00 PM and 11:00 PM'), include both times in the original order." },
    checkin_time_max: { type: "string", description: "End of the check-in window if shown as a range, e.g. '23:00' or '11:00 PM'. Otherwise empty." },
    checkout_time: { type: "string", description: "Check-out time as displayed, e.g. '11:00' or '11:00 AM' or 'Before 11:00 AM'" },
    photos: {
      type: "array",
      description: "URLs of the first 4 listing photos in display order. Full https URLs from muscache.com.",
      items: { type: "string" },
      maxItems: 4,
    },
    rating: { type: "string", description: "Overall star rating exactly as displayed near the top, e.g. '4.91' or '4,91'. Empty string if the listing has no reviews yet." },
    guest_summary: { type: "string", description: "The subtitle line below the title/rating listing capacity, exactly as displayed, e.g. '7 hóspedes · 3 quartos · 4 camas · 2 banheiros' or '7 guests · 3 bedrooms · 4 beds · 2 baths'." },
    description_full: { type: "string", description: "The COMPLETE listing description text (every paragraph), fully expanded — not the short truncated version. Include text revealed by any 'Show more'/'Mostrar mais' button under the description." },
    rooms_beds: {
      type: "array",
      description: "One entry per bedroom/sleeping space shown in the 'Where you'll sleep'/'Onde você vai dormir' section, including every room even if the section scrolls horizontally.",
      items: {
        type: "object",
        properties: {
          room: { type: "string", description: "Room label, e.g. 'Quarto 1' or 'Bedroom 1'" },
          beds: { type: "string", description: "Bed description for that room, e.g. '1 cama de casal' or '1 queen bed'" },
        },
      },
    },
    amenities: {
      type: "array",
      description: "EVERY amenity listed on the page, including ones revealed only after clicking 'Mostrar todas as comodidades'/'Show all amenities', and including ones shown with a strikethrough (meaning NOT offered) — do not skip the strikethrough ones.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Amenity name as displayed, e.g. 'Wi-Fi' or 'Piscina'" },
          available: { type: "boolean", description: "false if the amenity is shown with a strikethrough / marked as not included, true otherwise" },
        },
      },
    },
    house_rules: { type: "string", description: "Full text/bullets of the house rules ('Regras da casa'), including anything behind a 'Saiba mais'/'Show more' inside the 'O que você deve saber'/'Things to know' section." },
    cancellation_policy: { type: "string", description: "Full text of the cancellation policy shown in the 'O que você deve saber'/'Things to know' section, including anything behind 'Saiba mais'/'Show more'." },
    safety_info: { type: "string", description: "Full text of the safety & property info shown in the 'O que você deve saber'/'Things to know' section, including anything behind 'Saiba mais'/'Show more'." },
  },
  required: ["title"],
};

/** Extrai os quatro números do subtítulo "7 hóspedes · 3 quartos · 4 camas ·
 *  2 banheiros" (aceita separadores variados e "studio"/"sem quarto" como 0
 *  quartos). Cada número fica null se aquele item não aparecer no texto. */
function parseGuestSummary(text: string | null | undefined): {
  guests: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathrooms: number | null;
} {
  const empty = { guests: null, bedrooms: null, beds: null, bathrooms: null };
  if (!text) return empty;
  const num = (re: RegExp): number | null => {
    const m = text.match(re);
    if (!m) return null;
    const n = parseFloat(m[1].replace(",", "."));
    return isNaN(n) ? null : n;
  };
  const guests = num(/(\d+(?:[.,]\d+)?)\s*(?:hóspedes?|guests?)/i);
  const isStudio = /\bstudio\b|\bconjugado\b/i.test(text);
  const bedrooms = isStudio ? 0 : num(/(\d+(?:[.,]\d+)?)\s*(?:quartos?|bedrooms?)/i);
  const beds = num(/(\d+(?:[.,]\d+)?)\s*(?:camas?|beds?)/i);
  const bathrooms = num(/(\d+(?:[.,]\d+)?)\s*(?:banheiros?|baths?|bathrooms?)/i);
  return {
    guests: guests !== null ? Math.round(guests) : null,
    bedrooms: bedrooms !== null ? Math.round(bedrooms) : null,
    beds: beds !== null ? Math.round(beds) : null,
    bathrooms,
  };
}

function parseRating(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1].replace(",", "."));
  return isNaN(n) || n < 0 || n > 5 ? null : n;
}

function parseRoomsBeds(value: unknown): AirbnbRoomBeds[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const room = typeof (v as Record<string, unknown>).room === "string" ? (v as Record<string, unknown>).room as string : "";
      const beds = typeof (v as Record<string, unknown>).beds === "string" ? (v as Record<string, unknown>).beds as string : "";
      return room.trim() || beds.trim() ? { room: room.trim(), beds: beds.trim() } : null;
    })
    .filter((v): v is AirbnbRoomBeds => v !== null);
}

function parseAmenities(value: unknown): AirbnbAmenity[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const name = typeof (v as Record<string, unknown>).name === "string" ? (v as Record<string, unknown>).name as string : "";
      if (!name.trim()) return null;
      const available = (v as Record<string, unknown>).available !== false;
      return { name: name.trim(), available };
    })
    .filter((v): v is AirbnbAmenity => v !== null);
}

/** Lê o anúncio público do Airbnb via Firecrawl e devolve os campos já
 *  normalizados. Levanta uma mensagem amigável (bloqueio do Airbnb vs. erro
 *  genérico) em vez do erro cru do Firecrawl. */
async function scrapeAirbnbListing(apiKey: string, url: string): Promise<AirbnbImportResult> {
  let result: unknown;
  let lastErr: unknown;
  const attempts: FirecrawlScrapeOptions[] = [
    // 1) Tentativa "completa": simula os cliques de "Mostrar mais"/"Saiba
    //    mais" antes de ler a página, pra pegar também os campos ampliados
    //    (descrição completa, comodidades, quartos/camas, "O que você deve
    //    saber"). É a mais frágil (depende dos seletores em
    //    AIRBNB_EXPAND_ACTIONS continuarem batendo com o HTML do Airbnb).
    { formats: [{ type: "json", schema: AIRBNB_EXTRACTION_SCHEMA }], onlyMainContent: false, waitFor: 2500, actions: AIRBNB_EXPAND_ACTIONS },
    // 2) Sem simular cliques: ainda lê o schema completo (rating, subtítulo,
    //    descrição, quartos/camas costumam já estar no HTML mesmo sem
    //    clicar) — só as seções realmente atrás de um modal/JS (comodidades
    //    completas, "O que você deve saber") tendem a vir vazias aqui.
    { formats: [{ type: "json", schema: AIRBNB_EXTRACTION_SCHEMA }], onlyMainContent: false, waitFor: 2500 },
    { formats: [{ type: "json", schema: AIRBNB_EXTRACTION_SCHEMA }], onlyMainContent: false },
    // 4) Rede de segurança final: só os 7 campos básicos, sem o schema
    //    grande — garante que o import não fica totalmente vazio mesmo se o
    //    Airbnb estiver bloqueando ou a página mudou muito.
    { formats: [{ type: "json", prompt: "Extract title, description (tagline), city, country, checkin_time, checkout_time, and up to 4 photo URLs from muscache.com." }], onlyMainContent: false },
  ];
  for (const opts of attempts) {
    try {
      result = await scrapeWithFirecrawl(apiKey, url, opts);
      lastErr = undefined;
      break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) {
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new Error(
      /exception ID|unexpected error/i.test(msg)
        ? "O Airbnb bloqueou a leitura deste anúncio agora. Tente novamente em alguns minutos ou preencha os campos manualmente."
        : `Não foi possível ler o anúncio: ${msg}`
    );
  }

  const r = result as {
    json?: Record<string, unknown>;
    data?: { json?: Record<string, unknown> };
    metadata?: { ogImage?: string };
  };
  const j = (r.json ?? r.data?.json ?? {}) as Record<string, unknown>;

  const title = typeof j.title === "string" ? j.title.trim() : null;
  const description = typeof j.description === "string" ? j.description.trim() : null;
  const city = typeof j.city === "string" ? j.city.trim() : null;
  const country = typeof j.country === "string" ? j.country.trim() : null;
  const photos = Array.isArray(j.photos)
    ? (j.photos as unknown[])
        .filter((p): p is string => typeof p === "string" && /^https?:\/\//.test(p))
        .slice(0, 4)
    : [];

  const checkinRaw = typeof j.checkin_time === "string" ? j.checkin_time : null;
  const checkinMaxRaw = typeof j.checkin_time_max === "string" ? j.checkin_time_max : null;
  const checkinTimes = pickTimes(checkinRaw);
  const checkoutTime = pickTime(typeof j.checkout_time === "string" ? j.checkout_time : null);
  const checkinTime = checkinTimes[0] ?? null;
  const checkinTimeMax = pickTime(checkinMaxRaw) ?? checkinTimes[1] ?? null;

  const rating = parseRating(typeof j.rating === "string" ? j.rating : null);
  const guestSummary = parseGuestSummary(typeof j.guest_summary === "string" ? j.guest_summary : null);
  const descriptionFull = typeof j.description_full === "string" && j.description_full.trim() ? j.description_full.trim() : null;
  const roomsBeds = parseRoomsBeds(j.rooms_beds);
  const amenities = parseAmenities(j.amenities);
  const houseRules = typeof j.house_rules === "string" && j.house_rules.trim() ? j.house_rules.trim() : null;
  const cancellationPolicy = typeof j.cancellation_policy === "string" && j.cancellation_policy.trim() ? j.cancellation_policy.trim() : null;
  const safetyInfo = typeof j.safety_info === "string" && j.safety_info.trim() ? j.safety_info.trim() : null;

  return {
    name: title,
    short_description: description,
    city,
    country,
    checkin_time: checkinTime,
    checkin_time_max: checkinTimeMax,
    checkout_time: checkoutTime,
    gallery_images: photos,
    hero_image_url: photos[0] ?? null,
    rating,
    guest_count: guestSummary.guests,
    bedroom_count: guestSummary.bedrooms,
    bed_count: guestSummary.beds,
    bathroom_count: guestSummary.bathrooms,
    description_full: descriptionFull,
    rooms_beds: roomsBeds,
    amenities,
    house_rules: houseRules,
    cancellation_policy: cancellationPolicy,
    safety_info: safetyInfo,
  };
}

export const importFromAirbnb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AirbnbInput.parse(i))
  .handler(async ({ data, context }): Promise<AirbnbImportResult> => {
    const { assertFeature } = await import("@/lib/plan-guard.server");
    await assertFeature(context.supabase, context.userId, "autoImport", { propertyId: data.propertyId ?? null });
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("Integração Firecrawl indisponível");
    return scrapeAirbnbListing(apiKey, data.url);
  });

const FIELD_LABELS_AIRBNB: Record<string, string> = {
  name: "Nome",
  short_description: "Descrição curta",
  city: "Cidade",
  country: "País",
  checkin_time: "Check-in",
  checkin_time_max: "Check-in",
  checkout_time: "Check-out",
  gallery_images: "Fotos",
  airbnb_rating: "Avaliação",
  airbnb_guest_count: "Hóspedes/quartos/camas/banheiros",
  airbnb_bedroom_count: "Hóspedes/quartos/camas/banheiros",
  airbnb_bed_count: "Hóspedes/quartos/camas/banheiros",
  airbnb_bathroom_count: "Hóspedes/quartos/camas/banheiros",
  airbnb_description_full: "Descrição completa",
  airbnb_rooms_beds: "Quartos e camas",
  airbnb_amenities: "Comodidades",
  airbnb_house_rules: "Regras da casa",
  airbnb_cancellation_policy: "Política de cancelamento",
  airbnb_safety_info: "Segurança e propriedade",
};

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/** Compara o anúncio público (via Firecrawl) com o que está salvo e aplica
 *  só o que de fato mudou. Chamada uma vez por dia por
 *  `/api/public/cron/refresh-airbnb-listings` (agendado no pg_cron — ver
 *  migration correspondente) — mesmo mecanismo de leitura do botão manual
 *  "Importar" (scrapeAirbnbListing), só que percorrendo sozinho todos os
 *  imóveis com um link do Airbnb cadastrado, dos menos verificados
 *  recentemente pra frente, e aplicando a mudança direto (sem precisar de
 *  alguém clicar "Salvar"). Cada imóvel grava seu próprio horário/erro da
 *  última tentativa em `airbnb_listing_last_synced_at`/`_last_error`, e um
 *  resumo em português do que mudou em `airbnb_listing_last_sync_note`
 *  (nulo quando a checagem não achou nada novo).
 *
 *  Também compara, campo a campo, o resultado de hoje com o que já estava
 *  salvo: se um campo que tinha conteúdo (principalmente os "ampliados",
 *  que dependem de cliques simulados em botões que o Airbnb pode mudar sem
 *  aviso — ver AIRBNB_EXPAND_ACTIONS) vier vazio numa leitura que não deu
 *  erro, isso é registrado como possível falha silenciosa. No fim da
 *  varredura, se algum imóvel apresentou isso, um único push é enviado aos
 *  admins do SaaS (notifySaasAdmins) resumindo o que sumiu — pedido do
 *  cliente em 03/09/2026 pra não deixar essas quebras passarem batido. */
export async function refreshStaleAirbnbListings(limit: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { updated: 0, unchanged: 0, failed: 0, total: 0, skipped: "sem FIRECRAWL_API_KEY" };

  const cap = Math.max(1, Math.min(200, limit));
  const { data: rows, error } = await supabaseAdmin
    .from("properties")
    .select(
      "id, name, short_description, city, country, checkin_time, checkin_time_max, checkout_time, gallery_images, hero_image_url, airbnb_listing_url, airbnb_rating, airbnb_guest_count, airbnb_bedroom_count, airbnb_bed_count, airbnb_bathroom_count, airbnb_description_full, airbnb_rooms_beds, airbnb_amenities, airbnb_house_rules, airbnb_cancellation_policy, airbnb_safety_info",
    )
    .not("airbnb_listing_url", "is", null)
    .neq("airbnb_listing_url", "")
    .order("airbnb_listing_last_synced_at", { ascending: true, nullsFirst: true })
    .limit(cap);
  if (error) throw error;

  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const anomalies: Array<{ propertyName: string; fields: string[] }> = [];

  for (const row of rows ?? []) {
    const rowRec = row as Record<string, unknown>;
    const url = rowRec.airbnb_listing_url as string | null;
    if (!url) continue;
    const now = new Date().toISOString();
    try {
      const scraped = await scrapeAirbnbListing(apiKey, url);
      const patch: Record<string, unknown> = {};
      const changedLabels: string[] = [];
      const missingFields: string[] = [];

      const noteChanged = (label: string) => {
        if (!changedLabels.includes(label)) changedLabels.push(label);
      };
      const noteMissing = (label: string) => {
        if (!missingFields.includes(label)) missingFields.push(label);
      };

      // Campos de texto: só sobrescreve quando a leitura de hoje trouxe
      // algo (nunca apaga um valor salvo por causa de um campo vazio) —
      // mas registra a ausência pra fins de alerta se antes havia conteúdo.
      const syncText = (column: string, value: string | null) => {
        const had = !isEmptyValue(rowRec[column]);
        if (value === null || value.trim() === "") {
          if (had) noteMissing(FIELD_LABELS_AIRBNB[column] ?? column);
          return;
        }
        if (value !== rowRec[column]) {
          patch[column] = value;
          noteChanged(FIELD_LABELS_AIRBNB[column] ?? column);
        }
      };
      const syncNumber = (column: string, value: number | null) => {
        const had = !isEmptyValue(rowRec[column]);
        if (value === null) {
          if (had) noteMissing(FIELD_LABELS_AIRBNB[column] ?? column);
          return;
        }
        if (rowRec[column] !== value) {
          patch[column] = value;
          noteChanged(FIELD_LABELS_AIRBNB[column] ?? column);
        }
      };
      const syncJsonArray = (column: string, value: unknown[]) => {
        const had = !isEmptyValue(rowRec[column]);
        if (value.length === 0) {
          if (had) noteMissing(FIELD_LABELS_AIRBNB[column] ?? column);
          return;
        }
        if (JSON.stringify(value) !== JSON.stringify(rowRec[column] ?? [])) {
          patch[column] = value;
          noteChanged(FIELD_LABELS_AIRBNB[column] ?? column);
        }
      };

      syncText("name", scraped.name);
      syncText("short_description", scraped.short_description);
      syncText("city", scraped.city);
      syncText("country", scraped.country);
      syncText("checkin_time", scraped.checkin_time);
      syncText("checkin_time_max", scraped.checkin_time_max);
      syncText("checkout_time", scraped.checkout_time);

      const newGallery = scraped.gallery_images.filter((u) => u.trim()).slice(0, 4);
      const currentGallery = (rowRec.gallery_images ?? []) as string[];
      if (newGallery.length === 0) {
        if (!isEmptyValue(currentGallery)) noteMissing(FIELD_LABELS_AIRBNB.gallery_images);
      } else if (JSON.stringify(newGallery) !== JSON.stringify(currentGallery)) {
        patch.gallery_images = newGallery;
        patch.hero_image_url = newGallery[0];
        noteChanged(FIELD_LABELS_AIRBNB.gallery_images);
      }

      // Campos "ampliados" — ver AirbnbImportResult para o porquê de serem
      // mais sujeitos a vir vazios mesmo numa leitura sem erro.
      syncNumber("airbnb_rating", scraped.rating);
      syncNumber("airbnb_guest_count", scraped.guest_count);
      syncNumber("airbnb_bedroom_count", scraped.bedroom_count);
      syncNumber("airbnb_bed_count", scraped.bed_count);
      syncNumber("airbnb_bathroom_count", scraped.bathroom_count);
      syncText("airbnb_description_full", scraped.description_full);
      syncJsonArray("airbnb_rooms_beds", scraped.rooms_beds);
      syncJsonArray("airbnb_amenities", scraped.amenities);
      syncText("airbnb_house_rules", scraped.house_rules);
      syncText("airbnb_cancellation_policy", scraped.cancellation_policy);
      syncText("airbnb_safety_info", scraped.safety_info);

      patch.airbnb_listing_last_synced_at = now;
      patch.airbnb_listing_last_error = null;
      patch.airbnb_listing_last_sync_note = changedLabels.length
        ? `Atualizado automaticamente: ${changedLabels.join(", ")} (${new Date(now).toLocaleDateString("pt-BR")})`
        : null;

      const { error: updErr } = await supabaseAdmin.from("properties").update(patch).eq("id", row.id);
      if (updErr) throw updErr;
      if (changedLabels.length) updated++;
      else unchanged++;

      if (missingFields.length > 0) {
        anomalies.push({ propertyName: (rowRec.name as string | null)?.trim() || url, fields: missingFields });
      }
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message.slice(0, 300) : "Erro desconhecido";
      await supabaseAdmin
        .from("properties")
        .update({ airbnb_listing_last_synced_at: now, airbnb_listing_last_error: message })
        .eq("id", row.id);
    }
  }

  if (anomalies.length > 0) {
    try {
      const { notifySaasAdmins } = await import("@/lib/saas-admin-push.server");
      const shown = anomalies.slice(0, 8).map((a) => `${a.propertyName}: ${a.fields.join(", ")}`);
      const extra = anomalies.length > 8 ? `\n+ ${anomalies.length - 8} outro(s) imóvel(is)` : "";
      await notifySaasAdmins({
        title: `⚠️ Sync Airbnb: ${anomalies.length} imóvel(is) com campo(s) que sumiram`,
        body: `Comparado ao que já estava salvo, estes campos vieram vazios hoje (a leitura não deu erro):\n${shown.join("\n")}${extra}\n\nPode ser o Airbnb tendo mudado a página — vale conferir manualmente.`.slice(
          0,
          500,
        ),
        data: { url: "/admin", tag: `airbnb-sync-anomaly-${new Date().toISOString().slice(0, 10)}` },
      });
    } catch (e) {
      console.error("[refreshStaleAirbnbListings] falha ao notificar admins do SaaS sobre anomalia", e);
    }
  }

  return { updated, unchanged, failed, total: (rows ?? []).length, anomalies: anomalies.length };
}
