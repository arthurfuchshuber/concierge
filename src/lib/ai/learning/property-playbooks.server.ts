/**
 * CÉREBRO CONTÍNUO — lado servidor (17/10/2026).
 *
 * Aprende com:
 *  · respostas humanas no chat do imóvel (via `learnFromHumanAnswer`);
 *  · mensagens da IA que o anfitrião APAGA ou EDITA (`recordHostCorrection` +
 *    `sweepHostCorrections`). Se a IA entende o erro, aprende sozinha; se não
 *    entende, PERGUNTA ao anfitrião o que errou e como deveria ter feito.
 * Cada aprendizado refina o playbook do imóvel (versão +1) em vez de criar
 * duplicatas. Nunca lança: aprender jamais pode quebrar o atendimento.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chatJson } from "../gateway.server";
import {
  correctionQuestion,
  playbookStatusFor,
  sanitizeDraft,
  type PlaybookDraft,
  type PropertyPlaybook,
} from "./property-playbooks";

type Admin = SupabaseClient;

const SYSTEM = `Você mantém os PLAYBOOKS DE UM IMÓVEL de hospedagem por temporada, aprendendo com a equipe humana.
Recebe: o contexto do hóspede, o que a equipe respondeu/fez (ou a correção feita sobre uma mensagem da IA) e a lista de playbooks que o imóvel JÁ tem.

Regras:
- Se o aprendizado refina um playbook existente, devolva o MESMO "topic" dele e o playbook COMPLETO atualizado (todos os passos, já fundindo o que havia com o novo). Senão, crie um topic novo, curto, em kebab-case.
- Passos curtos, em português, na ordem em que a IA deve agir; a IA conversa com o hóspede e resolve sozinha sempre que possível.
- "triggers": 3 a 8 palavras/expressões que o hóspede usaria para trazer este assunto.
- "avoid": o que a equipe corrigiu (tom, promessa, informação errada) em forma de instrução.
- Fatos específicos do imóvel valem aqui (esse é o escopo). Nunca inclua senha, código de acesso, documento, cartão, valores em reais nem dado de terceiros.
- Exceção pontual (valia só para aquele hóspede/dia) NÃO vira playbook: shouldLearn=false.
- Se a conversa não traz conhecimento reutilizável (cumprimento, "ok", agradecimento), shouldLearn=false.
- Se a mensagem da IA foi corrigida e você NÃO consegue concluir com segurança o que estava errado, canExplain=false.
Responda APENAS JSON:
{"shouldLearn":true,"canExplain":true,"topic":"...","title":"...","triggers":["..."],"situation":"quando acontece","steps":["..."],"avoid":["..."],"whatWasWrong":null,"risk":"low|sensitive","confidence":0..1}`;

export async function loadPropertyPlaybooks(supabase: Admin, propertyId: string): Promise<PropertyPlaybook[]> {
  try {
    const { data } = await supabase
      .from("ai_property_playbooks")
      .select("id, topic, title, triggers, situation, steps, avoid, version, status")
      .eq("property_id", propertyId)
      .in("status", ["active", "draft"])
      .order("updated_at", { ascending: false })
      .limit(60);
    return ((data ?? []) as unknown as PropertyPlaybook[]).map((p) => ({
      ...p,
      triggers: p.triggers ?? [],
      steps: p.steps ?? [],
      avoid: p.avoid ?? [],
    }));
  } catch (e) {
    console.error("[playbooks] leitura falhou", e);
    return [];
  }
}

export async function markPlaybooksUsed(supabase: Admin, ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      const { data } = await supabase.from("ai_property_playbooks").select("uses").eq("id", id).maybeSingle();
      await supabase
        .from("ai_property_playbooks")
        .update({ uses: Number((data as { uses?: number } | null)?.uses ?? 0) + 1 })
        .eq("id", id);
    } catch {
      /* contador é enriquecimento */
    }
  }
}

