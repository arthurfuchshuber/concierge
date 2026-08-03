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
      ctx.collectSource({ source: "property", title: "Dados da residência", confidence: confidenceOf("property") });
      return {
        nome: p.name ?? null,
        cidade: p.city ?? null,
        endereco: p.address ?? null,
        como_chegar: p.address_note ?? null,
        checkin: p.checkin_time ?? null,
        checkin_max: p.checkin_time_max ?? null,
        checkout: p.checkout_time ?? null,
        instrucoes_checkin: p.checkin_instructions ?? null,
        instrucoes_checkout: p.checkout_instructions ?? null,
        regras: p.house_rules ?? null,
        wifi_rede: p.wifi_ssid ?? null,
        wifi_senha: mask(p.wifi_password),
        codigo_portao: mask(p.gate_code),
        codigo_fechadura: mask(p.lock_code),
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

      if (proximas.length) ctx.collectSource({ source: "recommendation", title: "Recomendações próximas", confidence: confidenceOf("recommendation") });
      if (cidade.length) ctx.collectSource({ source: "city_reference", title: "Referências da cidade", confidence: confidenceOf("city_reference") });

      return { proximas, cidade };
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
              "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.rating,places.userRatingCount",
            },
            body,
          },
          `agent-places::${body}`,
        );
        if (!res.ok) return { disponivel: false };
        const json = (await res.json()) as {
          places?: Array<{ displayName?: { text?: string }; formattedAddress?: string; rating?: number; userRatingCount?: number }>;
        };
        const lugares = (json.places ?? []).map((p) => ({
          nome: p.displayName?.text ?? "",
          endereco: p.formattedAddress ?? null,
          nota: p.rating ?? null,
          avaliacoes: p.userRatingCount ?? null,
        }));
        if (lugares.length) ctx.collectSource({ source: "maps", title: query, confidence: confidenceOf("maps") });
        return { disponivel: true, lugares };
      } catch (err) {
        console.error("[tool search_places]", err);
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
