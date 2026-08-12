import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

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
  /** Data de início confirmada (YYYY-MM-DD) — obrigatória para category="evento". */
  startDate?: string | null;
  /** Última data em que o evento ainda acontece (YYYY-MM-DD). */
  endDate?: string | null;
  /** Local confirmado do evento, quando a fonte informa. */
  venue?: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Regra de ouro do calendário: nada que já aconteceu chega ao hóspede.
 * - Itens de categoria "evento" só passam com data confirmada.
 * - Um evento é válido enquanto (endDate ?? startDate) >= hoje.
 * - Itens perenes (restaurante, passeio, natureza…) não têm data e seguem válidos.
 */
export function filterUpcoming(items: NewsItem[], today: string): NewsItem[] {
  return items.filter((it) => {
    const isEvent = (it.category ?? "").toLowerCase() === "evento";
    const start = it.startDate && ISO_DATE.test(it.startDate) ? it.startDate : null;
    const end = it.endDate && ISO_DATE.test(it.endDate) ? it.endDate : null;
    const last = end ?? start;
    if (isEvent && !last) return false; // evento sem data confirmada nunca é exibido
    if (last && last < today) return false; // já aconteceu
    return true;
  });
}

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
    body: JSON.stringify({ query, limit: 40, tbs: "qdr:w", lang: "pt", country: "br" }),
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: FirecrawlSearchResult[] | { web?: FirecrawlSearchResult[] } };
  const list = Array.isArray(j.data)
    ? j.data
    : Array.isArray((j.data as { web?: FirecrawlSearchResult[] })?.web)
      ? (j.data as { web?: FirecrawlSearchResult[] }).web!
      : [];
  return list.slice(0, 40);
}

async function curateWithAi(params: {
  cityLabel: string;
  country: string | null;
  lang: string;
  today: string;
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

Se o resultado não for claramente local e positivo, descarte-o. NÃO há limite máximo de itens — inclua TODOS os itens realmente bons e distintos que encontrar. Prefira qualidade a quantidade, mas não deixe de fora um item excelente por medo de repetir categoria: pode haver vários itens da mesma categoria (ex: vários restaurantes, vários eventos), desde que cada um seja genuinamente interessante e distinto dos outros. Descarte apenas duplicatas óbvias e itens medianos.`;
  const user = `Cidade-alvo: ${params.cityLabel}${params.country ? `, ${params.country}` : ""}.
HOJE é ${params.today}. Nunca selecione algo que já aconteceu.
Selecione TODOS os itens EXCLUSIVAMENTE sobre esta cidade que sejam realmente bons e distintos para animar um hóspede HOJE. Sem teto — pode retornar 5, 15 ou 25 itens, o que importa é a qualidade e diversidade real de opções. Aceite múltiplos itens da mesma categoria quando forem experiências distintas (ex: 4 restaurantes diferentes, 3 eventos distintos).

Retorne JSON estrito: {"items":[{"title":"...","category":"...","summary":"...","emoji":"...","imageQuery":"...","sourceIndex":0,"startDate":null,"endDate":null,"venue":null}]}
- title: até 9 palavras, tom convidativo e positivo (ex: "Festival de jazz ilumina o centro histórico"). Nunca copie o título original.
- category: uma palavra entre: natureza, gastronomia, evento, passeio, cultura, noite, mercado.
- summary: 1 frase (14-22 palavras) explicando por que vale a experiência HOJE, sempre com tom acolhedor.
- emoji: 1 emoji temático (🌿 🍽️ 🎉 🧭 🎭 🌙 🛍️ etc.).
- imageQuery: 2-3 palavras em inglês para buscar foto.
- sourceIndex: índice do resultado original.
- startDate/endDate: "YYYY-MM-DD" APENAS quando a data aparecer explicitamente no texto da fonte. Se o texto não trouxer data, use null — NUNCA deduza, estime ou invente.
- venue: local exato, se o texto informar; senão null.

REGRA DE CALENDÁRIO (obrigatória):
- Use category "evento" apenas para algo com data marcada (festival, show, feira, exposição temporária).
- Se o texto indicar que o evento já terminou antes de ${params.today}, descarte o item.
- Experiências permanentes (restaurante, parque, atração, trilha) NÃO são "evento": classifique na categoria própria e deixe as datas null.

Resultados brutos (filtre agressivamente):
${feed}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: AI_MODELS.cityPulse,
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
      startDate?: string | null;
      endDate?: string | null;
      venue?: string | null;
    }>;
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const items: NewsItem[] = (parsed.items ?? []).map((it) => {
    const src = typeof it.sourceIndex === "number" ? params.candidates[it.sourceIndex] : undefined;
    const siteName = src?.metadata?.ogSiteName ?? (src?.url ? new URL(src.url).hostname.replace(/^www\./, "") : null);
    return {
      title: (it.title ?? "").slice(0, 90),
      category: (it.category ?? "passeio").slice(0, 20).toLowerCase(),
      summary: it.summary ? String(it.summary).slice(0, 220) : null,
      emoji: it.emoji ? String(it.emoji).slice(0, 4) : null,
      // imageUrl é resolvido depois via Google Places (foto real do lugar).
      // OG image das notícias costuma não bater com o tema — evitamos.
      imageUrl: null,
      sourceUrl: src?.url ?? null,
      sourceName: siteName ?? null,
      startDate: it.startDate && ISO_DATE.test(it.startDate) ? it.startDate : null,
      endDate: it.endDate && ISO_DATE.test(it.endDate) ? it.endDate : null,
      venue: it.venue ? String(it.venue).slice(0, 120) : null,
    };
  });
  return items.filter((i) => i.title.length > 3);
}

