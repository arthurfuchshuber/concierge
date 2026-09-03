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

export type AirbnbImportResult = {
  name: string | null;
  tagline: string | null;
  city: string | null;
  country: string | null;
  checkin_time: string | null;
  checkin_time_max: string | null;
  checkout_time: string | null;
  gallery_images: string[];
  hero_image_url: string | null;
};

type FirecrawlScrapeOptions = {
  formats?: Array<string | { type: "json"; schema?: Record<string, unknown>; prompt?: string }>;
  onlyMainContent?: boolean;
  waitFor?: number;
};

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
  },
  required: ["title"],
};

/** Lê o anúncio público do Airbnb via Firecrawl e devolve os campos já
 *  normalizados. Levanta uma mensagem amigável (bloqueio do Airbnb vs. erro
 *  genérico) em vez do erro cru do Firecrawl. */
async function scrapeAirbnbListing(apiKey: string, url: string): Promise<AirbnbImportResult> {
  let result: unknown;
  let lastErr: unknown;
  const attempts: FirecrawlScrapeOptions[] = [
    { formats: [{ type: "json", schema: AIRBNB_EXTRACTION_SCHEMA }], onlyMainContent: false, waitFor: 2500 },
    { formats: [{ type: "json", schema: AIRBNB_EXTRACTION_SCHEMA }], onlyMainContent: false },
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

  return {
    name: title,
    tagline: description,
    city,
    country,
    checkin_time: checkinTime,
    checkin_time_max: checkinTimeMax,
    checkout_time: checkoutTime,
    gallery_images: photos,
    hero_image_url: photos[0] ?? null,
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
  tagline: "Descrição",
  city: "Cidade",
  country: "País",
  checkin_time: "Check-in",
  checkout_time: "Check-out",
  gallery_images: "Fotos",
};

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
 *  (nulo quando a checagem não achou nada novo). */
export async function refreshStaleAirbnbListings(limit: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return { updated: 0, unchanged: 0, failed: 0, total: 0, skipped: "sem FIRECRAWL_API_KEY" };

  const cap = Math.max(1, Math.min(200, limit));
  const { data: rows, error } = await supabaseAdmin
    .from("properties")
    .select(
      "id, name, tagline, city, country, checkin_time, checkin_time_max, checkout_time, gallery_images, hero_image_url, airbnb_listing_url",
    )
    .not("airbnb_listing_url", "is", null)
    .neq("airbnb_listing_url", "")
    .order("airbnb_listing_last_synced_at", { ascending: true, nullsFirst: true })
    .limit(cap);
  if (error) throw error;

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows ?? []) {
    const url = (row as { airbnb_listing_url: string | null }).airbnb_listing_url;
    if (!url) continue;
    const now = new Date().toISOString();
    try {
      const scraped = await scrapeAirbnbListing(apiKey, url);
      const patch: Record<string, unknown> = {};
      const changedLabels: string[] = [];

      const setIfChanged = (field: keyof AirbnbImportResult & string, value: string | null) => {
        if (value === null) return;
        if (value === (row as Record<string, unknown>)[field]) return;
        patch[field] = value;
        const label = FIELD_LABELS_AIRBNB[field];
        if (label && !changedLabels.includes(label)) changedLabels.push(label);
      };

      setIfChanged("name", scraped.name);
      setIfChanged("tagline", scraped.tagline);
      setIfChanged("city", scraped.city);
      setIfChanged("country", scraped.country);
      setIfChanged("checkin_time", scraped.checkin_time);
      setIfChanged("checkin_time_max", scraped.checkin_time_max);
      setIfChanged("checkout_time", scraped.checkout_time);

      const newGallery = scraped.gallery_images.filter((u) => u.trim()).slice(0, 4);
      const currentGallery = ((row as { gallery_images: string[] | null }).gallery_images ?? []) as string[];
      if (newGallery.length && JSON.stringify(newGallery) !== JSON.stringify(currentGallery)) {
        patch.gallery_images = newGallery;
        patch.hero_image_url = newGallery[0];
        changedLabels.push(FIELD_LABELS_AIRBNB.gallery_images);
      }

      patch.airbnb_listing_last_synced_at = now;
      patch.airbnb_listing_last_error = null;
      patch.airbnb_listing_last_sync_note = changedLabels.length
        ? `Atualizado automaticamente: ${changedLabels.join(", ")} (${new Date(now).toLocaleDateString("pt-BR")})`
        : null;

      const { error: updErr } = await supabaseAdmin.from("properties").update(patch).eq("id", row.id);
      if (updErr) throw updErr;
      if (changedLabels.length) updated++;
      else unchanged++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message.slice(0, 300) : "Erro desconhecido";
      await supabaseAdmin
        .from("properties")
        .update({ airbnb_listing_last_synced_at: now, airbnb_listing_last_error: message })
        .eq("id", row.id);
    }
  }

  return { updated, unchanged, failed, total: (rows ?? []).length };
}
