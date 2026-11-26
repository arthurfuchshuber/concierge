import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cityKey } from "@/lib/city-key";
import {
  REGIONAL_DEFAULT_NEIGHBORHOODS,
  REGIONAL_VALIDITY_HOURS,
  regionalExpiresAt,
  type RegionalValidity,
} from "@/lib/regional-situation";

/**
 * ATENDIMENTO REFATORADO (mockups ATD/REG/APR aprovados em 23–26/11/2026) — server functions da tela.
 *  - contagem das quatro filas (Meus · Precisa Humano · Com a IA · Resolvidas);
 *  - pergunta da IA à equipe (janela Instruir a IA) e o fluxo "Enviar à IA";
 *  - imóveis da conta para o seletor e o aviso específico de escopo;
 *  - situação regional: sugestão, marcar/editar/encerrar, "Agora Não", faixa da situação ativa;
 *  - Aprendizados: lista, aprovar, "Só Desta Vez", editar e escopo.
 * Leituras de conversa passam pela RLS do usuário; escritas exigem `chat_respond` (ou a permissão de treino da
 * IA, nos aprendizados) e rodam com o cliente de serviço só depois da checagem.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
/** Linha lida do banco (tabelas fora dos tipos gerados): campos acessados com conversão explícita. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const uuid = z.string().uuid();

async function admin(): Promise<Db> {
  return (await import("@/integrations/supabase/client.server")).supabaseAdmin;
}

async function accountScope(supabase: Db, userId: string, accountOwnerId: string | null | undefined): Promise<string> {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  return resolveAuthorizedAccountOwnerId(supabase, userId, accountOwnerId ?? null);
}

/** Conversa lida PELA SESSÃO (a RLS confirma o acesso) + imóvel. */
async function convOf(supabase: Db, conversationId: string) {
  const { data } = await supabase
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, status, assigned_to, handoff_reason, last_message_at, properties:property_id(id, name, owner_id, city)")
    .eq("id", conversationId)
    .maybeSingle();
  if (!data) throw new Error("Conversa não encontrada.");
  const prop = (Array.isArray(data.properties) ? data.properties[0] : data.properties) as
    | { id: string; name: string | null; owner_id: string | null; city: string | null }
    | null;
  return { conv: data as Row, prop };
}

async function requireRespond(supabase: Db, userId: string, conversationId: string) {
  const { requireChatRespondForConversation } = await import("@/lib/handoff.functions");
  await requireChatRespondForConversation(supabase, userId, conversationId);
}

// ─────────────────────────── filas ───────────────────────────

export type QueueCounts = { mine: number; human: number; ai: number; resolved: number };

/** Contagem das quatro filas, com o mesmo isolamento por conta da listagem. */
export const countHandoffQueues = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountOwnerId: uuid.nullish() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<QueueCounts> => {
    const empty = { mine: 0, human: 0, ai: 0, resolved: 0 };
    try {
      const { supabase, userId } = context;
      const accountId = await accountScope(supabase, userId, data.accountOwnerId);
      const { data: props } = await supabase.from("properties").select("id").eq("owner_id", accountId);
      const ids = ((props ?? []) as Array<{ id: string }>).map((p) => String(p.id));
      if (ids.length === 0) return empty;
      const base = () => supabase.from("property_chat_conversations").select("id", { count: "exact", head: true }).in("property_id", ids);
      const [mine, human, ai, resolved] = await Promise.all([
        base().eq("assigned_to", userId).in("status", ["assigned", "needs_human"]),
        base().in("status", ["needs_human", "assigned"]),
        base().eq("status", "ai"),
        base().eq("status", "resolved"),
      ]);
      return { mine: mine.count ?? 0, human: human.count ?? 0, ai: ai.count ?? 0, resolved: resolved.count ?? 0 };
    } catch {
      return empty;
    }
  });

// ─────────────────────────── Instruir a IA ───────────────────────────

/** Pergunta que a IA fez à equipe ao encaminhar (última do turno com encaminhamento). */
export const getConversationAiQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<{ question: string | null }> => {
    await convOf(context.supabase, data.conversationId);
    const db = await admin();
    const { data: rows } = await db
      .from("guest_ai_turns")
      .select("internal_question, created_at")
      .eq("conversation_id", data.conversationId)
      .not("internal_question", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const q = ((rows ?? []) as Array<{ internal_question?: string | null }>)[0]?.internal_question ?? null;
    return { question: q && q.trim() ? q.trim() : null };
  });

export type AccountProperty = { id: string; name: string; owner: string | null; city: string | null };

