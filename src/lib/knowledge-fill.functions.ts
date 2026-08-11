import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Preenchimento guiado a partir de um escalonamento da IA.
 *
 * A IA analisa o motivo do escalonamento + a última pergunta do hóspede e
 * sugere ONDE a informação faltante deve ser guardada e COMO redigi-la.
 * Depois de salvar, a IA responde automaticamente ao hóspede usando o que
 * acabou de ser cadastrado.
 */

export const KNOWLEDGE_TARGETS = {
  checkin_instructions: "Instruções de chegada (check-in)",
  checkout_instructions: "Instruções de saída (check-out)",
  house_rules: "Regras do espaço",
  address_note: "Observação sobre o endereço / como chegar",
  manual: "Manual da casa (novo item)",
  faq: "Perguntas frequentes (nova pergunta)",
  property_detail: "Detalhamento do Imóvel (base interna da IA)",
} as const;

export type KnowledgeTarget = keyof typeof KNOWLEDGE_TARGETS;

const TARGET_KEYS = Object.keys(KNOWLEDGE_TARGETS) as [KnowledgeTarget, ...KnowledgeTarget[]];

async function loadConversation(userId: string, conversationId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conv } = await supabaseAdmin
    .from("property_chat_conversations")
    .select("id, property_id, handoff_reason, guest_name, guest_session_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) throw new Error("Conversa não encontrada.");

  const { data: canAccess } = await supabaseAdmin.rpc("user_can_access_property", {
    _user_id: userId,
    _property_id: conv.property_id as string,
  });
  if (!canAccess) throw new Error("Você não tem acesso a esta conversa.");

  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("*")
    .eq("id", conv.property_id as string)
    .maybeSingle();
  if (!prop) throw new Error("Propriedade não encontrada.");

  const { data: msgs } = await supabaseAdmin
    .from("property_chat_messages")
    .select("role, content, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(20);
  const history = (msgs ?? []).slice().reverse();
  const lastGuest = [...(msgs ?? [])].find((m) => m.role === "user")?.content ?? "";

  return { supabaseAdmin, conv, prop, history, lastGuest };
}

export const suggestKnowledgeFill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ conversationId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { conv, prop, lastGuest } = await loadConversation(context.userId, data.conversationId);
    const { chatJson } = await import("@/lib/ai/gateway.server");

    const p = prop as Record<string, unknown>;
    const snapshot = [
      `Instruções de chegada atuais: ${p.checkin_instructions || "(vazio)"}`,
      `Instruções de saída atuais: ${p.checkout_instructions || "(vazio)"}`,
      `Regras do espaço atuais: ${p.house_rules || "(vazio)"}`,
      `Observação do endereço atual: ${p.address_note || "(vazio)"}`,
    ].join("\n");

    const { data: out } = await chatJson<{
      target: string;
      title: string;
      content: string;
      rationale: string;
    }>("internal", [
      {
        role: "system",
        content: `Você ajuda um anfitrião a completar a base de conhecimento de uma hospedagem.
Receberá o motivo pelo qual a IA não conseguiu responder e a pergunta do hóspede.
Escolha o MELHOR lugar para guardar a informação faltante entre estas chaves:
${Object.entries(KNOWLEDGE_TARGETS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Responda APENAS JSON: {"target":"<chave>","title":"<título curto ou vazio>","content":"<texto pronto para salvar, em português, redigido para o hóspede, com lacunas explícitas entre colchetes quando você não souber o dado>","rationale":"<uma frase explicando a escolha>"}
Nunca invente dados concretos (códigos, endereços, nomes): use [preencher] no lugar.`,
      },
      {
        role: "user",
        content: `Motivo do escalonamento: ${conv.handoff_reason ?? "(não informado)"}
Pergunta do hóspede: ${lastGuest}

Conteúdo já cadastrado:
${snapshot}`,
      },
    ]);

    const target = (out?.target && (Object.keys(KNOWLEDGE_TARGETS) as string[]).includes(out.target)
      ? out.target
      : "property_detail") as KnowledgeTarget;

    return {
      target,
      targetLabel: KNOWLEDGE_TARGETS[target],
      title: out?.title ?? "",
      content: out?.content ?? "",
      rationale: out?.rationale ?? "",
      question: lastGuest,
      currentValue:
        target === "checkin_instructions" || target === "checkout_instructions" || target === "house_rules" || target === "address_note"
          ? String(p[target] ?? "")
          : "",
      targets: Object.entries(KNOWLEDGE_TARGETS).map(([value, label]) => ({ value, label })),
    };
  });

