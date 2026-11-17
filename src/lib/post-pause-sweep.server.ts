/**
 * VARREDURA PÓS-PAUSA (16/11/2026, titular: "assim que a pausa acabar a IA já assume a conversa").
 *
 * Problema: o hóspede escreve enquanto a pausa humana (10 min) está vigente. O webhook só registra e avisa a equipe;
 * passada a pausa nada reabria o turno, e a mensagem ficava sem resposta até o hóspede escrever de novo. Aqui, a cada
 * poucos minutos, a IA volta nessas mensagens, lendo a conversa inteira (inclusive o que a equipe disse na pausa).
 *
 * Quando uma conversa é elegível (tudo precisa valer; `planPostPauseSweep` é PURA):
 *  - a ÚLTIMA mensagem da conversa é do hóspede (ninguém, humano ou IA, falou depois dela);
 *  - antes dela houve fala HUMANA, e a mensagem chegou DENTRO da janela de pausa dessa fala (humano + 10 min);
 *  - a janela já venceu há pelo menos `graceMs` e no máximo `maxAgeMs` (não responde conversa velha);
 *  - ainda não houve turno da IA depois da pausa (nenhuma geração criada depois do fim da janela).
 * Tudo o mais (posse humana, chamado aberto, decisão pendente, barreira pré-envio, tetos de custo, chave
 * `GUEST_AI_AUTONOMOUS`, anúncio com a IA ligada) é decidido pelo MESMO turno do webhook (`runAirbnbAiTurn`).
 *
 * A sugestão que o IA gerou DURANTE a pausa (não enviada, para a equipe) é descartada antes: o banco só aceita
 * uma geração por mensagem, e a nova precisa ler o contexto atual. Nunca lança; nunca fala sem passar pela barreira.
 * Desligável com GUEST_AI_POST_PAUSE_SWEEP=off.
 */
import { HUMAN_PAUSE_WINDOW_MS } from "@/lib/guest-ai/policy/human-pause";

export interface SweepMessage {
  id: string;
  role: string | null;
  sender_type: string | null;
  created_at: string | null;
  is_internal_note?: boolean | null;
}

export interface SweepConfig {
  enabled: boolean;
  /** Folga depois do fim da pausa (evita correr com uma fala humana ainda a caminho). */
  graceMs: number;
  /** Mensagens esperando há mais que isto (após o fim da pausa) não são retomadas. */
  maxAgeMs: number;
  /** Máximo de conversas por execução (cada turno leva segundos). */
  perRun: number;
}

export function sweepConfig(env: Record<string, string | undefined> = process.env): SweepConfig {
  const num = (k: string, d: number, lo: number, hi: number) => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : d;
  };
  return {
    enabled: env["GUEST_AI_POST_PAUSE_SWEEP"] !== "off",
    graceMs: num("GUEST_AI_POST_PAUSE_GRACE_SEC", 30, 0, 600) * 1000,
    maxAgeMs: num("GUEST_AI_POST_PAUSE_MAX_AGE_MIN", 180, 5, 1440) * 60_000,
    perRun: num("GUEST_AI_POST_PAUSE_PER_RUN", 3, 1, 10),
  };
}

export interface SweepPlan {
  /** Mensagem do hóspede a responder. */
  triggerId: string;
  triggerCreatedAt: string;
  /** Fim da janela de pausa (última fala humana + 10 min). */
  pauseEndsAt: string;
}

const ms = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

const isGuest = (m: SweepMessage) => m.role === "user" && m.sender_type === "guest";
const isHuman = (m: SweepMessage) => m.sender_type === "human" && m.role === "assistant";

/**
 * Decisão PURA. `messages` = mensagens da conversa (qualquer ordem). `generationsCreatedAt` = instantes de criação das
 * gerações (sugestões) da mensagem-gatilho, para saber se a IA já teve a vez depois da pausa.
 */