/** Imóveis da conta da conversa (seletor "Imóveis" da janela Instruir a IA). */
export const listConversationAccountProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<AccountProperty[]> => {
    const { prop } = await convOf(context.supabase, data.conversationId);
    if (!prop?.owner_id) return [];
    const all = await accountProperties(prop.owner_id);
    if (context.userId === prop.owner_id) return all;
    // Membro: só os imóveis que ele mesmo enxerga (atribuições/RLS).
    const { data: visible } = await context.supabase
      .from("properties")
      .select("id")
      .eq("owner_id", prop.owner_id)
      .limit(1000);
    const ok = new Set(((visible ?? []) as Array<{ id: string }>).map((v) => String(v.id)));
    return all.filter((p) => ok.has(p.id));
  });

/** Imóveis da conta ativa (filtro "Imóveis" da busca do Atendimento). */
export const listAtendimentoProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountOwnerId: uuid.nullish() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<AccountProperty[]> => {
    try {
      const ownerId = await accountScope(context.supabase, context.userId, data.accountOwnerId);
      return await accountProperties(ownerId);
    } catch {
      return [];
    }
  });

async function accountProperties(ownerId: string): Promise<AccountProperty[]> {
  const db = await admin();
  const { data: rows } = await db
    .from("properties")
    .select("id, name, city, owner_contact_id, archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name", { ascending: true })
    .limit(500);
  const list = (rows ?? []) as Array<{ id: string; name: string | null; city: string | null; owner_contact_id: string | null }>;
  const contactIds = [...new Set(list.map((p) => p.owner_contact_id).filter((x): x is string => !!x))];
  const names = new Map<string, string | null>();
  if (contactIds.length) {
    const { data: owners } = await db.from("property_owners").select("id, name, trade_name").in("id", contactIds);
    for (const o of (owners ?? []) as Array<{ id: string; name?: string | null; trade_name?: string | null }>)
      names.set(o.id, ((o.trade_name || o.name) ?? "").trim() || null);
  }
  return list.map((p) => ({
    id: String(p.id),
    name: (p.name ?? "").trim() || "Imóvel",
    owner: p.owner_contact_id ? (names.get(p.owner_contact_id) ?? null) : null,
    city: p.city ?? null,
  }));
}

/* Imóveis da conta que o usuário enxerga com o próprio login (membro com
   imóveis atribuídos só vê os seus). */
async function visibleIds(supabase: { from: (t: "properties") => any }, ownerId: string): Promise<Set<string>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data } = await supabase.from("properties").select("id").eq("owner_id", ownerId);
  return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
}

/** Aviso específico quando a instrução é sobre algo físico e os imóveis marcados diferem (25/11/2026). */
export const reviewInstructionScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ conversationId: uuid, instruction: z.string().max(2000), propertyIds: z.array(uuid).max(50) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ warning: string | null }> => {
    const { prop } = await convOf(context.supabase, data.conversationId);
    if (!prop?.owner_id || data.propertyIds.length < 2) return { warning: null };
    const visible = await visibleIds(context.supabase, prop.owner_id);
    const allowedIds = data.propertyIds.filter((id) => visible.has(id));
    if (allowedIds.length < 2) return { warning: null };
    const db = await admin();
    const { data: rows } = await db
      .from("properties")
      .select("id, name, owner_id, checkin_instructions, checkout_instructions, gate_instructions, lock_instructions, house_rules, airbnb_description_full")
      .in("id", allowedIds)
      .eq("owner_id", prop.owner_id);
    const properties = ((rows ?? []) as Array<Record<string, unknown>>).map((r) => ({
      name: String(r["name"] ?? "Imóvel"),
      info: ["gate_instructions", "lock_instructions", "checkin_instructions", "checkout_instructions", "house_rules", "airbnb_description_full"]
        .map((k) => (typeof r[k] === "string" ? String(r[k]).trim() : ""))
        .filter(Boolean)
        .join("\n")
        .slice(0, 1400),
    }));
    const { instructionScopeWarning } = await import("@/lib/atendimento-ai.server");
    return { warning: await instructionScopeWarning({ instruction: data.instruction, properties }) };
  });

/** Pode aprovar aprendizado direto (dono, admin do SaaS ou membro com `ai_train`). */
export const getLearningApprovalRight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: uuid }).parse(d))
  .handler(async ({ data, context }): Promise<{ canApprove: boolean }> => {
    const { prop } = await convOf(context.supabase, data.conversationId);
    const { canApprove } = await import("@/lib/guest-ai-learning/silent.server");
    return { canApprove: await canApprove(await admin(), context.userId, prop?.owner_id ?? null) };
  });

