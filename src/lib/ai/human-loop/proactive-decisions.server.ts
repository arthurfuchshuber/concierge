/**
 * COPILOTO PROATIVO (19/10/2026, pedido do anfitrião).
 *
 * A cada mensagem nova (hóspede ou equipe), a IA lê a conversa e decide se
 * existe uma AÇÃO no app que provavelmente precisa acontecer, mas sobre a qual
 * ela não tem certeza absoluta (ex.: a equipe entregou as chaves quando a
 * hóspede foi deixar as malas → dar check-in?). Se existir, ela cria sozinha
 * a pergunta e as opções de botão — cada opção pode carregar uma ação que o
 * sistema executa no clique. Nada é executado sem o clique da equipe, e toda
 * decisão pode ser desfeita.
 *
 * Também serve para "instruções rápidas": dúvidas pequenas viram uma pergunta
 * de 1 toque, acelerando o aprendizado sem cansar a equipe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DECISION_ACTIONS, type DecisionAction, type DecisionSpec } from "./decision-options";

type Proposal = {
  shouldAsk?: boolean;
  question?: string;
  kind?: "operational" | "fact";
  options?: Array<{ label?: string; action?: string }>;
};

const SYSTEM = `Você é o copiloto operacional de uma equipe de hospedagem.
Leia a conversa e o estado da estadia. Decida se existe uma AÇÃO no sistema que provavelmente deveria acontecer agora, mas sobre a qual você NÃO tem certeza absoluta — ou uma instrução rápida da equipe que ajudaria a atender melhor.
Ações disponíveis no sistema:
- "checkin_done": registrar o check-in do hóspede como concluído.
- "checkout_done": registrar o check-out como concluído (libera a limpeza).
- "none": só registrar a decisão, sem ação no sistema.
Regras:
- Pergunte só quando houver indício concreto na conversa (ex.: chaves entregues, hóspede já dentro, hóspede já saiu, pedido que exige decisão da equipe).
- Não pergunte sobre algo que o estado da estadia mostra que já foi feito.
- Pergunta curta, em português, citando o fato observado. 2 a 3 opções curtas (até 6 palavras), mutuamente exclusivas, cada uma com sua ação.
- kind "operational" para decisões pontuais desta estadia; "fact" só para informação permanente do imóvel.
- Na dúvida se vale perguntar, responda shouldAsk false.
Responda só JSON: {"shouldAsk": boolean, "question": string, "kind": "operational"|"fact", "options": [{"label": string, "action": string}]}`;

export async function proposeProactiveDecision(
  admin: SupabaseClient,
  p: { conversationId: string; trigger: "guest" | "staff" },
): Promise<string | null> {
  try {
    const { data: conv } = await admin
      .from("property_chat_conversations")
      .select("id, property_id, reservation_id, guest_name")
      .eq("id", p.conversationId)
      .maybeSingle();
    const c = conv as { id: string; property_id: string | null; reservation_id: string | null; guest_name: string | null } | null;
    if (!c?.property_id) return null;

    // Uma pergunta por vez: se já há pendência, não empilha outra.
    const { data: pend } = await admin
      .from("ai_human_escalations")
      .select("id")
      .eq("conversation_id", c.id)
      .eq("status", "pending")
      .limit(1);
    if (pend?.length) return null;

    const [{ data: prop }, { data: msgs }, arrival] = await Promise.all([
      admin.from("properties").select("owner_id, name, checkin_time, checkout_time").eq("id", c.property_id).maybeSingle(),
      admin
        .from("property_chat_messages")
        .select("sender_type, content, created_at")
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: false })
        .limit(14),
      c.reservation_id
        ? admin.from("guest_arrival_status").select("kind, status, done_at").eq("reservation_id", c.reservation_id)
        : Promise.resolve({ data: null }),
    ]);
    const pr = prop as { owner_id: string; name: string | null; checkin_time: string | null; checkout_time: string | null } | null;
    if (!pr?.owner_id) return null;

    const rows = ((arrival as { data: unknown }).data ?? []) as Array<{ kind: string; status: string; done_at: string | null }>;
    const done = (k: string) => rows.some((r) => r.kind === k && (r.status === "done" || !!r.done_at));
    const state = c.reservation_id
      ? `Check-in ${done("checkin") ? "JÁ registrado" : "pendente"}; check-out ${done("checkout") ? "JÁ registrado" : "pendente"}.`
      : "Conversa sem reserva vinculada (ações de check-in/out indisponíveis).";

    const transcript = ((msgs ?? []) as Array<{ sender_type: string; content: string | null; created_at: string }>)
      .reverse()
      .map((m) => `[${m.sender_type === "guest" ? "Hóspede" : m.sender_type === "ai" ? "IA" : m.sender_type === "human" ? "Equipe" : "Sistema"}] ${String(m.content ?? "").slice(0, 400)}`)
      .join("\n");

    const { chatJson } = await import("../gateway.server");
    const { data } = await chatJson<Proposal>("validation", [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content:
          `Imóvel: ${pr.name ?? ""} (check-in ${pr.checkin_time ?? "?"}, check-out ${pr.checkout_time ?? "?"})\n` +
          `Hóspede: ${c.guest_name ?? "?"}\nEstado: ${state}\nÚltima mensagem veio de: ${p.trigger === "guest" ? "hóspede" : "equipe"}\n\nConversa:\n${transcript}`,
      },
    ]);
    const spec = sanitizeProposal(data, { hasReservation: !!c.reservation_id, checkinDone: done("checkin"), checkoutDone: done("checkout") });
    if (!spec) return null;

    const { data: ins, error } = await admin
      .from("ai_human_escalations")
      .insert({
        owner_id: pr.owner_id,
        tenant_id: pr.owner_id,
        property_id: c.property_id,
        conversation_id: c.id,
        guest_name: c.guest_name,
        agent_type: "concierge",
        trigger: "low_confidence",
        reason: "proactive_decision",
        question_to_human: spec.question,
        status: "pending",
        context_snapshot: { decision: spec.decision, proactive: true, reservation_id: c.reservation_id } as never,
      } as never)
      .select("id")
      .single();
    if (error) throw error;
    return (ins as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.error("[proactive] falhou", (e as Error)?.message);
    return null;
  }
}

/** Valida a proposta do modelo: só ações conhecidas e aplicáveis. Exportado para teste. */
export function sanitizeProposal(
  data: Proposal | null | undefined,
  st: { hasReservation: boolean; checkinDone: boolean; checkoutDone: boolean },
): { question: string; decision: DecisionSpec } | null {
  if (!data?.shouldAsk) return null;
  const question = String(data.question ?? "").trim().slice(0, 400);
  if (!question) return null;
  const options: string[] = [];
  const actions: Record<string, DecisionAction> = {};
  for (const o of data.options ?? []) {
    const label = String(o?.label ?? "").trim().slice(0, 60);
    if (!label || options.includes(label)) continue;
    let action = (DECISION_ACTIONS as readonly string[]).includes(String(o?.action)) ? (o!.action as DecisionAction) : "none";
    if (action !== "none" && !st.hasReservation) action = "none";
    if (action === "checkin_done" && st.checkinDone) continue;
    if (action === "checkout_done" && st.checkoutDone) continue;
    options.push(label);
    actions[label] = action;
  }
  if (options.length < 2) return null;
  const kind = data.kind === "fact" ? "fact" : "operational";
  return { question, decision: { kind, options: options.slice(0, 3), actions } };
}
