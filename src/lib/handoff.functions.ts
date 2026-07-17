import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  emptyHandoffListResult,
  normalizeHandoffConversationRows,
  parseHandoffConversationInput,
  parseHandoffListInput,
  parseHandoffSendInput,
  parseHandoffTransferInput,
  type HandoffConversationSummary,
  type HandoffGuestDetail,
  type HandoffListResult,
} from "@/lib/handoff.schemas";

// -------- List conversations for the current user (filtered by queue) --------

export const listHandoffConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffListInput)
  .handler(async ({ data, context }): Promise<HandoffListResult> => {
    let list: HandoffConversationSummary[] = [];
    try {
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
      // "all" → sem filtro de status

      const { data: rows, error } = await q;
      if (error) {
        console.error("listHandoffConversations failed", error);
        return emptyHandoffListResult(error.message);
      }
      list = normalizeHandoffConversationRows(rows);
    } catch (error) {
      console.error("listHandoffConversations crashed", error);
      return emptyHandoffListResult("Não foi possível carregar as conversas agora.");
    }


    // Enriquece cada conversa com nome do hóspede, telefone e check-in vindos
    // do guide_access_logs correspondente (mesma propriedade + mesmo nome).
    // IMPORTANTE: NÃO fazemos fallback para "o log mais recente da propriedade"
    // — isso vazaria dados de outro hóspede e faria a unificação (Nome + Check-in
    // + Guia) fundir conversas de pessoas diferentes.
    const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    const details: Record<string, HandoffGuestDetail> = {};
    if (list.length > 0) {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const propIds = Array.from(new Set(list.map((c) => c.property_id).filter(Boolean) as string[]));
        const { data: logs } = await supabaseAdmin
          .from("guide_access_logs")
          .select("property_id, guest_name, guest_phone, guest_phone_country, checkin_date, reservation_code, created_at")
          .in("property_id", propIds)
          .order("created_at", { ascending: false })
          .limit(2000);
        // Indexa por (property_id | nome-normalizado) → mantém o log com MAIOR checkin_date
        // para bater com o critério usado em Engajamento.
        const bestLogByKey = new Map<string, {
          guest_name: string | null;
          guest_phone: string | null;
          guest_phone_country: string | null;
          checkin_date: string | null;
          reservation_code: string | null;
          created_at: string;
        }>();
        for (const l of logs ?? []) {
          const name = norm(l.guest_name as string | null);
          if (!name) continue;
          const key = `${l.property_id}|${name}`;
          const prev = bestLogByKey.get(key);
          const curCk = (l.checkin_date as string | null) ?? "";
          const prevCk = prev?.checkin_date ?? "";
          if (!prev || curCk > prevCk || (curCk === prevCk && (l.created_at as string) > prev.created_at)) {
            bestLogByKey.set(key, {
              guest_name: l.guest_name as string | null,
              guest_phone: l.guest_phone as string | null,
              guest_phone_country: l.guest_phone_country as string | null,
              checkin_date: (l.checkin_date as string | null) ?? null,
              reservation_code: (l.reservation_code as string | null) ?? null,
              created_at: l.created_at as string,
            });
          }
        }
        for (const conv of list) {
          const name = norm(conv.guest_name);
          if (!name) continue;
          const match = bestLogByKey.get(`${conv.property_id}|${name}`);
          if (match) {
            details[conv.id as string] = {
              name: match.guest_name ?? conv.guest_name,
              phone: match.guest_phone,
              phoneCountry: match.guest_phone_country,
              checkinDate: match.checkin_date,
              reservationCode: match.reservation_code,
            };
          }
        }
      } catch {
        // silencioso — se falhar, seguimos apenas com o que temos na conversa
      }
    }

    // Unifica conversas do mesmo hóspede (mesmo Nome + mesma Data de Check-in + mesmo Guia/Propriedade).
    // Só unifica quando os TRÊS estão preenchidos — sem isso, mantém como conversa própria
    // (evita fundir hóspedes distintos que ainda não tiveram nome/checkin resolvidos).
    const bestByKey = new Map<string, HandoffConversationSummary>();
    const ordered: HandoffConversationSummary[] = [];
    const keyFor = (c: HandoffConversationSummary): string => {
      const d = details[c.id as string];
      const name = norm(d?.name ?? c.guest_name);
      const checkin = d?.checkinDate ?? "";
      const propId = c.property_id ?? "";
      return name && checkin && propId ? `${propId}|${name}|${checkin}` : `__solo__:${c.id}`;
    };
    for (const conv of list) {
      const key = keyFor(conv);
      const prev = bestByKey.get(key);
      const prevTs = prev ? Date.parse(prev.last_message_at ?? "") : -1;
      const curTs = Date.parse(conv.last_message_at ?? "");
      if (!prev) {
        bestByKey.set(key, conv);
        ordered.push(conv);
      } else if (curTs > prevTs) {
        const idx = ordered.indexOf(prev);
        if (idx >= 0) ordered[idx] = conv;
        bestByKey.set(key, conv);
      }
    }
    const deduped = ordered.filter((c) => bestByKey.get(keyFor(c)) === c);


    return { conversations: deduped, details };
  });