const SENDER_WHO: Record<string, "hóspede" | "equipe" | "ia" | "automática"> = { guest: "hóspede", human: "equipe", ai: "ia", system: "automática" };

/** Lê a conversa, pede a resposta à IA e entrega pelo canal do hóspede. Devolve o que aconteceu. */
async function instructOne(p: {
  conversationId: string;
  instruction: string;
  teach: boolean;
  userId: string;
}): Promise<{ sent: boolean; learning: { statement: string; category: string } | null; failed: boolean }> {
  const db = await admin();
  const { data: conv } = await db
    .from("property_chat_conversations")
    .select("id, property_id, guest_session_id, guest_name, status, properties:property_id(name, wifi_password, gate_code, lock_code, pin_code)")
    .eq("id", p.conversationId)
    .maybeSingle();
  if (!conv) return { sent: false, learning: null, failed: true };
  const prop = (Array.isArray(conv.properties) ? conv.properties[0] : conv.properties) as Record<string, string | null> | null;
  const { data: msgs } = await db
    .from("property_chat_messages")
    .select("sender_type, content, created_at, is_internal_note, delivery_status")
    .eq("conversation_id", p.conversationId)
    .order("created_at", { ascending: false })
    .limit(40);
  const history = ((msgs ?? []) as Array<Row>)
    .filter((m) => !m.is_internal_note && m.delivery_status !== "failed" && typeof m.content === "string" && m.content.trim())
    .reverse()
    .map((m) => ({ who: SENDER_WHO[String(m.sender_type)] ?? "equipe", text: String(m.content), at: String(m.created_at).slice(0, 16).replace("T", " ") }));
  const { data: turns } = await db
    .from("guest_ai_turns")
    .select("internal_question")
    .eq("conversation_id", p.conversationId)
    .not("internal_question", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const { composeInstructedReply } = await import("@/lib/atendimento-ai.server");
  const r = await composeInstructedReply({
    propertyName: prop?.name ?? "",
    guestName: conv.guest_name ?? null,
    history: history as never,
    aiQuestion: ((turns ?? []) as Array<{ internal_question?: string | null }>)[0]?.internal_question ?? null,
    instruction: p.instruction,
    teach: p.teach,
    forbidden: [prop?.wifi_password, prop?.gate_code, prop?.lock_code, prop?.pin_code].filter((v): v is string => typeof v === "string" && !!v.trim()),
  });
  if (!r) return { sent: false, learning: null, failed: true };
  let sent = false;
  if (r.needsReply && r.reply) {
    const { deliverAiMessage } = await import("@/lib/guest-ai-decision.server");
    const id = await deliverAiMessage({
      conversationId: p.conversationId,
      session: String(conv.guest_session_id ?? ""),
      propertyId: String(conv.property_id),
      text: r.reply,
    }).catch(() => null);
    if (!id) return { sent: false, learning: r.learning, failed: true };
    sent = true;
  }
  // a equipe devolveu o atendimento à IA: o chamado sai da fila humana
  const { resumePatch } = await import("@/lib/chat/pause");
  await db
    .from("property_chat_conversations")
    .update({
      status: "ai",
      assigned_to: null,
      ...resumePatch(),
      handoff_reason: null,
      handoff_at: null,
      handoff_urgency: null,
      claim_requested_by: null,
      claim_requested_at: null,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", p.conversationId)
    .neq("status", "resolved");
  return { sent, learning: r.learning, failed: false };
}

export type InstructResponse = {
  sent: number;
  skipped: number;
  failed: number;
  learned: number;
  learnPending: boolean;
  message: string;
};

/**
 * "Enviar à IA" (janela Instruir a IA): a IA avalia, em cada conversa, se ainda precisa responder ao hóspede e
 * entrega só o que ficou em aberto. Com "Ensinar a IA para as Próximas", a instrução vira aprendizado nos imóveis
 * escolhidos: quem pode aprovar (dono, admin, `ai_train`) ativa na hora; os demais mandam para Aprendizados.
 * Instrução sobre algo físico dada aqui não passa por outro filtro além dessa aprovação (25/11/2026).
 */
export const instructAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: uuid,
        instruction: z.string().trim().min(3).max(2000),
        teach: z.boolean(),
        propertyIds: z.array(uuid).max(200),
        /** Situação regional: aplicar também às conversas afetadas. */
        alsoConversationIds: z.array(uuid).max(50).default([]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<InstructResponse> => {
    const { supabase, userId } = context;
    const { prop } = await convOf(supabase, data.conversationId);
    await requireRespond(supabase, userId, data.conversationId);
    const targets = [data.conversationId];
    for (const id of data.alsoConversationIds) {
      if (targets.includes(id)) continue;
      try {
        const other = await convOf(supabase, id);
        if (other.prop?.owner_id !== prop?.owner_id) continue;
        await requireRespond(supabase, userId, id);
        targets.push(id);
      } catch {
        /* fora do alcance de quem instruiu: ignora */
      }
    }
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let learning: { statement: string; category: string } | null = null;
    for (const [n, id] of targets.entries()) {
      const r = await instructOne({ conversationId: id, instruction: data.instruction, teach: data.teach && n === 0, userId });
      if (r.failed) failed += 1;
      else if (r.sent) sent += 1;
      else skipped += 1;
      if (n === 0) learning = r.learning;
    }
    let learned = 0;
    let learnPending = false;
    if (data.teach && learning && prop?.owner_id) {
      const db = await admin();
      const { canApprove } = await import("@/lib/guest-ai-learning/silent.server");
      const approve = await canApprove(db, userId, prop.owner_id);
      const { proposeLearningCandidate } = await import("@/lib/guest-ai-learning.server");
      const ids = data.propertyIds.length ? data.propertyIds : [prop.id];
      const { data: owned } = await db.from("properties").select("id").in("id", ids).eq("owner_id", prop.owner_id);
      for (const row of (owned ?? []) as Array<{ id: string }>) {
        const res = await proposeLearningCandidate({
          propertyId: row.id,
          category: learning.category,
          statement: learning.statement,
          evidence: { source: "team_instruction", propertyId: row.id, refs: [`instr:${data.conversationId}`, `by:${userId}`], closed: true },
        });
        if (!res.ok || !res.id) continue;
        if (approve) {
          const { error } = await supabase.rpc("guest_ai_learning_review", { p_id: res.id, p_action: "approve", p_note: "Instrução da equipe (Instruir a IA)" });
          if (!error) learned += 1;
          else learnPending = true;
        } else learnPending = true;
      }
    }
    const parts: string[] = [];
    if (sent) parts.push(sent === 1 ? "A IA respondeu ao hóspede." : `A IA respondeu em ${sent} conversas.`);
    if (skipped) parts.push(skipped === 1 ? "Uma conversa já estava respondida: a IA não enviou nada." : `${skipped} conversas já estavam respondidas: a IA não enviou nada.`);
    if (failed) parts.push(failed === 1 ? "Uma conversa não pôde ser respondida: responda manualmente." : `${failed} conversas não puderam ser respondidas: responda manualmente.`);
    if (learned) parts.push(learned === 1 ? "Aprendizado ativo." : `Aprendizado ativo em ${learned} imóveis.`);
    if (learnPending) parts.push("Aprendizado enviado para aprovação em Aprendizados.");
    return { sent, skipped, failed, learned, learnPending, message: parts.join(" ") || "Instrução registrada." };
  });

// ─────────────────────────── Situação regional ───────────────────────────

export type RegionalSituation = {
  id: string;
  city: string;
  kind: string;
  neighborhoods: string;
  aiText: string;
  startsAt: string;
  expiresAt: string | null;
  usedIn: number;
};

export type AffectedConversation = { id: string; guestName: string; propertyId: string };

const REG_BASE = "id, owner_id, city, kind, neighborhoods, ai_text, status, starts_at, expires_at, source_conversation_id, source_message_id";
// `used_conversation_ids` chega pela migração 20261126180000; antes dela a leitura segue sem a contagem
const REG_COLS = `${REG_BASE}, used_conversation_ids`;

function toRegional(r: Row, usedIn = 0): RegionalSituation {
  return {
    id: String(r.id),
    city: String(r.city),
    kind: String(r.kind),
    neighborhoods: String(r.neighborhoods ?? REGIONAL_DEFAULT_NEIGHBORHOODS),
    aiText: String(r.ai_text),
    startsAt: String(r.starts_at),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    usedIn,
  };
}

async function activeRegional(db: Db, ownerId: string): Promise<Array<Row>> {
  const now = new Date().toISOString();
  const read = (cols: string) =>
    db.from("guest_ai_regional_situations").select(cols).eq("owner_id", ownerId).eq("status", "active").order("starts_at", { ascending: false }).limit(20);
  let { data, error } = await read(REG_COLS);
  if (error) ({ data, error } = await read(REG_BASE));
  if (error) return [];
  return ((data ?? []) as Array<Row>).filter((r) => !r.expires_at || String(r.expires_at) > now);
}

async function cityPropertyIds(db: Db, ownerId: string, city: string): Promise<string[]> {
  const { data } = await db.from("properties").select("id, city").eq("owner_id", ownerId).is("archived_at", null);
  const key = cityKey(city);
  return ((data ?? []) as Array<{ id: string; city: string | null }>).filter((p) => cityKey(p.city) === key).map((p) => String(p.id));
}

/** Conversas em que a IA de fato se apoiou na situação (registradas pela geração da resposta). */
function usageCount(s: Row): number {
  return Array.isArray(s.used_conversation_ids) ? new Set(s.used_conversation_ids as string[]).size : 0;
}

async function affectedConversations(db: Db, ownerId: string, s: Row): Promise<AffectedConversation[]> {
  const ids = await cityPropertyIds(db, ownerId, String(s.city));
  if (!ids.length) return [];
  const { data } = await db
    .from("property_chat_conversations")
    .select("id, guest_name, property_id, last_message_at")
    .in("property_id", ids)
    .in("status", ["needs_human", "assigned"])
    .gte("last_message_at", String(s.starts_at))
    .order("last_message_at", { ascending: false })
    .limit(30);
  return ((data ?? []) as Array<Row>).map((c) => ({
    id: String(c.id),
    guestName: String(c.guest_name ?? "").trim() || "Hóspede",
    propertyId: String(c.property_id),
  }));
}

/** Situações regionais ativas da conta (faixa acima da lista). */
export const listRegionalSituations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ accountOwnerId: uuid.nullish() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<RegionalSituation[]> => {
    try {
      const ownerId = await accountScope(context.supabase, context.userId, data.accountOwnerId);
      const db = await admin();
      const rows = await activeRegional(db, ownerId);
      return rows.map((r) => toRegional(r, usageCount(r)));
    } catch {
      return [];
    }
  });

/** Situação ativa da cidade desta conversa, conversas afetadas e sugestão pendente de marcar. */
export const getConversationRegional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ conversationId: uuid }).parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      city: string | null;
      active: RegionalSituation | null;
      affected: AffectedConversation[];
      suggestion: { id: string; messageId: string | null; kind: string; aiText: string } | null;
    }> => {
      const { prop } = await convOf(context.supabase, data.conversationId);
      const none = { city: prop?.city ?? null, active: null, affected: [], suggestion: null };
      if (!prop?.owner_id || !prop.city) return none;
      try {
        const db = await admin();
        const key = cityKey(prop.city);
        const act = (await activeRegional(db, prop.owner_id)).find((r) => cityKey(String(r.city)) === key) ?? null;
        const { data: sug } = await db
          .from("guest_ai_regional_situations")
          .select(REG_BASE)
          .eq("source_conversation_id", data.conversationId)
          .eq("status", "suggested")
          .order("created_at", { ascending: false })
          .limit(1);
        const s = ((sug ?? []) as Array<Row>)[0] ?? null;
        return {
          city: prop.city,
          active: act ? toRegional(act, usageCount(act)) : null,
          affected: act
            ? await (async () => {
                const visible = await visibleIds(context.supabase, prop.owner_id as string);
                return (await affectedConversations(db, prop.owner_id as string, act)).filter((c) => visible.has(c.propertyId));
              })()
            : [],
          // com situação ativa na cidade, a sugestão não aparece (já está marcada)
          suggestion: s && !act ? { id: String(s.id), messageId: s.source_message_id ? String(s.source_message_id) : null, kind: String(s.kind), aiText: String(s.ai_text) } : null,
        };
      } catch {
        return none;
      }
    },
  );

