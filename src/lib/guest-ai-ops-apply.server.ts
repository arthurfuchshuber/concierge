/**
 * GATE G2c · ESCRITA REAL das ações operacionais da IA nos cards (`guest_arrival_status`). Só servidor.
 *
 * Fica FORA de `src/lib/guest-ai/` de propósito: aquele módulo é somente leitura (só RPCs de auditoria em
 * lista fechada). A decisão de agir é da política determinística (`guest-ai/ops/policy.ts`); aqui só se
 * executa, sempre com as MESMAS rotinas do painel — nenhum caminho paralelo de escrita:
 *  - `checkin_done` / `checkout_done`: `runAdvanceArrival(admin, …, { origin: "ai" })`, com todas as travas
 *    do painel (no-show, estadia anterior aberta, fechar a estadia no checkout, limpeza vencida, avisos);
 *  - `early_departure`: concluída pelo mesmo avanço e, em seguida, o card de saída é puxado para HOJE
 *    (`arrival_date_override`, com a data original em `arrival_date_base`, como no formulário do guia);
 *  - `eta_*`: `arrival_time_override` com `arrival_time_source = 'guest_ai'` (no card de SAÍDA a baixa
 *    automática acontece nesse horário, sem nunca passar do corte oficial/late formal — 08/11/2026). Escrita CONDICIONAL: nunca sobre previsão da equipe (`staff`), conferido no próprio UPDATE.
 *    Vale a informação mais recente entre o chat e o guia: o guia grava `guest` por cima, a IA grava
 *    `guest_ai` por cima de `guest`/`guest_ai`.
 *  - `late_checkout`: concessão expressa de atendente humano no chat ⇒ `internal_set_late_checkout` em nome
 *    do próprio atendente (o banco confere a permissão e grava autor/momento).
 * Nunca lança: erro vira código fechado. Nenhum texto do hóspede passa por aqui.
 */
import { GUEST_AI_ARRIVAL_SOURCE } from "@/lib/guest-ai/ops/contracts";
import type { OpsApplyPortRequest, OpsApplyPortResult } from "@/lib/guest-ai/ops/executor.server";

/** Mesmo contrato da porta `apply` do executor (fonte única do formato do pedido e do resultado). */
export type OpsApplyRequest = OpsApplyPortRequest;
export type OpsCardSnapshot = Record<string, unknown> & { exists: boolean };
export type OpsApplyResult =
  { ok: true; cardAfter: OpsCardSnapshot } | Extract<OpsApplyPortResult, { ok: false }>;

/** Cliente com a superfície usada aqui (na produção, o administrativo). */
interface Db {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ error: { message?: string } | null }>;
}
type Advance = (
  db: never,
  data: { reservationId: string; from: "checkin" | "checkout" },
  opts: { origin: "ai" },
) => Promise<unknown>;

export interface OpsApplyDeps {
  db?: Db;
  advance?: Advance;
}

const SNAPSHOT_COLUMNS =
  "status, done_at, concluded_at, arrival_time_override, arrival_time_source, arrival_date_override, note, late_checkout_time, late_checkout_approved_at, late_checkout_by";

async function snapshot(
  db: Db,
  reservationId: string,
  kind: "checkin" | "checkout",
): Promise<OpsCardSnapshot> {
  const { data } = await db
    .from("guest_arrival_status")
    .select(SNAPSHOT_COLUMNS)
    .eq("reservation_id", reservationId)
    .eq("kind", kind)
    .limit(1);
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  return row ? { exists: true, ...row } : { exists: false };
}

/** Grava (ou cria) campos do card da reserva sem tocar nos demais. */
async function patchCard(
  db: Db,
  req: { propertyId: string; reservationId: string },
  kind: "checkin" | "checkout",
  patch: Record<string, unknown>,
) {
  const { data, error } = await db
    .from("guest_arrival_status")
    .update(patch)
    .eq("reservation_id", req.reservationId)
    .eq("kind", kind)
    .select("id");
  if (error) throw new Error("update_failed");
  if (Array.isArray(data) && data.length > 0) return;
  const ins = await db
    .from("guest_arrival_status")
    .insert({ property_id: req.propertyId, reservation_id: req.reservationId, kind, ...patch });
  if (ins.error) throw new Error("insert_failed");
}

async function applyEta(
  db: Db,
  req: Extract<OpsApplyRequest, { action: "eta_checkin" | "eta_checkout" }>,
): Promise<OpsApplyResult> {
  const kind = req.action === "eta_checkin" ? "checkin" : "checkout";
  const patch = { arrival_time_override: req.time, arrival_time_source: GUEST_AI_ARRIVAL_SOURCE };
  // a informação mais recente do hóspede vale, mesmo sobre previsão da equipe (diretriz 07/11/2026)
  const upd = await db
    .from("guest_arrival_status")
    .update(patch)
    .eq("reservation_id", req.reservationId)
    .eq("kind", kind)
    .select("id");
  if (upd.error) return { ok: false, code: "apply_failed" };
  if (!(Array.isArray(upd.data) && upd.data.length > 0)) {
    const ins = await db
      .from("guest_arrival_status")
      .insert({ property_id: req.propertyId, reservation_id: req.reservationId, kind, ...patch });
    if (ins.error) return { ok: false, code: "apply_failed" };
  }
  return { ok: true, cardAfter: await snapshot(db, req.reservationId, kind) };
}