// -------- Get one conversation with messages --------

export const getHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [{ data: conv, error: cErr }, { data: msgs, error: mErr }] = await Promise.all([
      supabase
        .from("property_chat_conversations")
        .select(
          "id, property_id, guest_session_id, guest_name, status, ai_paused, assigned_to, claim_requested_by, claim_requested_at, handoff_reason, handoff_urgency, handoff_at, last_message_at, created_at, resolved_at, properties:property_id(id, name, owner_id, slug, city)",
        )
        .eq("id", data.conversationId)
        .maybeSingle(),
      supabase
        .from("property_chat_messages")
        .select(
          "id, role, content, sender_type, sender_user_id, is_internal_note, created_at, attachment_path, attachment_type, attachment_mime, attachment_duration_ms, attachment_size_bytes, attachment_name",
        )
        .eq("conversation_id", data.conversationId)
        .order("created_at", { ascending: true }),
    ]);
    if (cErr) throw new Error(cErr.message);
    if (mErr) throw new Error(mErr.message);
    if (!conv) throw new Error("Conversa não encontrada.");

    // Busca o registro de acesso mais recente (nome, telefone, checkin) via service-role
    // — a RLS de guide_access_logs só permite owner; usamos admin porque a RLS de
    // property_chat_conversations já confirmou que o usuário pode ver esta conversa.
    let guestDetails: {
      name: string | null;
      phone: string | null;
      phoneCountry: string | null;
      checkinDate: string | null;
      reservationCode: string | null;
    } = { name: conv.guest_name, phone: null, phoneCountry: null, checkinDate: null, reservationCode: null };
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      let logQ = supabaseAdmin
        .from("guide_access_logs")
        .select("guest_name, guest_phone, guest_phone_country, checkin_date, reservation_code, created_at")
        .eq("property_id", conv.property_id)
        .order("created_at", { ascending: false })
        .limit(1);
      if (conv.guest_name) logQ = logQ.ilike("guest_name", conv.guest_name);
      const { data: logs } = await logQ;
      const log = logs?.[0];
      if (log) {
        guestDetails = {
          name: log.guest_name ?? conv.guest_name,
          phone: log.guest_phone,
          phoneCountry: log.guest_phone_country,
          checkinDate: log.checkin_date,
          reservationCode: log.reservation_code,
        };
      }
    } catch {
      // silencioso — se não achar, seguimos com o que temos
    }

    // Nome do solicitante do claim (se houver)
    let claimRequester: { userId: string; displayName: string | null } | null = null;
    if (conv.claim_requested_by) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", conv.claim_requested_by)
        .maybeSingle();
      claimRequester = {
        userId: conv.claim_requested_by,
        displayName: prof?.full_name ?? null,
      };
    }
    let assignedProfile: { userId: string; displayName: string | null } | null = null;
    if (conv.assigned_to) {
      const { data: prof } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("id", conv.assigned_to)
        .maybeSingle();
      assignedProfile = { userId: conv.assigned_to, displayName: prof?.full_name ?? null };
    }

    return { conversation: conv, messages: msgs ?? [], guestDetails, claimRequester, assignedProfile };
  });

// -------- Claim / assign to me (bloqueia se já está com outro atendente) --------

export const claimHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Só permite claim se: sem dono, ou já é meu.
    const { data: cur, error: readErr } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to, status")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("Conversa não encontrada.");
    if (cur.assigned_to && cur.assigned_to !== userId) {
      throw new Error("Esta conversa já está sendo atendida por outro membro. Solicite acesso ou peça uma transferência.");
    }
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        status: "assigned",
        assigned_to: userId,
        ai_paused: true,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Solicitar acesso a uma conversa já assumida por outro --------