/** Marcar (ou editar) a situação regional. A cidade é SEMPRE a do imóvel da conversa (campo travado). */
export const saveRegionalSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        conversationId: uuid.nullish(),
        id: uuid.nullish(),
        kind: z.string().trim().min(1).max(80),
        neighborhoods: z.string().trim().max(200).default(REGIONAL_DEFAULT_NEIGHBORHOODS),
        aiText: z.string().trim().min(1).max(600),
        hours: z.number().refine((h) => (REGIONAL_VALIDITY_HOURS as readonly number[]).includes(h)),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { supabase, userId } = context;
    const db = await admin();
    const now = new Date();
    if (data.id) {
      const { data: cur } = await db.from("guest_ai_regional_situations").select(REG_BASE).eq("id", data.id).maybeSingle();
      if (!cur) throw new Error("Situação não encontrada.");
      const { requireMemberPermission } = await import("@/lib/member-permissions.server");
      if (cur.owner_id !== userId) await requireMemberPermission(supabase, userId, String(cur.owner_id), "chat_respond");
      const { error } = await db
        .from("guest_ai_regional_situations")
        .update({
          kind: data.kind,
          neighborhoods: data.neighborhoods || REGIONAL_DEFAULT_NEIGHBORHOODS,
          ai_text: data.aiText,
          expires_at: regionalExpiresAt(new Date(String(cur.starts_at)), data.hours as RegionalValidity),
          status: "active",
          updated_at: now.toISOString(),
        })
        .eq("id", data.id);
      if (error) throw new Error("Não foi possível salvar a situação.");
      return { id: data.id };
    }
    if (!data.conversationId) throw new Error("Conversa não informada.");
    const { prop } = await convOf(supabase, data.conversationId);
    await requireRespond(supabase, userId, data.conversationId);
    if (!prop?.owner_id || !prop.city) throw new Error("O imóvel desta conversa não tem cidade cadastrada.");
    // a sugestão desta conversa (se houver) vira a situação ativa
    const { data: sug } = await db
      .from("guest_ai_regional_situations")
      .select("id")
      .eq("source_conversation_id", data.conversationId)
      .eq("status", "suggested")
      .limit(1);
    const row = {
      owner_id: prop.owner_id,
      city: prop.city,
      kind: data.kind,
      neighborhoods: data.neighborhoods || REGIONAL_DEFAULT_NEIGHBORHOODS,
      ai_text: data.aiText,
      status: "active",
      starts_at: now.toISOString(),
      expires_at: regionalExpiresAt(now, data.hours as RegionalValidity),
      created_by: userId,
      updated_at: now.toISOString(),
    };
    const sid = ((sug ?? []) as Array<{ id: string }>)[0]?.id;
    if (sid) {
      const { error } = await db.from("guest_ai_regional_situations").update(row).eq("id", sid);
      if (error) throw new Error("Não foi possível marcar a situação.");
      return { id: sid };
    }
    const { data: ins, error } = await db
      .from("guest_ai_regional_situations")
      .insert({ ...row, source_conversation_id: data.conversationId })
      .select("id")
      .single();
    if (error || !ins) throw new Error("Não foi possível marcar a situação.");
    return { id: String(ins.id) };
  });