/** Baixa o conteúdo real da página da fonte (para conferir datas). */
async function firecrawlScrape(url: string): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, timeout: 12000 }),
      signal: AbortSignal.timeout(14000),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { data?: { markdown?: string } };
    const md = j.data?.markdown;
    return md ? md.slice(0, 6000) : null;
  } catch {
    return null;
  }
}

/**
 * Confere no conteúdo real da fonte a data de cada item classificado como
 * "evento". Só sobrevive o que tem data explícita e ainda não passou — nada de
 * inferência. Sem confirmação, o item é descartado (nunca vira "talvez").
 */
async function verifyEventDates(items: NewsItem[], today: string): Promise<NewsItem[]> {
  const key = process.env.LOVABLE_API_KEY;
  const eventIdx = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => (it.category ?? "").toLowerCase() === "evento")
    .slice(0, 8);
  if (!key || eventIdx.length === 0) {
    return items.filter((it) => (it.category ?? "").toLowerCase() !== "evento" || eventIdx.length === 0 ? true : true);
  }

  const verified = new Set<number>();

  await Promise.all(
    eventIdx.map(async ({ it, i }) => {
      if (!it.sourceUrl) return;
      const page = await firecrawlScrape(it.sourceUrl);
      if (!page) return;
      try {
        const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
          body: JSON.stringify({
            model: AI_MODELS.cityPulse,
            messages: [
              {
                role: "system",
                content:
                  `Você extrai datas de eventos de um texto. HOJE é ${today}. Responda SOMENTE com JSON: ` +
                  `{"startDate":"YYYY-MM-DD"|null,"endDate":"YYYY-MM-DD"|null,"venue":string|null,"recurring":boolean}. ` +
                  `Use apenas datas explícitas no texto. Se o texto não disser a data (ou disser só "em breve", ` +
                  `"todo mês", sem dia), retorne null — jamais estime, deduza ou complete com o ano atual sem base. ` +
                  `Se o evento for semanal/recorrente e continuar acontecendo, marque recurring=true e informe a próxima ` +
                  `data apenas se estiver escrita no texto.`,
              },
              { role: "user", content: `Evento: ${it.title}\n\nConteúdo da fonte:\n${page}` },
            ],
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(12000),
        });
        if (!r.ok) return;
        const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as {
          startDate?: string | null;
          endDate?: string | null;
          venue?: string | null;
        };
        const start = parsed.startDate && ISO_DATE.test(parsed.startDate) ? parsed.startDate : null;
        const end = parsed.endDate && ISO_DATE.test(parsed.endDate) ? parsed.endDate : null;
        if (!start && !end) return;
        items[i].startDate = start;
        items[i].endDate = end;
        if (parsed.venue) items[i].venue = String(parsed.venue).slice(0, 120);
        verified.add(i);
      } catch {
        /* sem confirmação — o item cai no filtro abaixo */
      }
    }),
  );

  // Eventos sem confirmação na fonte são removidos.
  return items.filter(
    (it, i) => (it.category ?? "").toLowerCase() !== "evento" || verified.has(i),
  );
}

