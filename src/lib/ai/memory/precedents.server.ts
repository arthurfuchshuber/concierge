/**
 * Repertório de precedentes — gravação e recuperação (ver `precedents.ts`).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson, embedOne } from "../gateway.server";
import {
  SAME_PRECEDENT_SIMILARITY,
  scrubExample,
  selectPrecedents,
  type PrecedentMatch,
  type PrecedentScope,
} from "./precedents";

type Admin = SupabaseClient;

function toMatch(r: Record<string, unknown>): PrecedentMatch {
  return {
    id: String(r.id),
    scope: (r.scope as PrecedentScope) ?? "tenant",
    propertyId: (r.property_id as string) ?? null,
    situation: String(r.situation ?? ""),
    conduct: String(r.conduct ?? ""),
    exampleReply: (r.example_reply as string) ?? null,
    why: (r.why as string) ?? null,
    source: String(r.source ?? ""),
    confidence: Number(r.confidence ?? 0.7),
    successCount: Number(r.success_count ?? 1),
    failureCount: Number(r.failure_count ?? 0),
    similarity: Number(r.similarity ?? 0),
  };
}

async function matchRaw(supabase: Admin, vector: number[], ownerId: string, propertyId: string | null, count: number) {
  const { data, error } = await supabase.rpc("match_ai_precedents" as never, {
    query_embedding: vector as unknown as string,
    _owner_id: ownerId,
    _property_id: propertyId,
    match_count: count,
  } as never);
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, unknown>>).map(toMatch);
}

export async function retrievePrecedents(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  query: string;
}): Promise<PrecedentMatch[]> {
  try {
    const { vector } = await embedOne(params.query.slice(0, 1500));
    if (!vector?.length) return [];
    const picked = selectPrecedents(await matchRaw(params.supabase, vector, params.ownerId, params.propertyId, 8));
    if (picked.length) {
      const now = new Date().toISOString();
      for (const p of picked) {
        void params.supabase
          .from("ai_precedents" as never)
          .update({ last_used_at: now } as never)
          .eq("id", p.id)
          .then(() => undefined);
      }
    }
    return picked;
  } catch (e) {
    console.error("[precedents] recuperação falhou", e);
    return [];
  }
}

type Distilled = {
  generalizable: boolean;
  scope: "tenant" | "property";
  situation: string;
  conduct: string;
  why: string;
};

const DISTILL_PROMPT = `Você transforma um atendimento de hospedagem que DEU CERTO em um PRECEDENTE reutilizável.
Responda só JSON: {"generalizable":boolean,"scope":"tenant"|"property","situation":string,"conduct":string,"why":string}.
- situation: o TIPO de situação, abstrato, sem nomes, códigos, datas, valores ou números específicos do caso (ex.: "Hóspede informa um número de pessoas diferente do registrado na reserva").
- conduct: o que fazer, passo a passo curto, de forma que valha para outro hóspede (ex.: "Conferir a capacidade do imóvel; se couber, apontar a divergência com gentileza e orientar a solicitar o ajuste de hóspedes nos detalhes da reserva na plataforma, sem acionar a equipe").
- why: uma frase sobre por que essa conduta funciona.
- scope "property" só se a conduta depender de algo físico deste imóvel; senão "tenant".
- generalizable=false quando: foi só saudação/agradecimento/resposta factual trivial (Wi-Fi, horário), envolve preço/desconto/exceção decidida caso a caso, dado sensível, ou não há conduta reaproveitável.`;

/** Grava (ou reforça) um precedente a partir de um caso bem-sucedido. */
export async function recordPrecedent(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  guestMessage: string;
  reply: string;
  source: "autonomous_success" | "human_answer";
  sourceRef: string;
}): Promise<{ id: string | null; reinforced: boolean }> {
  const { supabase } = params;
  const { data } = await chatJson<Distilled>("memory", [
    { role: "system", content: DISTILL_PROMPT },
    {
      role: "user",
      content: `Mensagem do hóspede:\n${scrubExample(params.guestMessage)}\n\nResposta que deu certo (${params.source === "human_answer" ? "decidida pela equipe" : "da IA, aceita pelo hóspede"}):\n${scrubExample(params.reply)}`,
    },
  ]);
  if (!data?.generalizable || !data.situation?.trim() || !data.conduct?.trim()) return { id: null, reinforced: false };

  const { vector } = await embedOne(`${data.situation}\n${data.conduct}`);
  if (!vector?.length) return { id: null, reinforced: false };

  const scope: PrecedentScope = data.scope === "property" && params.propertyId ? "property" : "tenant";
  const similar = (await matchRaw(supabase, vector, params.ownerId, params.propertyId, 3)).find(
    (m) => m.similarity >= SAME_PRECEDENT_SIMILARITY && m.scope !== "global",
  );
  if (similar) {
    await supabase
      .from("ai_precedents" as never)
      .update({
        success_count: similar.successCount + 1,
        confidence: Math.min(0.98, similar.confidence + (params.source === "human_answer" ? 0.05 : 0.02)),
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", similar.id);
    return { id: similar.id, reinforced: true };
  }

  const { data: row, error } = await supabase
    .from("ai_precedents" as never)
    .insert({
      scope,
      owner_id: params.ownerId,
      property_id: scope === "property" ? params.propertyId : null,
      situation: data.situation.slice(0, 400),
      conduct: data.conduct.slice(0, 900),
      why: data.why?.slice(0, 300) ?? null,
      example_guest: scrubExample(params.guestMessage),
      example_reply: scrubExample(params.reply),
      source: params.source,
      source_ref: params.sourceRef,
      confidence: params.source === "human_answer" ? 0.85 : 0.72,
      embedding: vector as unknown as string,
    } as never)
    .select("id")
    .maybeSingle();
  if (error) {
    if (!/duplicate/i.test(error.message)) console.error("[precedents] gravação falhou", error.message);
    return { id: null, reinforced: false };
  }
  return { id: (row as { id?: string } | null)?.id ?? null, reinforced: false };
}

/**
 * Fecha o ciclo: ao chegar a próxima mensagem do hóspede, confere se o turno
 * anterior da IA deu certo e, se sim, vira precedente.
 */
export async function learnFromPreviousTurn(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  conversationId: string;
  history: Array<{ role: string; content: string }>;
  currentMessage: string;
  currentSentiment: string | null | undefined;
}): Promise<void> {
  const { previousTurnSucceeded } = await import("./precedents");
  const h = params.history;
  const lastAi = [...h].reverse().findIndex((m) => m.role === "assistant");
  if (lastAi < 0) return;
  const aiIdx = h.length - 1 - lastAi;
  const guestBefore = h
    .slice(0, aiIdx)
    .reverse()
    .find((m) => m.role === "user");
  if (!guestBefore || guestBefore.content.trim().length < 12) return;

  const { data: log } = await params.supabase
    .from("ai_agent_logs")
    .select("id, escalation_triggered, validation, confidence, created_at")
    .eq("conversation_id", params.conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!log) return;
  if (Date.now() - Date.parse(log.created_at as string) > 3 * 86400000) return;
  const validation = (log.validation ?? {}) as { approved?: boolean };
  const ok = previousTurnSucceeded({
    previousEscalated: !!log.escalation_triggered,
    previousApproved: validation.approved === true,
    previousConfidence: Number(log.confidence ?? 0),
    currentSentiment: params.currentSentiment,
    currentMessage: params.currentMessage,
  });
  if (!ok) return;
  await recordPrecedent({
    supabase: params.supabase,
    ownerId: params.ownerId,
    propertyId: params.propertyId,
    guestMessage: guestBefore.content,
    reply: h[aiIdx].content,
    source: "autonomous_success",
    sourceRef: String(log.id),
  });
}