async function upsertPlaybook(
  supabase: Admin,
  p: { ownerId: string; propertyId: string; draft: PlaybookDraft; source: Record<string, unknown>; correction?: boolean },
): Promise<void> {
  const { data: cur } = await supabase
    .from("ai_property_playbooks")
    .select("id, version, status, sources, corrections")
    .eq("property_id", p.propertyId)
    .eq("topic", p.draft.topic)
    .maybeSingle();
  const row = cur as { id: string; version: number; status: string; sources: unknown[]; corrections: number } | null;
  const status = playbookStatusFor(p.draft);
  const sources = [...(Array.isArray(row?.sources) ? row!.sources : []), { ...p.source, at: new Date().toISOString() }].slice(-20);
  const body = {
    title: p.draft.title,
    triggers: p.draft.triggers,
    situation: p.draft.situation,
    steps: p.draft.steps,
    avoid: p.draft.avoid,
    confidence: p.draft.confidence,
    sources,
    updated_at: new Date().toISOString(),
  };
  if (row) {
    await supabase
      .from("ai_property_playbooks")
      .update({
        ...body,
        version: row.version + 1,
        // Um playbook que já estava ativo não volta a rascunho por um refinamento sensível: fica como estava.
        status: row.status === "active" ? "active" : status,
        corrections: (row.corrections ?? 0) + (p.correction ? 1 : 0),
      })
      .eq("id", row.id);
  } else {
    await supabase.from("ai_property_playbooks").insert({
      owner_id: p.ownerId,
      property_id: p.propertyId,
      topic: p.draft.topic,
      status,
      corrections: p.correction ? 1 : 0,
      ...body,
    });
  }
}

export type LearnOutcome = { learned: boolean; canExplain: boolean };

