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

  const sys = `Você é o curador editorial de um concierge de luxo. Sua missão: selecionar APENAS conteúdo POSITIVO e inspirador da cidade específica para turistas em estadia. Idioma: ${langName}.

REGRAS ABSOLUTAS — DESCARTE IMEDIATAMENTE:
- Qualquer notícia negativa: crimes, acidentes, tragédias, mortes, violência, desastres, protestos, greves.
- Política (municipal, estadual ou nacional), economia geral, escândalos.
- Esportes profissionais, futebol, resultados de jogos.
- Trânsito, obras, problemas urbanos, reclamações.
- Propaganda genérica, promoções de e-commerce, conteúdo nacional não local.
- Qualquer coisa que não seja EXCLUSIVAMENTE sobre a cidade mencionada.

PRIORIZE — turismo, hospitalidade e experiência:
- Eventos culturais/gastronômicos com data (festivais, shows, feiras, exposições).
- Restaurantes, bares, cafés e novidades gastronômicas locais.
- Passeios, trilhas, atrações naturais, parques, mirantes.
- Cultura, arte, música, teatro local.
- Vida noturna, roteiros, experiências únicas da cidade.

Se o resultado não for claramente local e positivo, descarte-o. Melhor devolver 3 itens excelentes do que 7 medianos.`;
  const user = `Cidade-alvo: ${params.cityLabel}${params.country ? `, ${params.country}` : ""}.
Selecione entre 3 e 6 itens EXCLUSIVAMENTE sobre esta cidade que animem um hóspede HOJE.

Retorne JSON estrito: {"items":[{"title":"...","category":"...","summary":"...","emoji":"...","imageQuery":"...","sourceIndex": 0}]}
- title: até 9 palavras, tom convidativo e positivo (ex: "Festival de jazz ilumina o centro histórico"). Nunca copie o título original.
- category: uma palavra entre: natureza, gastronomia, evento, passeio, cultura, noite, mercado.
- summary: 1 frase (14-22 palavras) explicando por que vale a experiência HOJE, sempre com tom acolhedor.
- emoji: 1 emoji temático (🌿 🍽️ 🎉 🧭 🎭 🌙 🛍️ etc.).
- imageQuery: 2-3 palavras em inglês para buscar foto.
- sourceIndex: índice do resultado original.

Resultados brutos (filtre agressivamente):
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

// Núcleo compartilhado — usado pelo server fn e pelo cron diário.
// Retorna { items, cached, generated } para o cron logar o que fez.
export async function generateAndCacheCityNews(input: {
  cityKey: string;
  cityLabel: string;
  country?: string | null;
  lang?: "pt" | "en" | "es" | "fr";
  force?: boolean; // ignora o cache do dia (usado pelo cron das 10h)
}): Promise<{ items: NewsItem[] | null; cached: boolean; generated: boolean }> {
  const lang = input.lang ?? "pt";
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toISOString().slice(0, 10);

  if (!input.force) {
    const { data: cached } = await supabaseAdmin
      .from("city_daily_news")
      .select("items")
      .eq("city_key", input.cityKey)
      .eq("date", today)
      .maybeSingle();
    if (cached?.items && Array.isArray(cached.items) && (cached.items as NewsItem[]).length > 0) {
      return { items: cached.items as NewsItem[], cached: true, generated: false };
    }
  }

  const query = `"${input.cityLabel}" ${input.country ?? ""} eventos festival gastronomia passeios restaurantes atrações turismo esta semana`;
  let candidates: FirecrawlSearchResult[] = [];
  try {
    candidates = await firecrawlSearch(query);
  } catch {
    candidates = [];
  }
  if (candidates.length === 0) return { items: null, cached: false, generated: false };

  let items: NewsItem[] = [];
  try {
    items = await curateWithAi({
      cityLabel: input.cityLabel,
      country: input.country ?? null,
      lang,
      candidates,
    });
  } catch {
    items = [];
  }
  if (items.length === 0) return { items: null, cached: false, generated: false };

  await supabaseAdmin
    .from("city_daily_news")
    .upsert({ city_key: input.cityKey, date: today, items }, { onConflict: "city_key,date" });

  return { items, cached: false, generated: true };
}

export const getCityNews = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<CityNews | null> => {
    const r = await generateAndCacheCityNews({
      cityKey: data.cityKey,
      cityLabel: data.cityLabel,
      country: data.country ?? null,
      lang: data.lang,
    });
    return r.items ? { items: r.items } : null;
  });