export const requestHandoffClaim = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur, error: readErr } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("Conversa não encontrada.");
    if (!cur.assigned_to) throw new Error("Conversa livre — assuma diretamente.");
    if (cur.assigned_to === userId) return { ok: true, alreadyMine: true };

    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ claim_requested_by: userId, claim_requested_at: new Date().toISOString() })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    // Registra nota interna para o atendente atual visualizar o pedido.
    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle();
    const who = prof?.full_name ?? "Um membro da equipe";
    await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content: `🔔 ${who} solicitou acesso a esta conversa.`,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: true,
    });
    return { ok: true };
  });

// -------- Transferir a conversa para outro membro (só quem está atendendo) --------

export const transferHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffTransferInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: cur, error: readErr } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!cur) throw new Error("Conversa não encontrada.");
    if (cur.assigned_to !== userId) {
      throw new Error("Apenas o atendente responsável pode transferir esta conversa.");
    }
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        assigned_to: data.toUserId,
        status: "assigned",
        ai_paused: true,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);

    const { data: prof } = await supabase.from("profiles").select("full_name").eq("id", data.toUserId).maybeSingle();
    const who = prof?.full_name ?? "outro membro";
    await supabase.from("property_chat_messages").insert({
      conversation_id: data.conversationId,
      role: "assistant",
      content: `🔁 Conversa transferida para ${who}.`,
      sender_type: "human",
      sender_user_id: userId,
      is_internal_note: true,
    });
    return { ok: true };
  });

// -------- Cancelar solicitação de acesso pendente (quem solicitou) --------

export const cancelHandoffClaimRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({ claim_requested_by: null, claim_requested_at: null })
      .eq("id", data.conversationId)
      .eq("claim_requested_by", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Release back to AI --------

export const releaseHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        status: "ai",
        assigned_to: null,
        ai_paused: false,
        handoff_reason: null,
        handoff_at: null,
        handoff_urgency: null,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Resolve --------

export const resolveHandoffConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("property_chat_conversations")
      .update({
        status: "resolved",
        resolved_at: new Date().toISOString(),
        ai_paused: false,
        claim_requested_by: null,
        claim_requested_at: null,
      })
      .eq("id", data.conversationId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// -------- Send a human/agent message --------

export const sendHandoffMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffSendInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Trava: se a conversa está atribuída a outro atendente, bloqueia o envio.
    const { data: cur } = await supabase
      .from("property_chat_conversations")
      .select("assigned_to")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (cur?.assigned_to && cur.assigned_to !== userId) {
      throw new Error("Esta conversa está sendo atendida por outro membro. Solicite acesso ou peça uma transferência.");
    }
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
    try {
      const { supabase } = context;
      const { count, error } = await supabase
        .from("property_chat_conversations")
        .select("id", { count: "exact", head: true })
        .eq("status", "needs_human");
      if (error) {
        console.error("countPendingHandoffs failed", error);
        return { count: 0, error: error.message };
      }
      return { count: count ?? 0 };
    } catch (error) {
      console.error("countPendingHandoffs crashed", error);
      return { count: 0, error: "Não foi possível carregar o contador agora." };
    }
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

// -------- List transfer targets for a conversation (owner + active members) --------

export const listConversationTransferTargets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(parseHandoffConversationInput)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: conv } = await supabase
      .from("property_chat_conversations")
      .select("id, properties:property_id(owner_id)")
      .eq("id", data.conversationId)
      .maybeSingle();
    const ownerId = (conv?.properties as { owner_id?: string } | null)?.owner_id ?? null;
    if (!ownerId) return { targets: [] };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: members } = await supabaseAdmin
      .from("account_members")
      .select("member_user_id, role")
      .eq("owner_id", ownerId)
      .eq("status", "active");

    const ids = new Set<string>([ownerId, ...((members ?? []).map((m) => m.member_user_id as string))]);
    ids.delete(userId); // sem transferir para si mesmo
    const idList = Array.from(ids);
    if (idList.length === 0) return { targets: [] };

    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .in("id", idList);
    const nameById = new Map<string, string | null>();
    for (const p of profs ?? []) nameById.set(p.id as string, (p.full_name as string) ?? null);

    const roleById = new Map<string, string>();
    roleById.set(ownerId, "owner");
    for (const m of members ?? []) roleById.set(m.member_user_id as string, m.role as string);

    return {
      targets: idList.map((id) => ({
        userId: id,
        displayName: nameById.get(id) ?? null,
        role: roleById.get(id) ?? "agent",
      })),
    };
  });