/** Encerrar a situação ativa ou dispensar a sugestão ("Agora Não"). */
export const closeRegionalSituation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, action: z.enum(["end", "dismiss"]) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context;
    const db = await admin();
    const { data: cur } = await db.from("guest_ai_regional_situations").select("id, owner_id, status").eq("id", data.id).maybeSingle();
    if (!cur) throw new Error("Situação não encontrada.");
    if (cur.owner_id !== userId) {
      const { requireMemberPermission } = await import("@/lib/member-permissions.server");
      await requireMemberPermission(supabase, userId, String(cur.owner_id), "chat_respond");
    }
    const patch =
      data.action === "end"
        ? { status: "ended", ended_by: userId, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        : { status: "dismissed", ended_by: userId, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { error } = await db.from("guest_ai_regional_situations").update(patch).eq("id", data.id);
    if (error) throw new Error("Não foi possível concluir.");
    return { ok: true };
  });

// ─────────────────────────── Aprendizados ───────────────────────────

export type LearningItem = {
  id: string;
  propertyId: string;
  propertyName: string;
  owner: string | null;
  statement: string;
  category: string;
  source: string;
  status: "pending" | "approved" | "rejected" | "revoked";
  createdAt: string;
  decidedAt: string | null;
  scope: "property" | "city" | "account";
  canApprove: boolean;
  /** "Aprendido com a resposta de Arthur a Larissa" (só com dado real; sem ele, o tipo de origem). */
  originText: string;
  /** Quando a fala de origem aconteceu (senão, quando o aprendizado nasceu). */
  originAt: string;
};

