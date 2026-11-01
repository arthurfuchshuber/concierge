import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MarkInput = z.object({
  messageId: z.string().uuid(),
  reason: z.string().trim().max(500).optional().nullable(),
});

const UnmarkInput = z.object({ messageId: z.string().uuid() });

const TeachInput = z.object({
  messageId: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(3).max(5000),
  /** G = Reserva Ativa · P = Público (qualquer pessoa) · I = Equipe Interna. OBRIGATÓRIO: o usuário escolhe ao salvar. */
  audience: z.enum(["G", "P", "I"]),
});

async function loadMessageOwner(supabase: any, messageId: string, userId: string) {
  const { data: msg, error } = await supabase
    .from("property_chat_messages")
    .select("id, conversation_id, role, content, property_chat_conversations!inner(id, property_id, properties!inner(id, owner_id))")
    .eq("id", messageId)
    .single();
  if (error || !msg) throw new Error("Mensagem não encontrada");
  const conv = (msg as any).property_chat_conversations;
  const owner = conv.properties.owner_id;
  if (owner !== userId) throw new Error("Não autorizado");
  return {
    messageId: msg.id as string,
    conversationId: conv.id as string,
    propertyId: conv.property_id as string,
    content: (msg as any).content as string,
    role: (msg as any).role as string,
  };
}

export const markMessageIneffective = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MarkInput.parse(i))
  .handler(async ({ data, context }) => {
    const info = await loadMessageOwner(context.supabase, data.messageId, context.userId);
    const { error } = await context.supabase.from("chat_message_feedback").upsert(
      {
        message_id: info.messageId,
        conversation_id: info.conversationId,
        property_id: info.propertyId,
        owner_id: context.userId,
        marked_by: context.userId,
        reason: data.reason ?? null,
        resolved: false,
      },
      { onConflict: "message_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const unmarkMessageIneffective = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UnmarkInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("chat_message_feedback")
      .delete()
      .eq("message_id", data.messageId)
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const teachAiFromMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TeachInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const info = await loadMessageOwner(supabase, data.messageId, userId);

    // Next position
    const { data: existing } = await supabase
      .from("host_behavior")
      .select("position")
      .eq("owner_id", userId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = ((existing?.[0]?.position as number | undefined) ?? -1) + 1;

    const baseRow = {
      owner_id: userId,
      title: data.title,
      body: data.body,
      enabled: true,
      source: "teach",
      source_property_id: info.propertyId,
      position: nextPos,
    };
    let { data: behavior, error: bErr } = await supabase
      .from("host_behavior")
      .insert({ ...baseRow, audience: data.audience } as never)
      .select("id")
      .single();
    if (bErr && data.audience === "P") {
      // Banco ainda sem a coluna `audience` (migração pendente): Público = comportamento de sempre, grava igual.
      ({ data: behavior, error: bErr } = await supabase.from("host_behavior").insert(baseRow).select("id").single());
    }
    if (bErr || !behavior) {
      throw new Error(data.audience === "P" ? (bErr?.message ?? "Falha ao salvar aprendizado") : "Não foi possível salvar com esse público agora (atualização do banco pendente). Tente novamente em instantes.");
    }

    // VALE JÁ (01/11/2026): o comportamento ensinado entra na base do imóvel de origem na hora.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { reindexProperty } = await import("@/lib/ai/indexing.server");
      await reindexProperty(supabaseAdmin, info.propertyId).catch((e) => console.error("[teach] reindex", e));
    } catch (e) {
      console.error("[teach] reindex falhou", e);
    }

    const { error: fErr } = await supabase.from("chat_message_feedback").upsert(
      {
        message_id: info.messageId,
        conversation_id: info.conversationId,
        property_id: info.propertyId,
        owner_id: userId,
        marked_by: userId,
        resolved: true,
        behavior_id: behavior.id,
      },
      { onConflict: "message_id" },
    );
    if (fErr) throw new Error(fErr.message);

    return { ok: true, behaviorId: behavior.id };
  });

export const listMyFeedback = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("chat_message_feedback")
      .select("message_id, conversation_id, property_id, reason, resolved, behavior_id, created_at")
      .eq("owner_id", context.userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