// Busca uma foto real do Google Places para cada item, usando o título + cidade
// como query. Se não encontrar, deixa imageUrl null (o cliente mostra fallback).
async function attachPlacePhotos(items: NewsItem[], cityLabel: string, country: string | null): Promise<NewsItem[]> {
  const apiKey = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY_2 ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || !mapsKey) return items;

  const regionCode = (country ?? "BR").toUpperCase().slice(0, 2);

  const { throttledFetch } = await import("@/lib/places-throttle.server");

  await Promise.all(
    items.map(async (it, idx) => {
      // Query robusta: título curto + cidade. Para categorias mais genéricas
      // (gastronomia, evento), incluímos a categoria pra guiar o Places.
      const q = `${it.title} ${cityLabel}`.slice(0, 120);
      try {
        const body = JSON.stringify({
          textQuery: q,
          maxResultCount: 1,
          languageCode: "pt-BR",
          regionCode,
        });
        const fieldMask = "places.photos.name";
        const url = "https://connector-gateway.lovable.dev/google_maps/places/v1/places:searchText";
        const res = await throttledFetch(
          url,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "X-Connection-Api-Key": mapsKey,
              "Content-Type": "application/json",
              "X-Goog-FieldMask": fieldMask,
            },
            body,
            signal: AbortSignal.timeout(6000),
          },
          `city-news::${regionCode}::${fieldMask}::${body}`,
        );
        if (!res.ok) return;
        const j = (await res.json()) as { places?: Array<{ photos?: Array<{ name?: string }> }> };
        const photoName = j.places?.[0]?.photos?.[0]?.name;
        if (photoName && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) {
          items[idx].imageUrl = `/api/public/place-photo?name=${encodeURIComponent(photoName)}&w=800`;
        }
      } catch {
        // ignora — mantém fallback
      }
    }),
  );
  return items;
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
      let cachedItems = cached.items as NewsItem[];
      // Migração one-shot: se o cache do dia ainda usa OG image antigo (URL http externa),
      // troca por fotos reais do Google Places e re-salva.
      const needsPhotoMigration = cachedItems.some(
        (it) => it.imageUrl && !it.imageUrl.startsWith("/api/public/place-photo"),
      ) || cachedItems.every((it) => !it.imageUrl);
      if (needsPhotoMigration) {
        try {
          cachedItems = await attachPlacePhotos(
            cachedItems.map((it) => ({ ...it, imageUrl: null })),
            input.cityLabel,
            input.country ?? null,
          );
          await supabaseAdmin
            .from("city_daily_news")
            .upsert({ city_key: input.cityKey, date: today, items: cachedItems }, { onConflict: "city_key,date" });
        } catch {
          // segue com o cache original
        }
      }
      return { items: cachedItems, cached: true, generated: false };
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
      today,
      candidates,
    });
  } catch {
    items = [];
  }
  if (items.length === 0) return { items: null, cached: false, generated: false };

  // Verificação de calendário: lê a página da fonte de cada evento e só mantém
  // o que tem data confirmada de hoje em diante.
  try {
    items = await verifyEventDates(items, today);
  } catch {
    // Sem verificação não há garantia de calendário — descartamos os eventos.
    items = items.filter((it) => (it.category ?? "").toLowerCase() !== "evento");
  }
  items = filterUpcoming(items, today);
  if (items.length === 0) return { items: null, cached: false, generated: false };

  // Enriquece com fotos reais do Google Places (foto do lugar/atração/restaurante).
  try {
    items = await attachPlacePhotos(items, input.cityLabel, input.country ?? null);
  } catch {
    // segue sem fotos — o card usa fallback local por categoria
  }

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