/**
 * Late checkout concedido por atendente humano no chat: grava pelo caminho interno oficial
 * (`internal_set_late_checkout`, service_role) EM NOME DO ATENDENTE que enviou a mensagem. O trigger
 * `guard_stay_authorizations` confere se ele pode autorizar (`can_manage_stay_authorizations`), exige horário
 * depois do oficial, grava autor e momento, e o histórico vai para `audit_logs`. Nenhuma autoria é inventada:
 * sem remetente humano identificado na própria mensagem, nada é gravado.
 */
async function applyLateCheckout(
  db: Db,
  req: Extract<OpsApplyRequest, { action: "late_checkout" }>,
): Promise<OpsApplyResult> {
  const msg = await db
    .from("property_chat_messages")
    .select("sender_user_id, sender_type, role, is_internal_note")
    .eq("id", req.staffMessageId)
    .eq("conversation_id", req.conversationId)
    .maybeSingle();
  if (msg.error) return { ok: false, code: "apply_failed" };
  const m = msg.data as Record<string, unknown> | null;
  const actor =
    m && typeof m["sender_user_id"] === "string" ? (m["sender_user_id"] as string) : null;
  if (
    !m ||
    !actor ||
    m["sender_type"] !== "human" ||
    m["role"] !== "assistant" ||
    m["is_internal_note"] === true
  )
    return { ok: false, code: "staff_author_unknown" };

  const found = await db
    .from("guest_arrival_status")
    .select("id")
    .eq("reservation_id", req.reservationId)
    .eq("kind", "checkout")
    .limit(1);
  if (found.error) return { ok: false, code: "apply_failed" };
  let cardId = (found.data as Array<{ id?: unknown }> | null)?.[0]?.id;
  if (typeof cardId !== "string") {
    const ins = await db
      .from("guest_arrival_status")
      .insert({ property_id: req.propertyId, reservation_id: req.reservationId, kind: "checkout" })
      .select("id");
    cardId = (ins.data as Array<{ id?: unknown }> | null)?.[0]?.id;
    if (ins.error || typeof cardId !== "string") return { ok: false, code: "apply_failed" };
  }
  const r = await db.rpc("internal_set_late_checkout", {
    _arrival_status_id: cardId,
    _actor: actor,
    _time: req.time,
  });
  if (r.error) {
    const e = r.error.message ?? "";
    if (/late_checkout_(forbidden|requires_identity)|internal_actor_required/.test(e))
      return { ok: false, code: "staff_not_authorized" };
    if (
      /late_checkout_(must_be_after_official|requires_official_checkout|invalid_time|checkout_only)/.test(
        e,
      )
    )
      return { ok: false, code: "late_checkout_rejected" };
    return { ok: false, code: "apply_failed" };
  }
  return { ok: true, cardAfter: await snapshot(db, req.reservationId, "checkout") };
}

export async function applyOpsAction(
  req: OpsApplyRequest,
  deps: OpsApplyDeps = {},
): Promise<OpsApplyResult> {
  try {
    const db =
      deps.db ??
      ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Db);
    if (req.action === "eta_checkin" || req.action === "eta_checkout")
      return await applyEta(db, req);
    if (req.action === "late_checkout") return await applyLateCheckout(db, req);
    const advance =
      deps.advance ??
      ((await import("@/lib/dashboard.functions")).runAdvanceArrival as unknown as Advance);
    const kind = req.action === "checkin_done" ? "checkin" : "checkout";
    try {
      await advance(
        db as never,
        { reservationId: req.reservationId, from: kind },
        { origin: "ai" },
      );
    } catch {
      // as travas do painel recusaram (ex.: estadia anterior ainda aberta no imóvel); nada a forçar
      return { ok: false, code: "panel_refused" };
    }
    if (req.action === "early_departure") {
      // saída antecipada: depois da baixa, o card de saída passa a ser de HOJE (data original em
      // `arrival_date_base`). Só depois do avanço: uma recusa do painel nunca deixa o card com data trocada.
      try {
        await patchCard(db, req, "checkout", {
          arrival_date_override: req.today,
          arrival_date_base: req.checkoutDate,
        });
      } catch {
        console.error("[guest-ai-ops] saída antecipada concluída, data do card não ajustada");
      }
    }
    return { ok: true, cardAfter: await snapshot(db, req.reservationId, kind) };
  } catch {
    return { ok: false, code: "apply_failed" };
  }
}
