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

export const importFromAirbnb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AirbnbInput.parse(i))
  .handler(async ({ data, context }): Promise<AirbnbImportResult> => {
    const { assertFeature } = await import("@/lib/plan-guard.server");
    await assertFeature(context.supabase, context.userId, "autoImport");
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("Integração Firecrawl indisponível");


    // Use scrape with JSON extraction via prompt — handles JS rendering and Airbnb's anti-bot.
    const extractionSchema = {
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

    let result: unknown;
    let lastErr: unknown;
    const attempts: FirecrawlScrapeOptions[] = [
      { formats: [{ type: "json", schema: extractionSchema }], onlyMainContent: false, waitFor: 2500 },
      { formats: [{ type: "json", schema: extractionSchema }], onlyMainContent: false },
      { formats: [{ type: "json", prompt: "Extract title, description (tagline), city, country, checkin_time, checkout_time, and up to 4 photo URLs from muscache.com." }], onlyMainContent: false },
    ];
    for (const opts of attempts) {
      try {
        result = await scrapeWithFirecrawl(apiKey, data.url, opts);
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
  });