export function planPostPauseSweep(
  messages: readonly SweepMessage[],
  generationsCreatedAt: (triggerId: string) => readonly string[],
  nowMs: number,
  cfg: SweepConfig,
): SweepPlan | null {
  if (!cfg.enabled) return null;
  const rows = messages
    .filter((m) => m.is_internal_note !== true && m.sender_type !== "internal_note")
    .map((m) => ({ m, t: ms(m.created_at) }))
    .filter((r): r is { m: SweepMessage; t: number } => r.t !== null)
    .sort((a, b) => a.t - b.t || (a.m.id < b.m.id ? -1 : 1));
  if (!rows.length) return null;
  const last = rows[rows.length - 1]!;
  if (!isGuest(last.m)) return null; // alguém (humano, IA ou sistema) já falou depois do hóspede
  const humans = rows.filter((r) => isHuman(r.m));
  if (!humans.length) return null;
  const lastHuman = humans[humans.length - 1]!;
  if (lastHuman.t >= last.t) return null;
  const pauseEnd = lastHuman.t + HUMAN_PAUSE_WINDOW_MS;
  if (last.t > pauseEnd) return null; // chegou depois da pausa: o webhook já deu o turno normal à IA
  const waited = nowMs - pauseEnd;
  if (waited < cfg.graceMs || waited > cfg.maxAgeMs) return null;
  // a IA já teve a vez depois da pausa (geração criada depois do fim da janela)?
  if (generationsCreatedAt(last.m.id).some((c) => (ms(c) ?? 0) >= pauseEnd)) return null;
  return { triggerId: last.m.id, triggerCreatedAt: last.m.created_at as string, pauseEndsAt: new Date(pauseEnd).toISOString() };
}

export interface SweepResult {
  checked: number;
  eligible: number;
  answered: number;
  skipped: number;
}

export interface SweepDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db?: any;
  now?: () => number;
  env?: Record<string, string | undefined>;
  /** Teste: substitui o turno real da IA. */
  runTurn?: (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    turn: import("@/lib/channex-messages.server").AirbnbAiTurn,
  ) => Promise<void>;
}

