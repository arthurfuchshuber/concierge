/**
 * Memória inteligente por hóspede + resumo automático + análise de sentimento.
 * Gera contexto permanente reutilizado nas próximas conversas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson, EMPTY_USAGE, mergeUsage, type Usage } from "./gateway.server";

type Admin = SupabaseClient;

export type GuestMemory = {
  guestKey: string;
  guestName: string | null;
  language: string | null;
  summary: string | null;
  preferences: Record<string, unknown>;
};

/** Código de reserva normalizado (maiúsculo, só letras/números). */
export function normalizeReservationCode(code?: string | null): string | null {
  const c = String(code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 5 ? c : null;
}

/** Extrai o código de um dossiê de reserva ("Código da reserva: HMXXXX"). */
export function reservationCodeFromDossier(dossier?: string | null): string | null {
  const m = String(dossier ?? "").match(/c[oó]digo(?: da reserva| de confirma[cç][aã]o)?\s*[:=-]\s*([A-Za-z0-9-]{5,})/i);
  return normalizeReservationCode(m?.[1] ?? null);
}

/**
 * MEMÓRIA POR RESERVA (17/10/2026, decisão do anfitrião): toda conversa agora
 * tem código de reserva, então a memória pertence à RESERVA — não ao nome nem
 * ao telefone. Dois hóspedes com o mesmo nome em estadias diferentes deixam de
 * se misturar; quem escreve por outro número ou canal na mesma reserva
 * encontra a mesma memória. Sem código (ex.: visitante da vitrine), mantém a
 * chave antiga por nome/sessão.
 */
export function guestKeyOf(sessionId: string, guestName?: string | null, reservationCode?: string | null): string {
  const code = normalizeReservationCode(reservationCode);
  if (code) return `res:${code}`;
  const name = (guestName ?? "").trim().toLowerCase();
  return name ? `name:${name}` : `session:${sessionId}`;
}

/** Lê a memória da reserva; se ainda não existir, aproveita a antiga por nome/sessão. */
export async function loadGuestMemoryWithFallback(
  supabase: Admin,
  propertyId: string,
  guestKey: string,
  legacyKey: string,
): Promise<GuestMemory | null> {
  const mem = await loadGuestMemory(supabase, propertyId, guestKey);
  if (mem || guestKey === legacyKey) return mem;
  return loadGuestMemory(supabase, propertyId, legacyKey);
}

export async function loadGuestMemory(
  supabase: Admin,
  propertyId: string,
  guestKey: string,
): Promise<GuestMemory | null> {
  const { data } = await supabase
    .from("ai_guest_memory")
    .select("guest_key, guest_name, language, summary, preferences")
    .eq("property_id", propertyId)
    .eq("guest_key", guestKey)
    .maybeSingle();
  if (!data) return null;
  return {
    guestKey: String(data.guest_key),
    guestName: (data.guest_name as string) ?? null,
    language: (data.language as string) ?? null,
    summary: (data.summary as string) ?? null,
    preferences: (data.preferences as Record<string, unknown>) ?? {},
  };
}

/**
 * Atualiza a memória do hóspede a partir da conversa (executa em background,
 * nunca bloqueia a resposta).
 */
export async function updateGuestMemory(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string;
  guestKey: string;
  guestName: string | null;
  language: string;
  previous: GuestMemory | null;
  transcript: Array<{ role: string; content: string }>;
}): Promise<Usage> {
  const { supabase } = params;
  try {
    const transcript = params.transcript
      .slice(-12)
      .map((m) => `${m.role === "user" ? "Hóspede" : "IA"}: ${m.content}`)
      .join("\n");

    const { data, usage } = await chatJson<{ summary?: string; preferences?: Record<string, unknown> }>("memory", [
      {
        role: "system",
        content:
          "Você mantém a memória permanente de um hóspede. Atualize o resumo (máx 600 caracteres) e as " +
          "preferências estáveis (idioma, gostos, restrições, solicitações recorrentes, perfil da viagem). " +
          "Ignore detalhes efêmeros. " +
          'Responda APENAS JSON: {"summary":"...","preferences":{...}}',
      },
      {
        role: "user",
        content:
          `Memória anterior: ${params.previous?.summary ?? "(nenhuma)"}\n` +
          `Preferências anteriores: ${JSON.stringify(params.previous?.preferences ?? {})}\n\n` +
          `Conversa recente:\n${transcript}`,
      },
    ]);

    if (!data) return usage;

    await supabase.from("ai_guest_memory").upsert(
      {
        owner_id: params.ownerId,
        property_id: params.propertyId,
        guest_key: params.guestKey,
        guest_name: params.guestName,
        language: params.language,
        summary: (data.summary ?? params.previous?.summary ?? "").slice(0, 1200),
        preferences: (data.preferences ?? params.previous?.preferences ?? {}) as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "property_id,guest_key" },
    );

    return usage;
  } catch (err) {
    console.error("[ai-memory] falhou", err);
    return EMPTY_USAGE;
  }
}

/** Resumo automático + sentimento ao final de uma conversa. */
export async function summarizeConversation(params: {
  supabase: Admin;
  conversationId: string;
  ownerId: string | null;
  propertyId: string | null;
  transcript: Array<{ role: string; content: string }>;
  language?: string;
}): Promise<Usage> {
  const { supabase } = params;
  if (!params.transcript.length) return EMPTY_USAGE;
  try {
    const text = params.transcript
      .slice(-40)
      .map((m) => `${m.role === "user" ? "Hóspede" : "Atendimento"}: ${m.content}`)
      .join("\n");

    const { data, usage } = await chatJson<{ summary?: string; sentiment?: string; risk?: string }>("summary", [
      {
        role: "system",
        content:
          "Resuma o atendimento para memória interna (máx 700 caracteres), em português. Identifique o " +
          "sentimento geral (positivo|neutro|negativo) e o risco de avaliação negativa (baixo|medio|alto). " +
          'Responda APENAS JSON: {"summary":"...","sentiment":"...","risk":"..."}',
      },
      { role: "user", content: text },
    ]);

    if (!data) return usage;

    await supabase.from("ai_conversation_summaries").upsert({
      conversation_id: params.conversationId,
      owner_id: params.ownerId,
      property_id: params.propertyId,
      summary: (data.summary ?? "").slice(0, 2000),
      sentiment: data.sentiment ?? null,
      risk: data.risk ?? null,
      language: params.language ?? null,
      updated_at: new Date().toISOString(),
    });

    return usage;
  } catch (err) {
    console.error("[ai-summary] falhou", err);
    return EMPTY_USAGE;
  }
}

/** Análise de sentimento isolada (usada para alertas de risco). */
export async function analyzeSentiment(message: string): Promise<{
  sentiment: string;
  risk: string;
  usage: Usage;
}> {
  try {
    const { data, usage } = await chatJson<{ sentiment?: string; risk?: string }>("sentiment", [
      {
        role: "system",
        content:
          "Classifique a mensagem do hóspede. Responda APENAS JSON: " +
          '{"sentiment":"positivo|neutro|negativo","risk":"baixo|medio|alto"} — risk = risco de avaliação negativa.',
      },
      { role: "user", content: message },
    ]);
    return { sentiment: data?.sentiment ?? "neutro", risk: data?.risk ?? "baixo", usage: mergeUsage(EMPTY_USAGE, usage) };
  } catch {
    return { sentiment: "neutro", risk: "baixo", usage: EMPTY_USAGE };
  }
}
