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
async function firstPlacePhoto(
  name: string,
  city: string,
  regionCode: string,
): Promise<string | null> {
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
  collectSource: (entry: {
    source: string;
    title?: string | null;
    confidence: number;
    content?: string;
  }) => void;
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
        query: {
          type: "string",
          description: "Consulta objetiva sobre o que precisa ser verificado.",
        },
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
        ctx.collectSource({
          source: p.source,
          title: p.title,
          confidence: p.confidence,
          content: p.content,
        });
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
      const mask = (v: unknown) =>
        ctx.sensitiveLocked ? "[BLOQUEADO POR SENHA — hóspede deve liberar no guia]" : (v ?? null);
      // Instruções operacionais podem trazer o código escrito na frase: com o
      // guia bloqueado, qualquer sequência numérica sai antes de chegar à IA.
      const maskDigits = (v: unknown) => {
        if (!v) return null;
        const text = String(v);
        return ctx.sensitiveLocked
          ? text.replace(/\d[\d\s.-]{2,}/g, "[BLOQUEADO — liberar no guia]")
          : text;
      };
      ctx.collectSource({
        source: "property",
        title: "Dados da residência",
        confidence: confidenceOf("property"),
      });
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
      "A estadia deste hóspede: QUAL É A UNIDADE (imóvel/apartamento) em que ele está hospedado, o endereço e as " +
      "datas de check-in/check-out registradas. Use para 'qual é o meu apartamento', 'em qual unidade eu estou', " +
      "datas, prazos e permanência. A unidade vem SEMPRE preenchida — ela é o imóvel deste guia — mesmo quando o " +
      "formulário do hóspede não é encontrado.",
    parameters: schema({}, []),
    execute: async () => {
      /**
       * O IMÓVEL É SEMPRE CONHECIDO — e é ele que responde "qual é o meu
       * apartamento".
       *
       * Um guia pertence a UM imóvel. O hóspede que está conversando aqui
       * abriu o guia daquele imóvel; não existe ambiguidade sobre em que
       * unidade ele está. Antes esta ferramenta devolvia `{encontrada:false}`
       * e mais nada quando não achava o FORMULÁRIO do hóspede, e o agente
       * concluía que não sabia nem em que apartamento a pessoa estava —
       * respondendo com uma pergunta de volta a quem só queria o número da
       * porta (caso real, 08/09/2026).
       *
       * Agora a unidade vai sempre. O que pode faltar é o formulário — e a
       * ausência dele afeta apenas as DATAS, nunca a identidade do imóvel.
       */
      const { data: prop } = await ctx.supabase
        .from("properties")
        .select("name, address, address_note")
        .eq("id", ctx.propertyId)
        .maybeSingle();
      const p = prop as {
        name: string | null;
        address: string | null;
        address_note: string | null;
      } | null;
      const unidade = {
        imovel: p?.name ?? null,
        endereco: [p?.address, p?.address_note].filter(Boolean).join(" — ") || null,
      };

      /**
       * A busca do formulário usa a MESMA cadeia tolerante do construtor de
       * contexto (ver context.server.ts): nome exato normalizado → primeiro
       * nome → estadia que cobre hoje → mais recente.
       *
       * Antes era `.eq("guest_name", name)`, igualdade byte a byte. Bastava um
       * acento, uma caixa diferente ou um sobrenome faltando para o contexto
       * ACHAR a estadia e a ferramenta NÃO achar — e o agente recebia as duas
       * coisas ao mesmo tempo, dizendo ao hóspede que não localizou a reserva
       * enquanto tinha as datas dela no próprio prompt.
       */
      const { data: rows } = await ctx.supabase
        .from("guide_access_logs")
        .select("guest_name, checkin_date, checkout_date, created_at")
        .eq("property_id", ctx.propertyId)
        .order("created_at", { ascending: false })
        .limit(50);
      const logs = (rows ?? []) as Array<{
        guest_name: string | null;
        checkin_date: string | null;
        checkout_date: string | null;
        created_at: string | null;
      }>;
      const norm = (v: string | null) =>
        (v ?? "")
          .trim()
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");
      const target = norm(ctx.guestName ?? null);
      const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
        new Date(),
      );
      const covers = (l: (typeof logs)[number]) => {
        if (!l.checkin_date) return false;
        const ci = String(l.checkin_date).slice(0, 10);
        const co = l.checkout_date ? String(l.checkout_date).slice(0, 10) : ci;
        return todayIso >= ci && todayIso <= co;
      };
      let log: (typeof logs)[number] | null = null;
      if (target) {
        // COM nome informado, só vale o que casa com ESTE hóspede. Cair para o
        // formulário mais recente do imóvel devolveria as datas de outra
        // pessoa como se fossem dele — pior que não achar nada.
        log =
          logs.find((l) => norm(l.guest_name) === target) ??
          logs.find((l) => {
            const a = norm(l.guest_name).split(" ")[0];
            const b = target.split(" ")[0];
            return !!a && !!b && a === b;
          }) ??
          null;
      } else {
        // Sem nome no contexto, a estadia que cobre hoje é a única inferência
        // defensável; nunca "a mais recente".
        log = logs.find(covers) ?? null;
      }

      ctx.collectSource({
        source: "reservation",
        title: "Reserva do hóspede",
        confidence: confidenceOf("reservation"),
      });
      if (!log?.checkin_date) {
        return {
          ...unidade,
          encontrada: false,
          motivo:
            "não há formulário de acesso casado com este hóspede — as DATAS não puderam ser confirmadas",
          observacao: "A unidade acima é a deste guia e vale mesmo sem o formulário.",
        };
      }
      return {
        ...unidade,
        encontrada: true,
        hospede: log.guest_name,
        checkin: log.checkin_date,
        checkout: log.checkout_date,
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
      const cidade = ((cityRefs ?? []) as Array<Record<string, unknown>>)
        .filter(matches)
        .slice(0, 30);

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

      if (proximas.length)
        ctx.collectSource({
          source: "recommendation",
          title: "Recomendações próximas",
          confidence: confidenceOf("recommendation"),
        });
      if (cidade.length)
        ctx.collectSource({
          source: "city_reference",
          title: "Referências da cidade",
          confidence: confidenceOf("city_reference"),
        });

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
        const body = JSON.stringify({
          textQuery: query,
          languageCode: "pt-BR",
          regionCode: "BR",
          pageSize: 6,
        });
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
        if (lugares.length)
          ctx.collectSource({ source: "maps", title: query, confidence: confidenceOf("maps") });
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
          description:
            "Pergunta objetiva a pesquisar. Não inclua nome, telefone ou dados do hóspede.",
        },
        recente: {
          type: ["boolean", "null"],
          description:
            "true quando a resposta depende de algo desta semana (evento, agenda, horário sazonal).",
        },
      },
      ["consulta", "recente"],
    ),
    execute: async (args) => {
      const key = process.env.FIRECRAWL_API_KEY;
      if (!key) return { disponivel: false, motivo: "busca externa indisponível" };
      const city = (ctx.property.city as string) ?? "";
      const consulta = String(args.consulta ?? "")
        .slice(0, 180)
        .trim();
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
          data?:
            | Array<{ url?: string; title?: string; description?: string }>
            | { web?: Array<{ url?: string; title?: string; description?: string }> };
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
        ctx.collectSource({
          source: "web",
          title: `Busca externa: ${consulta}`,
          confidence: confidenceOf("web"),
        });
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
    description:
      "Previsão do tempo atual da cidade da hospedagem. Use para perguntas sobre clima e planejamento do dia.",
    parameters: schema({}, []),
    execute: async () => {
      const lat = ctx.property.lat != null ? Number(ctx.property.lat) : null;
      const lng = ctx.property.lng != null ? Number(ctx.property.lng) : null;
      if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng))
        return { disponivel: false };
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&forecast_days=3&timezone=auto`,
          { signal: AbortSignal.timeout(6000) },
        );
        if (!res.ok) return { disponivel: false };
        const j = (await res.json()) as Record<string, unknown>;
        ctx.collectSource({
          source: "weather",
          title: "Previsão do tempo",
          confidence: confidenceOf("weather"),
        });
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
        const raw = Array.isArray(data?.items)
          ? (data!.items as Array<Record<string, unknown>>)
          : [];
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
        modo: {
          type: "string",
          enum: ["individual", "group"],
          description: "O que o hóspede escolheu.",
        },
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
      const days = await getItinerary({
        supabase: ctx.supabase,
        propertyId: ctx.propertyId,
        guestKey: ctx.guestKey,
      });
      if (days.length)
        ctx.collectSource({
          source: "itinerary",
          title: "Roteiro do hóspede",
          confidence: confidenceOf("itinerary"),
        });
      return { dias: days };
    },
  });

  tools.push({
    name: "add_itinerary_item",
    description:
      "Adiciona um item ao roteiro do hóspede num dia específico. Use quando o hóspede confirmar interesse em " +
      'algo ("vamos fazer isso no sábado", "quero ir nesse restaurante") ou pedir explicitamente pra você ' +
      "montar/atualizar o roteiro — não adicione algo que o hóspede só mencionou de passagem sem confirmar.",
    parameters: schema(
      {
        data: { type: "string", description: "Data no formato YYYY-MM-DD." },
        horario: {
          type: ["string", "null"],
          description: "Horário HH:MM, ou null se não tiver hora definida.",
        },
        titulo: {
          type: "string",
          description: "Nome curto do item (ex.: 'Cataratas do Iguaçu — trilha das Cataratas').",
        },
        nota: {
          type: ["string", "null"],
          description: "Detalhe curto opcional (ex.: 'levar protetor solar').",
        },
        origem: {
          type: "string",
          enum: ["recommendation", "maps", "guest_request", "ai"],
          description:
            "De onde veio a sugestão: recommendation/maps = veio de list_recommendations/search_places; guest_request = o próprio hóspede pediu; ai = sugestão sua sem ferramenta.",
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
        source: (["recommendation", "maps", "guest_request", "ai"].includes(String(args.origem))
          ? args.origem
          : "ai") as "recommendation" | "maps" | "guest_request" | "ai",
      });
      return { ok: true, dias: days };
    },
  });

  tools.push({
    name: "remove_itinerary_item",
    description:
      "Remove um item do roteiro do hóspede pelo id (obtido via get_itinerary). Use quando o hóspede desistir de algo ou pedir pra tirar do roteiro.",
    parameters: schema(
      { item_id: { type: "string", description: "id do item, como retornado por get_itinerary." } },
      ["item_id"],
    ),
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

  /* ---------------------------------------------------------------------
   * DISPONIBILIDADE — a IA resolvendo "posso ficar mais um dia?" sozinha
   *
   * Pedido explícito (11/09/2026), depois da auditoria: "a IA poderia muito
   * bem resolver essa situação de ponta a ponta, lendo o calendário do imóvel
   * em que ela se encontra e, ao ver que não tem disponibilidade, procurando
   * outro imóvel por proximidade para sugerir a ela".
   *
   * O caso real: 10/09, Izabela pediu +1 diária no Studio 104. O calendário
   * dizia que o 104 estava ocupado em 11–12/09 e que o Studio 105, no mesmo
   * prédio, estava LIVRE. A IA tinha esse dado e não o usou: respondeu "vou
   * confirmar" e escalou. O atendente levou vinte minutos e seis áudios para
   * chegar na mesma conclusão e mandar o link do 105 na mão.
   *
   * FONTE: `property_reservations`, alimentada pelo iCal do Airbnb. Como é
   * espelho, e espelho atrasa, as duas ferramentas devolvem `sincronizado_em`
   * e um aviso quando o feed está velho — a IA informa, mas quem confirma de
   * verdade é a plataforma. Preço NUNCA sai daqui: quem precifica é o anúncio.
   * ------------------------------------------------------------------- */

  /** Distância aproximada em km (Haversine) — só para ordenar por perto. */
  const distanciaKm = (
    a: { lat: number | null; lng: number | null },
    b: { lat: number | null; lng: number | null },
  ): number | null => {
    if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
    const R = 6371;
    const rad = (v: number) => (v * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Number((2 * R * Math.asin(Math.sqrt(h))).toFixed(2));
  };

  /** Reservas que colidem com [entrada, saida) — a regra de hotelaria: o dia
   * da saída de um é o dia da entrada do outro, então não conflita. */
  const ocupacoes = async (propertyIds: string[], entrada: string, saida: string) => {
    if (propertyIds.length === 0) return new Map<string, boolean>();
    const { data } = await ctx.supabase
      .from("property_reservations")
      .select("property_id, checkin_date, checkout_date, status")
      .in("property_id", propertyIds)
      .lt("checkin_date", saida)
      .gt("checkout_date", entrada);
    const ocupado = new Map<string, boolean>();
    for (const r of (data ?? []) as Array<{ property_id: string; status: string | null }>) {
      if ((r.status ?? "confirmed") === "cancelled") continue;
      ocupado.set(r.property_id, true);
    }
    return ocupado;
  };

  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

  tools.push({
    name: "check_availability",
    description:
      "Consulta o CALENDÁRIO do imóvel em que o hóspede está e diz se ele está livre em um período. Use para " +
      "'posso ficar mais um dia', 'dá para estender', 'tem disponibilidade em tal data', 'posso sair mais tarde " +
      "no dia X'. Datas no formato AAAA-MM-DD; `saida` é o dia da saída (não conta como noite ocupada). " +
      "NUNCA informe preço a partir daqui — o valor é sempre o do anúncio.",
    parameters: schema(
      {
        entrada: { type: "string", description: "Primeira noite pretendida (AAAA-MM-DD)." },
        saida: { type: "string", description: "Dia da saída (AAAA-MM-DD)." },
      },
      ["entrada", "saida"],
    ),
    execute: async (args) => {
      const entrada = String(args.entrada ?? "");
      const saida = String(args.saida ?? "");
      if (!ISO_DATE.test(entrada) || !ISO_DATE.test(saida) || saida <= entrada) {
        return { erro: "Datas inválidas. Use AAAA-MM-DD, com saída depois da entrada." };
      }

      const ocupado = await ocupacoes([ctx.propertyId], entrada, saida);
      const { data: prop } = await ctx.supabase
        .from("properties")
        .select("name, airbnb_ical_last_sync_at")
        .eq("id", ctx.propertyId)
        .maybeSingle();
      const p = prop as { name: string | null; airbnb_ical_last_sync_at: string | null } | null;
      const sync = p?.airbnb_ical_last_sync_at ?? null;
      const horasDesdeSync = sync
        ? Math.round((Date.now() - new Date(sync).getTime()) / 3_600_000)
        : null;

      const livre = !ocupado.get(ctx.propertyId);
      ctx.collectSource({
        source: "calendario",
        title: `Calendário de ${p?.name ?? "imóvel"}`,
        confidence: horasDesdeSync != null && horasDesdeSync <= 12 ? 0.95 : 0.8,
        content: `${entrada} → ${saida}: ${livre ? "livre" : "ocupado"}`,
      });

      return {
        imovel: p?.name ?? null,
        periodo: { entrada, saida },
        livre,
        sincronizado_em: sync,
        aviso:
          horasDesdeSync != null && horasDesdeSync > 24
            ? "O calendário não sincroniza há mais de um dia — trate como indicação, não como garantia."
            : null,
        observacao:
          "Disponibilidade de calendário. Preço e confirmação da reserva são sempre na plataforma do anúncio.",
      };
    },
  });

  tools.push({
    name: "find_available_stays",
    description:
      "Procura OUTROS imóveis do mesmo anfitrião livres em um período, ordenados por proximidade do imóvel atual. " +
      "Use quando o imóvel do hóspede NÃO estiver livre e ele quiser estender, antecipar ou voltar em outra data — " +
      "e também quando ele perguntar por outra unidade para acompanhantes. Devolve o link do anúncio quando " +
      "cadastrado. NUNCA informe preço: mande o link, quem precifica é a plataforma.",
    parameters: schema(
      {
        entrada: { type: "string", description: "Primeira noite pretendida (AAAA-MM-DD)." },
        saida: { type: "string", description: "Dia da saída (AAAA-MM-DD)." },
        hospedes: {
          type: "number",
          description:
            "Quantas pessoas vão ficar. Opcional — filtra por capacidade quando informado.",
        },
      },
      ["entrada", "saida"],
    ),
    execute: async (args) => {
      const entrada = String(args.entrada ?? "");
      const saida = String(args.saida ?? "");
      if (!ISO_DATE.test(entrada) || !ISO_DATE.test(saida) || saida <= entrada) {
        return { erro: "Datas inválidas. Use AAAA-MM-DD, com saída depois da entrada." };
      }
      const hospedes = typeof args.hospedes === "number" ? args.hospedes : null;

      // Só imóveis DA MESMA CONTA e publicados — nunca concorrente.
      const { data: irmaos } = await ctx.supabase
        .from("properties")
        .select(
          "id, name, city, lat, lng, airbnb_listing_url, airbnb_guest_count, airbnb_bedroom_count",
        )
        .eq("owner_id", ctx.ownerId)
        .eq("published", true);

      type Prop = {
        id: string;
        name: string | null;
        city: string | null;
        lat: number | null;
        lng: number | null;
        airbnb_listing_url: string | null;
        airbnb_guest_count: number | null;
        airbnb_bedroom_count: number | null;
      };
      const lista = ((irmaos ?? []) as Prop[]).filter((x) => x.id !== ctx.propertyId);
      const atual = ((irmaos ?? []) as Prop[]).find((x) => x.id === ctx.propertyId) ?? null;

      const ocupado = await ocupacoes(
        lista.map((x) => x.id),
        entrada,
        saida,
      );

      const livres = lista
        .filter((x) => !ocupado.get(x.id))
        .filter((x) => (hospedes ? (x.airbnb_guest_count ?? 99) >= hospedes : true))
        .map((x) => ({
          imovel: x.name,
          cidade: x.city,
          distancia_km: atual ? distanciaKm(atual, x) : null,
          capacidade: x.airbnb_guest_count,
          quartos: x.airbnb_bedroom_count,
          link_anuncio: x.airbnb_listing_url,
        }))
        .sort((a, b) => (a.distancia_km ?? 999) - (b.distancia_km ?? 999))
        .slice(0, 5);

      ctx.collectSource({
        source: "calendario",
        title: "Disponibilidade na carteira do anfitrião",
        confidence: 0.9,
        content: `${entrada} → ${saida}: ${livres.length} imóvel(is) livre(s)`,
      });

      return {
        periodo: { entrada, saida },
        encontrados: livres.length,
        opcoes: livres,
        observacao:
          livres.length > 0
            ? "Ofereça as opções pelo nome e mande o link quando existir. Nunca cite preço — ele está no anúncio."
            : "Nenhuma unidade livre no período. Aqui vale escalar para o anfitrião.",
        sem_link: livres.some((o) => !o.link_anuncio)
          ? "Alguma unidade livre está sem link de anúncio cadastrado — cite o nome e diga que o anfitrião envia o link."
          : null,
      };
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
        reason: {
          type: "string",
          description: "Resumo em 3ª pessoa do que o hóspede precisa (máx 220 caracteres).",
        },
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