export async function runPostPauseSweep(deps: SweepDeps = {}): Promise<SweepResult> {
  const res: SweepResult = { checked: 0, eligible: 0, answered: 0, skipped: 0 };
  try {
    const cfg = sweepConfig(deps.env ?? process.env);
    if (!cfg.enabled) return res;
    const db = deps.db ?? (await import("@/integrations/supabase/client.server")).supabaseAdmin;
    const nowMs = (deps.now ?? Date.now)();
    // só conversas com movimento dentro da janela máxima (+ a própria pausa)
    const since = new Date(nowMs - cfg.maxAgeMs - 2 * HUMAN_PAUSE_WINDOW_MS).toISOString();
    const { data: convs } = await db
      .from("property_chat_conversations")
      .select("id, property_id, status, assigned_to, guest_name, guest_session_id, ai_paused, paused_until")
      .like("guest_session_id", "airbnb:%")
      .in("status", ["ai", "assigned"])
      .gte("last_message_at", since)
      .order("last_message_at", { ascending: false })
      .limit(100);
    const rows = (convs ?? []) as Array<{
      id: string;
      property_id: string;
      status: string | null;
      assigned_to: string | null;
      guest_name: string | null;
      guest_session_id: string | null;
      ai_paused: boolean | null;
      paused_until: string | null;
    }>;
    res.checked = rows.length;

    for (const c of rows) {
      if (res.answered + res.skipped >= cfg.perRun) break;
      // conversa assumida por uma PESSOA no painel: não é resíduo do Airbnb, a IA não retoma
      if ((c.status ?? "").toLowerCase() === "assigned" && c.assigned_to) continue;
      try {
        const { data: msgs } = await db
          .from("property_chat_messages")
          .select("id, role, sender_type, created_at, is_internal_note")
          .eq("conversation_id", c.id)
          .order("created_at", { ascending: false })
          .limit(60);
        const list = (msgs ?? []) as SweepMessage[];
        // só consulta as gerações quando a conversa já passou nos filtros baratos
        const cheap = planPostPauseSweep(list, () => [], nowMs, cfg);
        if (!cheap) continue;
        const { data: gens } = await db
          .from("guest_ai_turns")
          .select("created_at")
          .eq("conversation_id", c.id)
          .eq("trigger_message_id", cheap.triggerId);
        const created = ((gens ?? []) as Array<{ created_at: string | null }>).map((g) => g.created_at ?? "");
        const plan = planPostPauseSweep(list, () => created, nowMs, cfg);
        if (!plan) continue;
        res.eligible++;

        // pausa ainda vigente por outra via (coluna) ⇒ não é hora
        const { resolvePause, shouldReleaseHostTakeover } = await import("@/lib/chat/pause");
        const paused = await resolvePause(db, c.id, c as never);
        if (paused) continue;
        const { data: prop } = await db.from("properties").select("name, owner_id").eq("id", c.property_id).maybeSingle();
        const { data: listing } = await db.from("property_listing_raw_data").select("airbnb_ai_enabled").eq("property_id", c.property_id);
        const aiOn = ((listing ?? []) as Array<{ airbnb_ai_enabled: boolean | null }>).some((l) => l.airbnb_ai_enabled === true);
        if (!prop || !aiOn) continue;
        if (shouldReleaseHostTakeover(c as never, paused)) {
          await db.from("property_chat_conversations").update({ status: "ai" }).eq("id", c.id).eq("status", "assigned").is("assigned_to", null);
        }
        // descarta a sugestão da pausa (não enviada); a geração nova lê o contexto de agora. O papel de serviço só LÊ
        // a tabela, então o descarte é uma função do banco. Sem descartar não há turno: o banco só aceita uma geração
        // por mensagem e a IA cairia na contingência (encaminhamento à equipe).
        const rel = await db.rpc("guest_ai_release_unsent_turn", {
          p_conversation_id: c.id,
          p_trigger_message_id: plan.triggerId,
          p_before: plan.pauseEndsAt,
        });
        if (rel?.error) throw new Error("release_failed");
        const { data: left } = await db
          .from("guest_ai_turns")
          .select("created_at")
          .eq("conversation_id", c.id)
          .eq("trigger_message_id", plan.triggerId);
        if (Array.isArray(left) && left.length > 0) throw new Error("suggestion_still_there");

        const { data: trig } = await db.from("property_chat_messages").select("content").eq("id", plan.triggerId).maybeSingle();
        const threadId = (c.guest_session_id ?? "").replace(/^airbnb:/, "");
        if (!threadId) continue;
        const turn = {
          convId: c.id,
          threadId,
          guestName: c.guest_name,
          guestContent: ((trig as { content?: string | null } | null)?.content ?? "") as string,
          propertyId: c.property_id,
          ownerId: ((prop as { owner_id?: string | null }).owner_id ?? null) as string | null,
          propertyName: ((prop as { name?: string | null }).name ?? "") as string,
          guestMessageId: plan.triggerId,
          guestCreatedAt: plan.triggerCreatedAt,
        };
        // mesmo disparo do webhook (17/11/2026): turno em requisição própria, com o prazo longo; falhou ⇒ roda aqui
        const run =
          deps.runTurn ??
          (async (d, t) => {
            await (await import("@/lib/channex-messages.server")).dispatchAirbnbAiTurn(d, t);
          });
        await run(db, turn);
        res.answered++;
      } catch (e) {
        res.skipped++;
        console.error("[post-pause-sweep] conversa falhou", e instanceof Error ? e.name : "erro");
      }
    }
  } catch (e) {
    console.error("[post-pause-sweep] falhou", e instanceof Error ? e.name : "erro");
  }
  return res;
}
