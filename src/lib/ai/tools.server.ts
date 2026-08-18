/**
 * Sistema de Ferramentas (Tool Calling).
 * Cada integração é uma ferramenta independente e auditável. O agente decide
 * quais acionar antes de responder — nunca responde por conhecimento próprio.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentTool } from "./gateway.server";
import { hybridRetrieve } from "./rag.server";
import { confidenceOf } from "./sources";

type Admin = SupabaseClient;

const MAPS_GATEWAY = "https://connector-gateway.lovable.dev/google_maps";

/** Busca a primeira foto real (Google Places) de um lugar pelo nome — mesmo
 * padrão usado no city-news, reaproveitado aqui pra ilustrar recomendações
 * no chat. Limitado a poucos lugares por chamada (custo/latência). */
async function firstPlacePhoto(name: string, city: string, regionCode: string): Promise<string | null> {
  const key = process.env.LOVABLE_API_KEY;
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY_2 ?? process.env.GOOGLE_MAPS_API_KEY;
  if (!key || !mapsKey) return null;
  try {
    const { throttledFetch } = await import("@/lib/places-throttle.server");
    const body = JSON.stringify({
      textQuery: `${name} ${city}`.slice(0, 120),
      maxResultCount: 1,
      languageCode: "pt-BR",
      regionCode,
    });
    const fieldMask = "places.photos.name";
    const res = await throttledFetch(
      `${MAPS_GATEWAY}/places/v1/places:searchText`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "X-Connection-Api-Key": mapsKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": fieldMask,
        },
        body,
        signal: AbortSignal.timeout(6000),
      },
      `agent-rec-photo::${regionCode}::${body}`,
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { places?: Array<{ photos?: Array<{ name?: string }> }> };
    const photoName = j.places?.[0]?.photos?.[0]?.name;
    if (photoName && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)) {
      return `/api/public/place-photo?name=${encodeURIComponent(photoName)}&w=600`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Schema estrito exigido pela Responses API. */
function schema(properties: Record<string, unknown>, required: string[]) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

export type ToolContext = {
  supabase: Admin;
  ownerId: string;
  propertyId: string;
  property: Record<string, unknown>;
  conversationId: string | null;
  guestName: string | null;
  /** Chave estável do hóspede (nome ou sessão) — usada pela memória pessoal. */
  guestKey: string;
  /** Chave da RESERVA (datas de check-in/check-out) — usada pelo roteiro
   * compartilhado, já que mais de uma pessoa pode estar na mesma reserva. */
  reservationKey: string;
  checkinDate: string | null;
  checkoutDate: string | null;
  sensitiveLocked: boolean;
  /** Registra as fontes efetivamente consultadas (observabilidade + validação). */
  collectSource: (entry: { source: string; title?: string | null; confidence: number; content?: string }) => void;
  /** Marca que o atendimento precisa de humano. */
  requestHandoff: (reason: string, urgency: "low" | "normal" | "high") => void;
};

export function buildGuestTools(ctx: ToolContext): AgentTool[] {
  const tools: AgentTool[] = [];

  tools.push({
    name: "search_knowledge_base",
    description:
      "Busca híbrida (semântica + textual) na base oficial: guia digital, manual da casa, FAQs, regras, " +
      "procedimentos e base de conhecimento do anfitrião. USE SEMPRE antes de afirmar qualquer coisa sobre a hospedagem.",
    parameters: schema(
      {
        query: { type: "string", description: "Consulta objetiva sobre o que precisa ser verificado." },
      },
      ["query"],
    ),
    execute: async (args) => {
      const query = String(args.query ?? "").slice(0, 300);
      const { passages } = await hybridRetrieve({
        supabase: ctx.supabase,
        ownerId: ctx.ownerId,
        propertyId: ctx.propertyId,
        query,
      });
      for (const p of passages) {
        ctx.collectSource({ source: p.source, title: p.title, confidence: p.confidence, content: p.content });
      }
      return {
        found: passages.length,
        passages: passages.map((p) => ({
          fonte: p.source,
          confiabilidade: p.confidence,
          titulo: p.title,
          conteudo: p.content,
        })),
      };
    },
  });

  tools.push({
    name: "get_property_facts",
    description:
      "Dados estruturados e oficiais da residência (endereço, horários, Wi-Fi, códigos, regras, anfitrião). " +
      "Fonte de máxima confiabilidade para qualquer dado factual do imóvel.",
    parameters: schema({}, []),
    execute: async () => {
      const p = ctx.property;
      const mask = (v: unknown) => (ctx.sensitiveLocked ? "[BLOQUEADO POR SENHA — hóspede deve liberar no guia]" : (v ?? null));
      // Instruções operacionais podem trazer o código escrito na frase: com o
      // guia bloqueado, qualquer sequência numérica sai antes de chegar à IA.
      const maskDigits = (v: unknown) => {
        if (!v) return null;
        const text = String(v);
        return ctx.sensitiveLocked
          ? text.replace(/\d[\d\s.-]{2,}/g, "[BLOQUEADO — liberar no guia]")
          : text;
      };
      ctx.collectSource({ source: "property", title: "Dados da residência", confidence: confidenceOf("property") });
      return {
        nome: p.name ?? null,
        cidade: p.city ?? null,
        estado: p.state ?? null,
        pais: p.country ?? null,
        endereco: p.address ?? null,
        como_chegar: p.address_note ?? null,
        mapa: p.maps_url ?? null,
        garagem: p.garage_maps_url ?? null,
        vagas_veiculo: p.vehicles_max ?? null,
        checkin: p.checkin_time ?? null,
        checkin_max: p.checkin_time_max ?? null,
        checkout: p.checkout_time ?? null,
        checkout_min: p.checkout_time_min ?? null,
        instrucoes_checkin: p.checkin_instructions ?? null,
        observacoes_checkin: p.checkin_note ?? null,
        instrucoes_checkout: p.checkout_instructions ?? null,
        observacoes_checkout: p.checkout_note ?? null,
        regras: p.house_rules ?? null,
        wifi_rede: p.wifi_ssid ?? null,
        wifi_senha: mask(p.wifi_password),
        entrada_portao: {
          nome: p.gate_label ?? null,
          instrucoes: maskDigits(p.gate_instructions),
          codigo: mask(p.gate_code),
        },
        fechadura: {
          nome: p.lock_label ?? null,
          instrucoes: maskDigits(p.lock_instructions),
          codigo: mask(p.lock_code),
        },
        anfitriao: p.host_name ?? null,
        telefone_anfitriao: "[Contate o anfitrião pela plataforma de reserva]",
      };
    },
  });

  tools.push({
    name: "get_reservation",
    description:
      "Consulta a reserva do hóspede (datas de check-in/check-out registradas). Fonte de confiabilidade máxima " +
      "para perguntas sobre datas, prazos e permanência.",
    parameters: schema({}, []),
    execute: async () => {
      const name = (ctx.guestName ?? "").trim();
      if (!name) return { encontrada: false, motivo: "hóspede não identificado" };
      const { data } = await ctx.supabase
        .from("guide_access_logs")
        .select("guest_name, checkin_date, checkout_date, created_at")
        .eq("property_id", ctx.propertyId)
        .eq("guest_name", name)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { encontrada: false };
      ctx.collectSource({ source: "reservation", title: "Reserva do hóspede", confidence: confidenceOf("reservation") });
      return {
        encontrada: true,
        hospede: data.guest_name,
        checkin: data.checkin_date,
        checkout: data.checkout_date,
      };
    },
  });

  tools.push({
    name: "list_recommendations",
    description:
      "Lista recomendações curadas pelo anfitrião e referências oficiais da cidade. Use antes de sugerir qualquer " +
      "lugar — nunca invente estabelecimentos.",
    parameters: schema(
      {
        categoria: {
          type: ["string", "null"],
          description: "Filtro opcional por categoria/tipo (ex.: restaurante, padaria, passeio).",
        },
      },
      ["categoria"],
    ),
    execute: async (args) => {
      const filter = typeof args.categoria === "string" ? args.categoria.toLowerCase() : null;
      const { data: recs } = await ctx.supabase
        .from("property_recommendations")
        .select("name, category, type, distance_text, note")
        .eq("property_id", ctx.propertyId)
        .limit(60);

      const { cityKey } = await import("@/lib/city-key");
      const ck = cityKey(ctx.property.city as string | null);
      const { data: cityRefs } = ck
        ? await ctx.supabase
            .from("city_references")
            .select("name, category, type, note")
            .eq("city_key", ck)
            .eq("country", (ctx.property.country as string) ?? "BR")
            .eq("is_hidden", false)
            .limit(80)
        : { data: [] as Array<Record<string, unknown>> };

      const matches = (row: Record<string, unknown>) =>
        !filter ||
        `${row.category ?? ""} ${row.type ?? ""} ${row.name ?? ""}`.toLowerCase().includes(filter);

      const proximas = (recs ?? []).filter(matches).slice(0, 25);
      const cidade = ((cityRefs ?? []) as Array<Record<string, unknown>>).filter(matches).slice(0, 30);

      // Ilustra só os primeiros de cada grupo com foto real — o resto fica
      // sem foto (a IA não perde a lista, só não teria como decidir quais
      // das 25+ opções valeriam a latência/custo de uma busca de foto cada).
      const city = (ctx.property.city as string) ?? "";
      const regionCode = ((ctx.property.country as string) ?? "BR").toUpperCase().slice(0, 2);
      const withPhotos = async <T extends { name?: unknown }>(rows: T[], limit: number) => {
        const enriched = await Promise.all(
          rows.slice(0, limit).map(async (row) => ({
            ...row,
            foto: row.name ? await firstPlacePhoto(String(row.name), city, regionCode) : null,
          })),
        );
        return [...enriched, ...rows.slice(limit)];
      };
      const [proximasComFoto, cidadeComFoto] = await Promise.all([
        withPhotos(proximas, 4),
        withPhotos(cidade, 4),
      ]);

      if (proximas.length) ctx.collectSource({ source: "recommendation", title: "Recomendações próximas", confidence: confidenceOf("recommendation") });
      if (cidade.length) ctx.collectSource({ source: "city_reference", title: "Referências da cidade", confidence: confidenceOf("city_reference") });

      return { proximas: proximasComFoto, cidade: cidadeComFoto };
    },
  });

  tools.push({
    name: "search_places",
    description:
      "Busca estabelecimentos e atrações REAIS na cidade via Google Maps. Use apenas quando a base própria não " +
      "cobrir o pedido. Nunca cite lugares que não vierem desta ferramenta ou da base própria.",
    parameters: schema(
      {
        consulta: { type: "string", description: "Ex.: 'hamburgueria em Foz do Iguaçu'." },
      },
      ["consulta"],
    ),
    execute: async (args) => {
      const key = process.env.LOVABLE_API_KEY;
      const mapsKey = process.env.GOOGLE_MAPS_API_KEY_2 ?? process.env.GOOGLE_MAPS_API_KEY;
      if (!key || !mapsKey) return { disponivel: false };
      const city = (ctx.property.city as string) ?? "";
      const query = `${String(args.consulta ?? "").slice(0, 160)}${city ? ` em ${city}` : ""}`;
      try {
        const { throttledFetch } = await import("@/lib/places-throttle.server");
        const body = JSON.stringify({ textQuery: query, languageCode: "pt-BR", regionCode: "BR", pageSize: 6 });
        const res = await throttledFetch(
          `${MAPS_GATEWAY}/places/v1/places:searchText`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
              "X-Connection-Api-Key": mapsKey,
              "X-Goog-FieldMask":
                "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.photos.name",
            },
            body,
          },
          `agent-places::${body}`,
        );
        if (!res.ok) return { disponivel: false };
        const json = (await res.json()) as {
          places?: Array<{
            displayName?: { text?: string };
            formattedAddress?: string;
            rating?: number;
            userRatingCount?: number;
            photos?: Array<{ name?: string }>;
          }>;
        };
        const lugares = (json.places ?? []).map((p) => {
          const photoName = p.photos?.[0]?.name;
          const foto =
            photoName && /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(photoName)
              ? `/api/public/place-photo?name=${encodeURIComponent(photoName)}&w=600`
              : null;
          return {
            nome: p.displayName?.text ?? "",
            endereco: p.formattedAddress ?? null,
            nota: p.rating ?? null,
            avaliacoes: p.userRatingCount ?? null,
            foto,
          };
        });
        if (lugares.length) ctx.collectSource({ source: "maps", title: query, confidence: confidenceOf("maps") });
        return { disponivel: true, lugares };
      } catch (err) {
        console.error("[tool search_places]", err);
        return { disponivel: false };
      }
    },
  });

  tools.push({
    name: "search_web",
    description:
      "Busca na internet em fontes públicas confiáveis (sites oficiais de turismo, prefeitura, veículos de " +
      "imprensa, sites dos próprios estabelecimentos). Use SOMENTE depois de consultar search_knowledge_base, " +
      "list_recommendations e get_city_news sem encontrar a resposta, e apenas para assuntos EXTERNOS ao imóvel: " +
      "eventos, horários de funcionamento, atrações, transporte, feriados e serviços da cidade. NUNCA use para " +
      "dados da hospedagem (regras, senhas, horários de check-in, reserva) — esses só vêm da base oficial. " +
      "Sempre diga ao hóspede que a informação veio de fonte externa e pode mudar.",
    parameters: schema(
      {
        consulta: {
          type: "string",
          description: "Pergunta objetiva a pesquisar. Não inclua nome, telefone ou dados do hóspede.",
        },
        recente: {
          type: ["boolean", "null"],
          description: "true quando a resposta depende de algo desta semana (evento, agenda, horário sazonal).",
        },
      },
      ["consulta", "recente"],
    ),
    execute: async (args) => {
      const key = process.env.FIRECRAWL_API_KEY;
      if (!key) return { disponivel: false, motivo: "busca externa indisponível" };
      const city = (ctx.property.city as string) ?? "";
      const consulta = String(args.consulta ?? "").slice(0, 180).trim();
      if (consulta.length < 3) return { disponivel: false };
      const query = city ? `${consulta} ${city}` : consulta;
      // Domínios que nunca servem de fonte para o hóspede (conteúdo gerado por
      // usuário, agregadores de reserva e redes sociais).
      const BLOCKED =
        /(facebook|instagram|tiktok|twitter|x\.com|pinterest|reddit|quora|booking\.com|airbnb|expedia|despegar|hoteis\.com|tripadvisor\.[a-z.]+\/ShowUserReviews)/i;
      try {
        const res = await fetch("https://api.firecrawl.dev/v2/search", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            limit: 8,
            lang: "pt",
            country: "br",
            ...(args.recente ? { tbs: "qdr:w" } : {}),
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) {
          console.error(`[tool search_web] Firecrawl ${res.status}`);
          return { disponivel: false };
        }
        const j = (await res.json()) as {
          data?: Array<{ url?: string; title?: string; description?: string }> | { web?: Array<{ url?: string; title?: string; description?: string }> };
        };
        const list = Array.isArray(j.data) ? j.data : (j.data?.web ?? []);
        const seen = new Set<string>();
        const resultados = list
          .filter((r) => r.url && !BLOCKED.test(r.url))
          .filter((r) => {
            let host = "";
            try {
              host = new URL(r.url!).hostname;
            } catch {
              return false;
            }
            if (seen.has(host)) return false;
            seen.add(host);
            return true;
          })
          .slice(0, 5)
          .map((r) => ({
            titulo: r.title ?? null,
            resumo: (r.description ?? "").slice(0, 400),
            link: r.url,
            fonte: (() => {
              try {
                return new URL(r.url!).hostname.replace(/^www\./, "");
              } catch {
                return null;
              }
            })(),
          }));
        if (!resultados.length) return { disponivel: false };
        ctx.collectSource({ source: "web", title: `Busca externa: ${consulta}`, confidence: confidenceOf("web") });
        return {
          disponivel: true,
          aviso:
            "Fonte externa: confirme com o hóspede que horários e datas podem mudar e cite de onde veio a informação.",
          resultados,
        };
      } catch (err) {
        console.error("[tool search_web]", err);
        return { disponivel: false };
      }
    },
  });


  tools.push({
    name: "get_weather",
    description: "Previsão do tempo atual da cidade da hospedagem. Use para perguntas sobre clima e planejamento do dia.",
    parameters: schema({}, []),
    execute: async () => {
      const lat = ctx.property.lat != null ? Number(ctx.property.lat) : null;
      const lng = ctx.property.lng != null ? Number(ctx.property.lng) : null;
      if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return { disponivel: false };
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (!res.ok) return { disponivel: false };
        const j = (await res.json()) as Record<string, unknown>;
        ctx.collectSource({ source: "weather", title: "Previsão do tempo", confidence: confidenceOf("weather") });
        return { disponivel: true, atual: j.current, proximos_dias: j.daily };
      } catch {
        return { disponivel: false };
      }
    },
  });

  tools.push({
    name: "get_city_news",
    description:
      "Lista os destaques do feed 'O que rola na cidade' exibido HOJE dentro do guia do hóspede (eventos, " +
      "gastronomia, passeios, cultura). USE SEMPRE que o hóspede citar um título, evento ou card que viu no guia — " +
      "esse conteúdo é curadoria da plataforma e existe de verdade na tela dele. Nunca diga que não encontrou " +
      "antes de consultar esta ferramenta.",
    parameters: schema({}, []),
    execute: async () => {
      try {
        const { cityKey } = await import("@/lib/city-key");
        const ck = cityKey(ctx.property.city as string | null);
        if (!ck) return { disponivel: false };
        const { data } = await ctx.supabase
          .from("city_daily_news")
          .select("date, items")
          .eq("city_key", ck)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        const today = new Date().toISOString().slice(0, 10);
        const { filterUpcoming } = await import("@/lib/city-news.functions");
        const raw = Array.isArray(data?.items) ? (data!.items as Array<Record<string, unknown>>) : [];
        // Nunca oferecemos ao hóspede algo que já aconteceu.
        const items = filterUpcoming(
          raw as unknown as Array<{ title: string; category: string }>,
          today,
        ) as unknown as Array<Record<string, unknown>>;
        if (!items.length) return { disponivel: false };
        ctx.collectSource({
          source: "city_reference",
          title: "Destaques da cidade no guia",
          confidence: confidenceOf("city_reference"),
        });
        return {
          disponivel: true,
          data: data?.date ?? null,
          destaques: items.slice(0, 25).map((it) => ({
            titulo: it.title,
            categoria: it.category,
            resumo: it.summary,
            data_inicio: it.startDate ?? null,
            data_fim: it.endDate ?? null,
            local: it.venue ?? null,
            fonte: it.sourceName ?? null,
            link: it.sourceUrl ?? null,
          })),
        };
      } catch (err) {
        console.error("[tool get_city_news]", err);
        return { disponivel: false };
      }
    },
  });

  tools.push({
    name: "set_reservation_mode",
    description:
      "Registra a escolha do hóspede sobre como tratar assuntos (como o roteiro da viagem) quando há mais de " +
      "uma pessoa vinculada à mesma reserva: em conjunto (grupo) ou cada um separadamente (individual). Só " +
      "chame depois que o PRÓPRIO hóspede responder claramente a essa pergunta — nunca decida por ele. O modo " +
      "grupo só entra em vigor de verdade quando TODAS as pessoas da reserva votarem grupo; enquanto isso não " +
      "acontece, cada um continua isolado — isso é esperado, não avise como se fosse um erro.",
    parameters: schema(
      {
        modo: { type: "string", enum: ["individual", "group"], description: "O que o hóspede escolheu." },
      },
      ["modo"],
    ),
    execute: async (args) => {
      if (!ctx.guestName || !ctx.checkinDate || !ctx.checkoutDate) return { ok: false };
      const { setReservationVote } = await import("./reservation-mode.server");
      await setReservationVote({
        supabase: ctx.supabase,
        propertyId: ctx.propertyId,
        checkinDate: ctx.checkinDate,
        checkoutDate: ctx.checkoutDate,
        guestName: ctx.guestName,
        vote: args.modo === "group" ? "group" : "individual",
      });
      return { ok: true };
    },
  });

  tools.push({
    name: "get_itinerary",
    description:
      "Lê o roteiro/itinerário que já foi montado com o hóspede até agora (dias e itens). Use antes de sugerir " +
      "um novo item, pra não duplicar algo que já está lá, e sempre que o hóspede perguntar o que já foi planejado.",
    parameters: schema({}, []),
    execute: async () => {
      const { getItinerary } = await import("./itinerary.server");
      const days = await getItinerary({ supabase: ctx.supabase, propertyId: ctx.propertyId, guestKey: ctx.guestKey });
      if (days.length) ctx.collectSource({ source: "itinerary", title: "Roteiro do hóspede", confidence: confidenceOf("itinerary") });
      return { dias: days };
    },
  });

  tools.push({
    name: "add_itinerary_item",
    description:
      "Adiciona um item ao roteiro do hóspede num dia específico. Use quando o hóspede confirmar interesse em " +
      "algo (\"vamos fazer isso no sábado\", \"quero ir nesse restaurante\") ou pedir explicitamente pra você " +
      "montar/atualizar o roteiro — não adicione algo que o hóspede só mencionou de passagem sem confirmar.",
    parameters: schema(
      {
        data: { type: "string", description: "Data no formato YYYY-MM-DD." },
        horario: { type: ["string", "null"], description: "Horário HH:MM, ou null se não tiver hora definida." },
        titulo: { type: "string", description: "Nome curto do item (ex.: 'Cataratas do Iguaçu — trilha das Cataratas')." },
        nota: { type: ["string", "null"], description: "Detalhe curto opcional (ex.: 'levar protetor solar')." },
        origem: {
          type: "string",
          enum: ["recommendation", "maps", "guest_request", "ai"],
          description: "De onde veio a sugestão: recommendation/maps = veio de list_recommendations/search_places; guest_request = o próprio hóspede pediu; ai = sugestão sua sem ferramenta.",
        },
      },
      ["data", "horario", "titulo", "nota", "origem"],
    ),
    execute: async (args) => {
      const { addItineraryItem } = await import("./itinerary.server");
      const days = await addItineraryItem({
        supabase: ctx.supabase,
        propertyId: ctx.propertyId,
        ownerId: ctx.ownerId,
        guestKey: ctx.guestKey,
        guestName: ctx.guestName,
        date: String(args.data ?? "").slice(0, 10),
        time: typeof args.horario === "string" ? args.horario : null,
        title: String(args.titulo ?? ""),
        note: typeof args.nota === "string" ? args.nota : null,
        source: (["recommendation", "maps", "guest_request", "ai"].includes(String(args.origem)) ? args.origem : "ai") as
          | "recommendation"
          | "maps"
          | "guest_request"
          | "ai",
      });
      return { ok: true, dias: days };
    },
  });

  tools.push({
    name: "remove_itinerary_item",
    description: "Remove um item do roteiro do hóspede pelo id (obtido via get_itinerary). Use quando o hóspede desistir de algo ou pedir pra tirar do roteiro.",
    parameters: schema({ item_id: { type: "string", description: "id do item, como retornado por get_itinerary." } }, ["item_id"]),
    execute: async (args) => {
      const { removeItineraryItem } = await import("./itinerary.server");
      const { days, removed } = await removeItineraryItem({
        supabase: ctx.supabase,
        propertyId: ctx.propertyId,
        ownerId: ctx.ownerId,
        guestKey: ctx.guestKey,
        guestName: ctx.guestName,
        itemId: String(args.item_id ?? ""),
      });
      return { ok: removed, dias: days };
    },
  });

  tools.push({
    name: "request_human_handoff",
    description:
      "Escala o atendimento para um humano. USE quando: o hóspede pedir humano/anfitrião; houver emergência ou " +
      "problema operacional no imóvel (não abriu, quebrado, vazamento, sem energia, sem acesso); ou a informação " +
      "necessária NÃO estiver nas fontes oficiais consultadas. Melhor escalar do que arriscar resposta errada.",
    parameters: schema(
      {
        reason: { type: "string", description: "Resumo em 3ª pessoa do que o hóspede precisa (máx 220 caracteres)." },
        urgency: { type: "string", enum: ["low", "normal", "high"] },
      },
      ["reason", "urgency"],
    ),
    execute: async (args) => {
      const reason = String(args.reason ?? "Hóspede pediu atendimento humano.").slice(0, 300);
      const urgency = args.urgency === "high" || args.urgency === "low" ? args.urgency : "normal";
      ctx.requestHandoff(reason, urgency as "low" | "normal" | "high");
      return { escalado: true, reason, urgency };
    },
  });

  return tools;
}
