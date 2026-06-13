import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AirbnbInput = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .transform((u) => (/^https?:\/\//i.test(u) ? u : `https://${u}`))
    .pipe(z.string().url("Cole um link válido"))
    .refine((u) => /airbnb\.[a-z.]+\/(rooms|h)\//i.test(u), "Use um link público do anúncio (airbnb.com/h/... ou /rooms/...)"),
});

export type AirbnbImportResult = {
  name: string | null;
  tagline: string | null;
  city: string | null;
  country: string | null;
  checkin_time: string | null;
  checkout_time: string | null;
  gallery_images: string[];
  hero_image_url: string | null;
};

function pickTime(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(/([01]?\d|2[0-3]):([0-5]\d)/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  // "15h" / "11h" / "3 PM"
  const h = text.match(/\b(\d{1,2})\s*(?:h|PM|AM|pm|am)\b/);
  if (h) {
    const n = Math.min(23, Math.max(0, parseInt(h[1], 10)));
    return `${String(n).padStart(2, "0")}:00`;
  }
  return null;
}

export const importFromAirbnb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => AirbnbInput.parse(i))
  .handler(async ({ data }): Promise<AirbnbImportResult> => {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new Error("Integração Firecrawl indisponível");

    const { default: Firecrawl } = await import("@mendable/firecrawl-js");
    const firecrawl = new Firecrawl({ apiKey });

    // Use scrape with JSON extraction via prompt — handles JS rendering and Airbnb's anti-bot.
    const extractionSchema = {
      type: "object",
      properties: {
        title: { type: "string", description: "Title or name of the listing" },
        description: { type: "string", description: "Short description / tagline (1-2 sentences)" },
        city: { type: "string", description: "City name only" },
        country: { type: "string", description: "Country name only" },
        checkin_time: { type: "string", description: "Check-in start time as displayed, e.g. '15:00' or '3:00 PM' or 'After 3:00 PM'" },
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
    const attempts: Parameters<typeof firecrawl.scrape>[1][] = [
      { formats: [{ type: "json", schema: extractionSchema }], onlyMainContent: false, waitFor: 2500 },
      { formats: [{ type: "json", schema: extractionSchema }], onlyMainContent: false },
      { formats: [{ type: "json", prompt: "Extract title, description (tagline), city, country, checkin_time, checkout_time, and up to 4 photo URLs from muscache.com." }], onlyMainContent: false },
    ];
    for (const opts of attempts) {
      try {
        result = await firecrawl.scrape(data.url, opts);
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

    return {
      name: title,
      tagline: description,
      city,
      country,
      checkin_time: pickTime(typeof j.checkin_time === "string" ? j.checkin_time : null),
      checkout_time: pickTime(typeof j.checkout_time === "string" ? j.checkout_time : null),
      gallery_images: photos,
      hero_image_url: photos[0] ?? null,
    };
  });