/** Destila um intercâmbio (hóspede → resposta/correção da equipe) e refina o playbook do imóvel. */
export async function learnPlaybookFromExchange(params: {
  supabase: Admin;
  ownerId: string;
  propertyId: string | null;
  propertyName?: string | null;
  conversationId?: string | null;
  guestContext: string;
  humanText: string;
  /** Resposta original da IA que a equipe corrigiu (apagou/editou), se houver. */
  aiDraft?: string | null;
  kind: "human_reply" | "correction" | "escalation_answer";
}): Promise<LearnOutcome> {
  if (!params.propertyId) return { learned: false, canExplain: true };
  try {
    const existing = await loadPropertyPlaybooks(params.supabase, params.propertyId);
    const list = existing
      .slice(0, 25)
      .map((p) => `- topic=${p.topic} | ${p.title} | passos: ${p.steps.join(" > ")}`)
      .join("\n");
    const { data } = await chatJson<Partial<PlaybookDraft>>("validation", [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Imóvel: ${params.propertyName ?? params.propertyId}\n` +
          `Playbooks atuais:\n${list || "(nenhum ainda)"}\n\n` +
          `Tipo: ${params.kind}\n` +
          `Contexto do hóspede:\n${params.guestContext.slice(0, 1500)}\n` +
          (params.aiDraft ? `Mensagem da IA que foi corrigida:\n${params.aiDraft.slice(0, 800)}\n` : "") +
          `Resposta/correção da equipe:\n${params.humanText.slice(0, 1500)}`,
      },
    ]);
    const draft = sanitizeDraft(data);
    if (!draft) return { learned: false, canExplain: data?.canExplain !== false };
    if (!draft.canExplain) return { learned: false, canExplain: false };
    await upsertPlaybook(params.supabase, {
      ownerId: params.ownerId,
      propertyId: params.propertyId,
      draft,
      correction: params.kind === "correction",
      source: { conversation: params.conversationId ?? null, kind: params.kind },
    });
    return { learned: true, canExplain: true };
  } catch (e) {
    console.error("[playbooks] aprendizado falhou", e);
    return { learned: false, canExplain: true };
  }
}

/**
 * O anfitrião apagou/editou uma mensagem da IA: guarda o evento ANTES de a
 * mensagem mudar. A varredura decide depois (precisa esperar a mensagem que
 * substitui a apagada).
 */
export async function recordHostCorrection(params: {
  supabase: Admin;
  conversationId: string;
  messageId: string;
  kind: "deleted" | "edited";
  replacement?: string | null;
}): Promise<void> {
  try {
    const { data: msg } = await params.supabase
      .from("property_chat_messages")
      .select("id, content, sender_type, created_at, conversation_id")
      .eq("id", params.messageId)
      .maybeSingle();
    const m = msg as { content: string; sender_type: string; created_at: string; conversation_id: string } | null;
    if (!m || m.sender_type !== "ai" || m.conversation_id !== params.conversationId) return;
    if (params.kind === "edited" && (params.replacement ?? "").trim() === (m.content ?? "").trim()) return;
    const { data: conv } = await params.supabase
      .from("property_chat_conversations")
      .select("property_id")
      .eq("id", params.conversationId)
      .maybeSingle();
    const propertyId = (conv as { property_id?: string } | null)?.property_id;
    if (!propertyId) return;
    const { data: prop } = await params.supabase.from("properties").select("owner_id").eq("id", propertyId).maybeSingle();
    const ownerId = (prop as { owner_id?: string } | null)?.owner_id;
    if (!ownerId) return;
    const { data: ctx } = await params.supabase
      .from("property_chat_messages")
      .select("role, content")
      .eq("conversation_id", params.conversationId)
      .lt("created_at", m.created_at)
      .eq("is_internal_note", false)
      .order("created_at", { ascending: false })
      .limit(5);
    const guestContext = ((ctx ?? []) as Array<{ role: string; content: string }>)
      .reverse()
      .map((x) => `${x.role === "user" ? "Hóspede" : "Atendimento"}: ${String(x.content ?? "").slice(0, 400)}`)
      .join("\n");
    await params.supabase.from("ai_host_corrections").insert({
      owner_id: ownerId,
      property_id: propertyId,
      conversation_id: params.conversationId,
      kind: params.kind,
      ai_content: m.content ?? "",
      guest_context: guestContext,
      replacement_content: params.kind === "edited" ? (params.replacement ?? null) : null,
    });
  } catch (e) {
    console.error("[playbooks] registro de correção falhou", e);
  }
}

export const CORRECTION_WAIT_MS = 2 * 60 * 1000;
export const CORRECTION_GIVE_UP_MS = 15 * 60 * 1000;

/** Processa correções do anfitrião: aprende sozinha ou pergunta o que errou. */
export async function sweepHostCorrections(admin: Admin, limit = 10): Promise<number> {
  const now = Date.now();
  const { data: rows } = await admin
    .from("ai_host_corrections")
    .select("id, owner_id, property_id, conversation_id, kind, ai_content, guest_context, replacement_content, created_at")
    .eq("status", "pending")
    .lte("created_at", new Date(now - CORRECTION_WAIT_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);
  let done = 0;
  for (const r of (rows ?? []) as Array<{
    id: string;
    owner_id: string;
    property_id: string;
    conversation_id: string;
    kind: "deleted" | "edited";
    ai_content: string;
    guest_context: string | null;
    replacement_content: string | null;
    created_at: string;
  }>) {
    try {
      const { data: claimed } = await admin
        .from("ai_host_corrections")
        .update({ status: "processing" })
        .eq("id", r.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      let replacement = r.replacement_content;
      if (!replacement && r.kind === "deleted") {
        const { data: next } = await admin
          .from("property_chat_messages")
          .select("content")
          .eq("conversation_id", r.conversation_id)
          .eq("sender_type", "human")
          .eq("is_internal_note", false)
          .gt("created_at", r.created_at)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        replacement = ((next as { content?: string } | null)?.content ?? "").trim() || null;
      }
      const age = now - new Date(r.created_at).getTime();
      if (!replacement && r.kind === "deleted" && age < CORRECTION_GIVE_UP_MS) {
        await admin.from("ai_host_corrections").update({ status: "pending" }).eq("id", r.id);
        continue;
      }

      const { data: prop } = await admin.from("properties").select("name").eq("id", r.property_id).maybeSingle();
      let out: LearnOutcome = { learned: false, canExplain: false };
      if (replacement) {
        out = await learnPlaybookFromExchange({
          supabase: admin,
          ownerId: r.owner_id,
          propertyId: r.property_id,
          propertyName: (prop as { name?: string } | null)?.name ?? null,
          conversationId: r.conversation_id,
          guestContext: r.guest_context ?? "",
          aiDraft: r.ai_content,
          humanText: replacement,
          kind: "correction",
        });
      }
      if (out.learned) {
        await admin
          .from("ai_host_corrections")
          .update({ status: "learned", replacement_content: replacement, processed_at: new Date().toISOString() })
          .eq("id", r.id);
        done += 1;
        continue;
      }
      // Não sabe como aprender: pergunta ao anfitrião o que errou e como acertar.
      const { askHumanSupervisor } = await import("../human-loop/escalations.server");
      const escId = await askHumanSupervisor({
        supabase: admin,
        ownerId: r.owner_id,
        propertyId: r.property_id,
        // Sem conversation_id de propósito: a resposta do anfitrião é uma lição,
        // nunca uma "decisão humana" a ser entregue ao hóspede daquela conversa.
        conversationId: null,
        agent: "generalist",
        trigger: "low_confidence",
        reason: "Aprendizado: o anfitrião corrigiu uma resposta da IA e ela não entendeu o motivo.",
        question: correctionQuestion({ kind: r.kind, aiContent: r.ai_content, replacement }),
        confidence: 0.3,
        contextSnapshot: { correctionId: r.id, kind: "host_correction", sourceConversationId: r.conversation_id, guestContext: r.guest_context },
      });
      await admin
        .from("ai_host_corrections")
        .update({
          status: "asked",
          replacement_content: replacement,
          escalation_id: escId,
          processed_at: new Date().toISOString(),
        })
        .eq("id", r.id);
      done += 1;
    } catch (e) {
      console.error("[playbooks] correção falhou", r.id, e);
      await admin.from("ai_host_corrections").update({ status: "pending" }).eq("id", r.id);
    }
  }
  return done;
}
