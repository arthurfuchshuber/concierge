import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// -------- List conversations for the current user (filtered by queue) --------

const ListInput = z.object({
  queue: z
    .enum(["needs_human", "assigned_to_me", "all_active", "ai_only", "all", "resolved"])
    .default("needs_human"),
  limit: z.number().int().min(1).max(200).default(50),
});

export const listHandoffConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let q = supabase
      .from("property_chat_conversations")
      .select(
        "id, property_id, guest_session_id, guest_name, status, ai_paused, assigned_to, handoff_reason, handoff_urgency, handoff_at, last_message_at, created_at, resolved_at, properties:property_id(id, name, owner_id, slug)",
      )
      .order("handoff_at", { ascending: false, nullsFirst: false })
      .order("last_message_at", { ascending: false })
      .limit(data.limit);

    if (data.queue === "needs_human") q = q.eq("status", "needs_human");
    else if (data.queue === "assigned_to_me") q = q.eq("assigned_to", userId).in("status", ["assigned", "needs_human"]);
    else if (data.queue === "all_active") q = q.in("status", ["needs_human", "assigned"]);
    else if (data.queue === "ai_only") q = q.eq("status", "ai");
    else if (data.queue === "resolved") q = q.eq("status", "resolved");
    // "all" → sem filtro de status: mostra todas as conversas visíveis por RLS
    // (owner + membros ativos da conta veem tudo; RLS restringe automaticamente).

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { conversations: rows ?? [] };
  });

// -------- Get one conversation with messages --------

const GetInput = z.object({ conversationId: z.string().uuid() });

export const getHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: conv, error: cErr }, { data: msgs, error: mErr }] = await Promise.all([
      supabase
        .from("property_chat_conversations")
        .select(
          "id, property_id, guest_session_id, guest_name, status, ai_paused, assigned_to, handoff_reason, handoff_urgency, handoff_at, last_message_at, created_at, resolved_at, properties:property_id(id, name, owner_id, slug, city)",
        )
        .eq("id", data.conversationId)
        .maybeSingle(),
      supabase
        .from("property_chat_messages")
        .select("id, role, content, sender_type, sender_user_id, is_internal_note, created_at")
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true }),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (mErr) throw new Error(mErr.message);
    if (!conv) throw new Error("Conversa não encontrada.");
    return { conversation: conv, messages: msgs ?? [] };
  });

// -------- Claim / assign to me --------

export const claimHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ status: "assigned", assigned_to: userId, ai_paused: true })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Release back to AI --------

export const releaseHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ status: "ai", assigned_to: null, ai_paused: false, handoff_reason: null, handoff_at: null, handoff_urgency: null })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Resolve --------

export const resolveHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => GetInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ status: "resolved", resolved_at: new Date().toISOString(), ai_paused: false })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Send a human/agent message --------

const SendInput = z.object({
  conversationId: z.string().uuid(),
  content: z.string().trim().min(1).max(4000),
  internalNote: z.boolean().optional().default(false),
});

export const sendHandoffMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SendInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: data.internalNote ? "assistant" : "assistant",
      content: data.content,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: data.internalNote,
    });
    if (error) throw new Error(error.message);
    // Ensure conversation status stays assigned + ai paused when agent replies
    if (!data.internalNote) {
      await supabase
        .from("property_chat_conversations")
        .update({ ai_paused: true, status: "assigned", assigned_to: userId, last_message_at: new Date().toISOString() })
        .eq("id", data.conversationId);

      // Dispara push para o hóspede (se ele tiver ativado notificações).
      try {
        const { data: conv } = await supabase
          .from("property_chat_conversations")
          .select("id, properties:property_id(name, slug)")
          .eq("id", data.conversationId)
          .maybeSingle();
        const propName = (conv?.properties as { name?: string } | null)?.name ?? "Anfitrião";
        const slug = (conv?.properties as { slug?: string } | null)?.slug ?? "";
        const { sendPushToGuest } = await import("@/lib/guest-push.server");
        const preview = data.content.length > 120 ? `${data.content.slice(0, 117)}…` : data.content;
        await sendPushToGuest(data.conversationId, {
          title: `Nova mensagem — ${propName}`,
          body: preview,
          data: {
            url: slug ? `/g/${slug}?chat=1` : "/",
            conversationId: data.conversationId,
            tag: `guest-reply-${data.conversationId}`,
          },
        });
      } catch {
        // Não bloqueia o envio se o push falhar.
      }
    }
    return { ok: true };
  });

// -------- Count of pending handoffs (for badge/dock) --------

export const countPendingHandoffs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { count, error } = await supabase
      .from("property_chat_conversations")
      .select("id", { count: "exact", head: true })
      .eq("status", "needs_human");
    if (error) throw new Error(error.message);
    return { count: count ?? 0 };
  });

// -------- Check whether current user has access to central de atendimento --------
// (Owner com plano business/enterprise, ou membro ativo de tal owner)

export const getAtendimentoAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { resolveUserPlan } = await import("@/lib/plan-guard.server");
    const ownPlan = await resolveUserPlan(supabase, userId);
    const isOwnerEligible = ownPlan.plan === "business" || ownPlan.plan === "enterprise";
    if (isOwnerEligible) {
      return { allowed: true, as: "owner" as const, plan: ownPlan.plan };
    }
    // Membro? Verifica se algum owner ativo tem plano elegível.
    const { data: memberships } = await supabase
      .from("account_members")
      .select("owner_id, role, status")
      .eq("member_user_id", userId)
      .eq("status", "active");
    if (!memberships || memberships.length === 0) {
      return { allowed: false as const, as: null, plan: null };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    for (const m of memberships) {
      const p = await resolveUserPlan(supabaseAdmin as unknown as typeof supabase, m.owner_id as string);
      if (p.plan === "business" || p.plan === "enterprise") {
        return { allowed: true as const, as: "member" as const, plan: p.plan };
      }
    }
    return { allowed: false as const, as: null, plan: null };
  });
