import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  cityKey: z.string().min(1),
  cityLabel: z.string().min(1),
  country: z.string().optional(),
  lang: z.enum(["pt", "en", "es", "fr"]).default("pt"),
});

export type NewsItem = {
  title: string;
  category: string;
  summary?: string | null;
  emoji?: string | null;
  imageUrl?: string | null;
  sourceUrl?: string | null;
  sourceName?: string | null;
};

export type CityNews = { items: NewsItem[] };

type FirecrawlSearchResult = {
  url?: string;
  title?: string;
  description?: string;
  metadata?: { ogImage?: string; ogSiteName?: string };
};

async function firecrawlSearch(query: string): Promise<FirecrawlSearchResult[]> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return [];
  const r = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 10, tbs: "qdr:w", lang: "pt", country: "br" }),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[] } };
  const list = Array.isArray(j.data)
    ? j.data
    : Array.isArray((j.data as { web?: FirecrawlSearchResult[] })?.web)
      ? (j.data as { web?: FirecrawlSearchResult[] }).web!
      : [];
  return list.slice(0, 10);
}

async function curateWithAi(params: {
  cityLabel: string;
  country: string | null;
  lang: string;
  candidates: FirecrawlSearchResult[];
}): Promise<NewsItem[]> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key || params.candidates.length === 0) return [];
  const langNames = { pt: "português brasileiro", en: "English", es: "español", fr: "français" } as const;
  const langName = langNames[params.lang as keyof typeof langNames] ?? "português brasileiro";

  const feed = params.candidates
    .map((c, i) => `[${i}] ${c.title ?? ""}\n${c.description ?? ""}\nURL: ${c.url ?? ""}`)
    .join("\n\n");

  const sys = `Você seleciona e reescreve manchetes locais para hóspedes de temporada. Idioma: ${langName}. Priorize: eventos com data próxima, gastronomia, passeios, natureza, cultura, vida noturna. Descarte política nacional, tragédias, esportes profissionais, propaganda e conteúdo genérico.`;
  const user = `Cidade: ${params.cityLabel}${params.country ? `, ${params.country}` : ""}.
Abaixo estão resultados de busca reais. Selecione entre 5 e 7 mais interessantes para um turista/hóspede HOJE.
Retorne JSON estrito: {"items":[{"title":"...","category":"...","summary":"...","emoji":"...","imageQuery":"...","sourceIndex": 0}]}
- title: até 9 palavras, reescreva pra soar convidativo (nunca copie ipsis literis o título original).
- category: uma palavra entre: natureza, gastronomia, evento, passeio, cultura, noite, mercado.
- summary: 1 frase (14-22 palavras) explicando por que vale hoje.
- emoji: 1 emoji temático.
- imageQuery: 2-3 palavras em inglês para buscar foto (ex: "iguazu falls walkway").
- sourceIndex: índice do resultado original.

Resultados:
${feed}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = j.choices?.[0]?.message?.content ?? "{}";
  let parsed: {
    items?: Array<{
      title?: string;
      category?: string;
      summary?: string;
      emoji?: string;
      imageQuery?: string;
      sourceIndex?: number;
    }>;
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items: NewsItem[] = (parsed.items ?? []).slice(0, 7).map((it) => {
    const src = typeof it.sourceIndex === "number" ? params.candidates[it.sourceIndex] : undefined;
    const ogImage = src?.metadata?.ogImage ?? null;
    const siteName = src?.metadata?.ogSiteName ?? (src?.url ? new URL(src.url).hostname.replace(/^www\./, "") : null);
    return {
      title: (it.title ?? "").slice(0, 90),
      category: (it.category ?? "passeio").slice(0, 20).toLowerCase(),
      summary: it.summary ? String(it.summary).slice(0, 220) : null,
      emoji: it.emoji ? String(it.emoji).slice(0, 4) : null,
      imageUrl: ogImage,
      sourceUrl: src?.url ?? null,
      sourceName: siteName ?? null,
    };
  });
  return items.filter((i) => i.title.length > 3);
}

export const getCityNews = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<CityNews | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);

    const { data: cached } = await supabaseAdmin
      .from("city_daily_news")
      .select("items")
      .eq("city_key", data.cityKey)
      .eq("date", today)
      .maybeSingle();
    if (cached?.items && Array.isArray(cached.items) && (cached.items as NewsItem[]).length > 0) {
      return { items: cached.items as NewsItem[] };
    }

    const query = `${data.cityLabel} ${data.country ?? ""} eventos turismo gastronomia passeios essa semana`;
    let candidates: FirecrawlSearchResult[] = [];
    try {
      candidates = await firecrawlSearch(query);
    } catch {
      candidates = [];
    }
    if (candidates.length === 0) return null;

    let items: NewsItem[] = [];
    try {
      items = await curateWithAi({
        cityLabel: data.cityLabel,
        country: data.country ?? null,
        lang: data.lang,
        candidates,
      });
    } catch {
      items = [];
    }
    if (items.length === 0) return null;

    await supabaseAdmin
      .from("city_daily_news")
      .upsert({ city_key: data.cityKey, date: today, items }, { onConflict: "city_key,date" });

    return { items };
  });
