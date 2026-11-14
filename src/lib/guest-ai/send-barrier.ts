/**
 * BARREIRA PRÉ-ENVIO ("disjuntor anti-atropelamento") — 14/11/2026, caso Jayr (Apê a 2 km do Centro).
 *
 * A geração leva de 4 a 10 s. Nesse intervalo o mundo muda: o anfitrião pode responder no Airbnb, a equipe pode
 * assumir a conversa no painel, o hóspede pode mandar outra mensagem, outro turno pode já ter respondido. A
 * checagem antiga só olhava mensagem NOVA DO HÓSPEDE; a IA falou por cima do atendente humano.
 *
 * Função PURA (sem banco, rede nem relógio): o canal lê o estado e pergunta aqui se ainda pode falar.
 * Regras:
 *  - qualquer mensagem do HÓSPEDE mais nova que o gatilho  ⇒ aborta (a mais nova responde o bloco);
 *  - qualquer mensagem HUMANA (anfitrião/equipe) mais nova ⇒ aborta (a fala humana prevalece);
 *  - qualquer mensagem da IA mais nova (outro turno já respondeu) ⇒ aborta (sem resposta duplicada);
 *  - conversa assumida (`status = assigned`) ou com pausa humana vigente ⇒ aborta;
 *  - mensagem de SISTEMA/programada (boas-vindas, lembretes) NÃO bloqueia: não indica que alguém esteja atendendo
 *    a pergunta do hóspede, e calar a IA por causa dela deixaria a pergunta sem resposta;
 *  - nota interna da equipe nunca conta como fala ao hóspede;
 *  - leitura do estado falhou (`rowsAfter`/`conversation` nulos) ⇒ aborta com `unknown_state`: na dúvida sobre
 *    haver um humano na conversa, a IA NÃO fala e o canal encaminha à equipe.
 */
export interface BarrierMessageRow {
  id: string;
  created_at: string | null;
  role?: string | null;
  sender_type?: string | null;
  is_internal_note?: boolean | null;
}

export interface BarrierConversationRow {
  status: string | null;
  ai_paused?: boolean | null;
  paused_until?: string | null;
  assigned_to?: string | null;
}

export type BarrierReason =
  | "newer_guest_message"
  | "human_message"
  | "newer_ai_message"
  | "human_ownership"
  | "unknown_state";

export type BarrierVerdict = { abort: false } | { abort: true; reason: BarrierReason };

export interface BarrierInput {
  /** Mensagem do hóspede que disparou o turno. */
  triggerId: string;
  triggerCreatedAt: string | null;
  /** Mensagens da conversa mais novas que o gatilho (`null` = leitura falhou). */
  rowsAfter: readonly BarrierMessageRow[] | null;
  /** Estado atual da conversa (`null` = leitura falhou). */
  conversation: BarrierConversationRow | null;
  /** Resultado de `resolvePause` agora (`true` = equipe atendendo; `null` = incerto). */
  pausedNow: boolean | null;
}

/** Forma de porta pedida pelas diretivas: `{ allowed, reason }` (mesma decisão de `evaluateSendBarrier`). */
export type BarrierGate = { allowed: true } | { allowed: false; reason: BarrierReason };
export const barrierGate = (v: BarrierVerdict): BarrierGate => (v.abort ? { allowed: false, reason: v.reason } : { allowed: true });

/** Motivos em que um HUMANO está (ou esteve) falando: o canal não toca na conversa nem avisa a equipe de novo. */
/** Humano = `human`/`staff`/`host`, ou qualquer `assistant` que não seja IA nem sistema/programada (fail-closed). */
const NON_HUMAN_SENDERS = new Set(["guest", "ai", "system", "programmed", "internal_note"]);
function isHumanSender(r: { role?: string | null; sender_type?: string | null }): boolean {
  const st = r.sender_type ?? "";
  if (st === "human" || st === "staff" || st === "host") return true;
  return r.role === "assistant" && !NON_HUMAN_SENDERS.has(st) && st !== "";
}

export const HUMAN_BARRIER_REASONS: ReadonlySet<BarrierReason> = new Set(["human_message", "human_ownership"]);

export function evaluateSendBarrier(i: BarrierInput): BarrierVerdict {
  if (!i.conversation || i.rowsAfter === null) return { abort: true, reason: "unknown_state" };

  const status = (i.conversation.status ?? "").toLowerCase();
  // humano tem prioridade sobre qualquer outro motivo: é o que mais importa não atropelar
  if (i.rowsAfter.some((r) => !r.is_internal_note && r.id !== i.triggerId && isHumanSender(r))) {
    return { abort: true, reason: "human_message" };
  }
  if (status === "assigned" || i.pausedNow === true) return { abort: true, reason: "human_ownership" };
  if (i.pausedNow === null) return { abort: true, reason: "unknown_state" };

  const visible = i.rowsAfter.filter((r) => !r.is_internal_note && r.id !== i.triggerId);
  if (visible.some((r) => r.sender_type === "guest" && (r.role ?? "user") === "user")) {
    return { abort: true, reason: "newer_guest_message" };
  }
  if (visible.some((r) => r.sender_type === "ai")) return { abort: true, reason: "newer_ai_message" };
  return { abort: false };
}

/**
 * Lê o que a barreira precisa: mensagens mais novas que o gatilho, estado da conversa e pausa vigente.
 * `admin` e `resolvePause` vêm do canal (este módulo não importa banco). Falha de leitura devolve `null` no campo
 * correspondente: a barreira trata como estado incerto, NUNCA como "livre".
 */
export async function readSendBarrierState(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  conversationId: string,
  trigger: { id?: string; created_at?: string } | null,
  resolvePause: (row: BarrierConversationRow) => Promise<boolean>,
): Promise<Pick<BarrierInput, "rowsAfter" | "conversation" | "pausedNow">> {
  if (!trigger?.id || !trigger.created_at) return { rowsAfter: null, conversation: null, pausedNow: null };
  let rowsAfter: BarrierMessageRow[] | null = null;
  let conversation: BarrierConversationRow | null = null;
  let pausedNow: boolean | null = null;
  try {
    const [msgs, conv] = await Promise.all([
      admin
        .from("property_chat_messages")
        .select("id, created_at, role, sender_type, is_internal_note")
        .eq("conversation_id", conversationId)
        .gte("created_at", trigger.created_at)
        .neq("id", trigger.id)
        .limit(50),
      admin.from("property_chat_conversations").select("id, status, ai_paused, paused_until, assigned_to").eq("id", conversationId).maybeSingle(),
    ]);
    if (!msgs?.error && Array.isArray(msgs?.data)) rowsAfter = msgs.data as BarrierMessageRow[];
    if (!conv?.error && conv?.data) conversation = conv.data as BarrierConversationRow;
  } catch {
    return { rowsAfter: null, conversation: null, pausedNow: null };
  }
  if (conversation) {
    try {
      pausedNow = await resolvePause(conversation);
    } catch {
      pausedNow = null;
    }
  }
  return { rowsAfter, conversation, pausedNow };
}