export type LearningCounts = { pending: number; approved: number; rejected: number };

/** Aprendizados da conta por situação (Pendentes · Aprovados · Recusados), réplicas de escopo fora. */
export const listLearnings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ status: z.enum(["pending", "approved", "rejected"]), accountOwnerId: uuid.nullish() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<{ items: LearningItem[]; counts: LearningCounts }> => {
    const { supabase, userId } = context;
    const empty = { items: [], counts: { pending: 0, approved: 0, rejected: 0 } };
    try {
      const ownerId = await accountScope(supabase, userId, data.accountOwnerId);
      const statuses = data.status === "rejected" ? ["rejected", "revoked"] : [data.status];
      const { data: rows } = await supabase
        .from("guest_ai_learning_entries")
        .select("id, owner_id, property_id, category, statement, source, status, created_at, decided_at, evidence_refs")
        .eq("owner_id", ownerId)
        .in("status", statuses)
        .order("created_at", { ascending: false })
        .limit(300);
      const isReplica = (refs: unknown) => Array.isArray(refs) && refs.some((x) => typeof x === "string" && x.startsWith("replica:"));
      const list = ((rows ?? []) as Array<Row>).filter((r) => !isReplica(r.evidence_refs));
      const props = await accountProperties(ownerId);
      const byId = new Map(props.map((p) => [p.id, p]));
      const { canApprove } = await import("@/lib/guest-ai-learning/silent.server");
      const can = await canApprove(await admin(), userId, ownerId);
      const { scopesFor } = await import("@/lib/guest-ai-learning/views.server");
      const scopes = await scopesFor(supabase, list.filter((r) => r.status === "approved").map((r) => ({ id: String(r.id), propertyId: String(r.property_id) })));
      // contagem das abas sem as réplicas de escopo (o filtro por prefixo do item do vetor é feito aqui)
      const { data: all } = await supabase
        .from("guest_ai_learning_entries")
        .select("status, evidence_refs")
        .eq("owner_id", ownerId)
        .in("status", ["pending", "approved", "rejected", "revoked"])
        .limit(10000);
      const originals = ((all ?? []) as Array<Row>).filter((r) => !isReplica(r.evidence_refs));
      const pending = originals.filter((r) => r.status === "pending").length;
      const approved = originals.filter((r) => r.status === "approved").length;
      const rejected = originals.filter((r) => r.status === "rejected" || r.status === "revoked").length;
      const origins = await learningOrigins(list);
      return {
        items: list.map((r) => ({
          id: String(r.id),
          propertyId: String(r.property_id),
          propertyName: byId.get(String(r.property_id))?.name ?? "Imóvel",
          owner: byId.get(String(r.property_id))?.owner ?? null,
          statement: String(r.statement),
          category: String(r.category),
          source: String(r.source),
          status: r.status,
          createdAt: String(r.created_at),
          decidedAt: r.decided_at ? String(r.decided_at) : null,
          scope: scopes.get(String(r.id))?.scope ?? "property",
          canApprove: can,
          originText: origins.get(String(r.id))?.text ?? SOURCE_ORIGIN[String(r.source)] ?? "Aprendido com a equipe",
          originAt: origins.get(String(r.id))?.at ?? String(r.created_at),
        })),
        counts: { pending, approved, rejected },
      };
    } catch {
      return empty;
    }
  });