export const applyKnowledgeFill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        conversationId: z.string().uuid(),
        target: z.enum(TARGET_KEYS),
        title: z.string().max(200).optional().nullable(),
        content: z.string().trim().min(3).max(8000),
        mode: z.enum(["append", "replace"]).default("append"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin, conv, prop, history, lastGuest } = await loadConversation(
      context.userId,
      data.conversationId,
    );
    const propertyId = conv.property_id as string;
    const p = prop as Record<string, unknown>;
    const text = data.content.trim();
    const title = data.title?.trim() || null;

    if (["checkin_instructions", "checkout_instructions", "house_rules", "address_note"].includes(data.target)) {
      const current = String(p[data.target] ?? "").trim();
      const next = data.mode === "replace" || !current ? text : `${current}\n${text}`;
      const { error } = await supabaseAdmin.from("properties").update({ [data.target]: next }).eq("id", propertyId);
      if (error) throw new Error(error.message);
    } else if (data.target === "manual") {
      const { error } = await supabaseAdmin.from("property_manual_items").insert({
        property_id: propertyId,
        title: title ?? "Informação importante",
        description: null,
        body: text,
      });
      if (error) throw new Error(error.message);
    } else if (data.target === "faq") {
      const { error } = await supabaseAdmin.from("property_faqs").insert({
        property_id: propertyId,
        question: title ?? lastGuest.slice(0, 160) || "Dúvida do hóspede",
        answer: text,
      });
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("property_details").insert({
        property_id: propertyId,
        owner_id: p.owner_id as string,
        title,
        content: text,
        source: "text",
      });
      if (error) throw new Error(error.message);
    }

    // Reindexa para a IA enxergar a informação nova imediatamente.
    try {
      const { reindexProperty } = await import("@/lib/ai/indexing.server");
      await reindexProperty(supabaseAdmin, propertyId);
    } catch (e) {
      console.error("[knowledge-fill] reindex falhou", e);
    }

    // Devolve a conversa para a IA e pede que ela responda com o novo dado.
    await supabaseAdmin
      .from("property_chat_conversations")
      .update({ status: "ai", ai_paused: false, handoff_reason: null, assigned_to: null })
      .eq("id", data.conversationId);

    let reply = "";
    if (lastGuest) {
      try {
        const { runHospitalityAgent } = await import("@/lib/ai/orchestrator.server");
        const { data: freshProp } = await supabaseAdmin.from("properties").select("*").eq("id", propertyId).maybeSingle();
        const result = await runHospitalityAgent({
          supabase: supabaseAdmin as never,
          property: (freshProp ?? prop) as unknown as Record<string, unknown>,
          conversationId: data.conversationId,
          sessionId: String(conv.guest_session_id ?? "internal"),
          guestName: (conv.guest_name as string) ?? null,
          message: lastGuest,
          history: history.map((m) => ({ role: String(m.role), content: String(m.content ?? "") })),
          explorationMode: false,
          surface: "guide_chat",
        });
        reply = (result.reply ?? "").trim();
      } catch (e) {
        console.error("[knowledge-fill] resposta automática falhou", e);
      }
    }

    if (reply) {
      await supabaseAdmin.from("property_chat_messages").insert({
        conversation_id: data.conversationId,
        role: "assistant",
        content: reply,
        sender_type: "ai",
      });
      await supabaseAdmin
        .from("property_chat_conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", data.conversationId);
    }

    return { ok: true, reply };
  });