const SOURCE_ORIGIN: Record<string, string> = {
  team_instruction: "Aprendido com uma instrução da equipe",
  checkout_done: "Aprendido com uma estadia concluída",
  incident_resolved: "Aprendido com um atendimento resolvido",
  guest_confirmation: "Aprendido com a confirmação de um hóspede",
};

const firstName = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] || null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Origem de cada aprendizado em palavras (mockup APR-D01): "Aprendido com a resposta de Arthur a Larissa" quando a
 * evidência é a fala da equipe; "Aprendido com a instrução de Arthur na conversa com Larissa" no Instruir a IA;
 * "Aprendido com a mensagem de Larissa" quando é a fala do hóspede. Sem o dado, fica o tipo de origem.
 */
async function learningOrigins(rows: Array<Row>): Promise<Map<string, { text: string; at: string }>> {
  const out = new Map<string, { text: string; at: string }>();
  const msgIds = new Set<string>();
  const convIds = new Set<string>();
  const userIds = new Set<string>();
  for (const r of rows) {
    for (const ref of (Array.isArray(r.evidence_refs) ? r.evidence_refs : []) as string[]) {
      if (UUID_RE.test(ref)) msgIds.add(ref);
      else if (ref.startsWith("instr:")) convIds.add(ref.slice(6));
      else if (ref.startsWith("by:")) userIds.add(ref.slice(3));
    }
  }
  if (!msgIds.size && !convIds.size) return out;
  const db = await admin();
  const msgs = new Map<string, Row>();
  if (msgIds.size) {
    const { data } = await db
      .from("property_chat_messages")
      .select("id, conversation_id, sender_type, sender_user_id, created_at")
      .in("id", [...msgIds]);
    for (const m of (data ?? []) as Array<Row>) {
      msgs.set(String(m.id), m);
      convIds.add(String(m.conversation_id));
      if (m.sender_user_id) userIds.add(String(m.sender_user_id));
    }
  }
  const guests = new Map<string, string | null>();
  if (convIds.size) {
    const { data } = await db.from("property_chat_conversations").select("id, guest_name").in("id", [...convIds]);
    for (const c of (data ?? []) as Array<Row>) guests.set(String(c.id), firstName(c.guest_name));
  }
  const people = new Map<string, string | null>();
  if (userIds.size) {
    const { data } = await db.from("profiles").select("id, full_name, trade_name").in("id", [...userIds]);
    for (const p of (data ?? []) as Array<Row>) people.set(String(p.id), firstName(p.full_name || p.trade_name));
  }
  for (const r of rows) {
    const refs = (Array.isArray(r.evidence_refs) ? r.evidence_refs : []) as string[];
    const instr = refs.find((x) => x.startsWith("instr:"));
    const by = refs.find((x) => x.startsWith("by:"));
    if (instr) {
      const who = by ? people.get(by.slice(3)) : null;
      const guest = guests.get(instr.slice(6));
      if (who && guest) out.set(String(r.id), { text: `Aprendido com a instrução de ${who} na conversa com ${guest}`, at: String(r.created_at) });
      continue;
    }
    const m = refs.map((x) => msgs.get(x)).find(Boolean);
    if (!m) continue;
    const guest = guests.get(String(m.conversation_id));
    if (m.sender_type === "human") {
      const who = m.sender_user_id ? people.get(String(m.sender_user_id)) : null;
      if (who && guest) out.set(String(r.id), { text: `Aprendido com a resposta de ${who} a ${guest}`, at: String(m.created_at) });
    } else if (m.sender_type === "guest" && guest) {
      out.set(String(r.id), { text: `Aprendido com a mensagem de ${guest}`, at: String(m.created_at) });
    }
  }
  return out;
}

/** Aprovar · Só Desta Vez (recusa pontual) · Desfazer (revogar). Permissão conferida pela própria RPC. */
export const reviewLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, action: z.enum(["approve", "reject", "revoke"]) }).parse(d))
  .handler(async ({ data, context }): Promise<{ status: string }> => {
    const note = data.action === "reject" ? "Só desta vez" : data.action === "revoke" ? "Desfeito pela equipe" : "Aprovado em Aprendizados";
    const { data: st, error } = await context.supabase.rpc("guest_ai_learning_review", { p_id: data.id, p_action: data.action, p_note: note });
    if (error) {
      const m = String(error.message ?? "");
      throw new Error(m.includes("not_authorized") ? "Só o titular ou quem treina a IA pode decidir aprendizados." : "Não foi possível concluir.");
    }
    return { status: String(st) };
  });

/** Editar o texto de um aprendizado ainda pendente (mesma permissão de aprovar). */
export const editLearning = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, statement: z.string().trim().min(15).max(400) }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const db = await admin();
    const { data: e } = await db.from("guest_ai_learning_entries").select("id, owner_id, status, property_id, category").eq("id", data.id).maybeSingle();
    if (!e) throw new Error("Aprendizado não encontrado.");
    const { canApprove } = await import("@/lib/guest-ai-learning/silent.server");
    if (!(await canApprove(db, context.userId, e.owner_id ?? null))) throw new Error("Só o titular ou quem treina a IA pode editar aprendizados.");
    if (e.status !== "pending") throw new Error("Só um aprendizado pendente pode ser editado.");
    const { evaluateCandidate } = await import("@/lib/guest-ai/learning/learning");
    const v = evaluateCandidate({
      propertyId: String(e.property_id),
      category: String(e.category),
      statement: data.statement,
      evidence: { source: "team_instruction", propertyId: String(e.property_id), refs: ["edit"], closed: true },
    });
    if (!v.ok) throw new Error("O texto precisa ser um fato duradouro do imóvel, sem datas, horários, nomes ou senhas.");
    const { error } = await db.from("guest_ai_learning_entries").update({ statement: data.statement }).eq("id", data.id).eq("status", "pending");
    if (error) throw new Error("Não foi possível salvar.");
    return { ok: true };
  });

/** Vale Para (Imóvel · Cidade · Conta): só para aprendizado aprovado (réplicas nos imóveis do escopo). */
export const setLearningScopeFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: uuid, scope: z.enum(["property", "city", "account"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { setLearningScope } = await import("@/lib/guest-ai-learning/silent.server");
    try {
      return await setLearningScope({ entryId: data.id, userId: context.userId, scope: data.scope });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      throw new Error(m === "invalid_transition" ? "Aprove o aprendizado antes de mudar onde ele vale." : m === "not_authorized" ? "Sem permissão para ajustar aprendizados." : "Não foi possível ajustar.");
    }
  });
