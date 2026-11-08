// Server-only: confirmação automática de checkout no corte oficial do imóvel (ou late checkout formal).
// Importar somente dentro de handlers (server routes / server functions).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { propertyTimeZone, zonedTimeToUtc } from "@/lib/property-timezone";

type Admin = SupabaseClient<Database>;

/**
 * Resolve `logId`/`reservationId` pro formato que `runAdvanceArrival` espera
 * a partir de um `ArrivalRow`. Mesmo critério de `statusTarget` (em
 * `OperationWorkspace.tsx`): `logId` só é aceito quando é um UUID real de
 * `guide_access_logs` — uma reserva sem formulário do hóspede usa a chave
 * sintética "ical:<reservation_id>" (nome histórico) no lugar de um log de
 * verdade, e nesse caso é o `reservation_id` embutido que deve ser usado.
 */
function resolveTarget(row: { logId: string; reservationId: string | null }): {
  logId?: string;
  reservationId?: string;
} {
  const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
  const reservationId =
    row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : undefined);
  return { logId, reservationId: reservationId ?? undefined };
}

/** "15:00" | "15:00:00" → [horas, minutos], ou null se não for um horário válido. */
function parseHm(value: string | null): [number, number] | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mi)) return null;
  return [h, mi];
}

/**
 * Confirma automaticamente o checkout de um card de saída pendente no CORTE OFICIAL do imóvel. Roda por cron
 * (`cron.auto-checkout`, a cada 5 minutos) — não depende de ninguém abrir o app.
 *
 * REGRA (diretriz definitiva de produto, 06/11/2026 — Gate G2c). A baixa automática tem UM gatilho só:
 *   · no dia da saída CONFIRMADA da reserva, ao atingir o horário limite oficial de checkout do imóvel
 *     (`properties.checkout_time`, que chega aqui como `standardTime`), no fuso do imóvel;
 *   · única exceção: late checkout FORMALMENTE autorizado pela equipe no card de checkout
 *     (`late_checkout_time` + `late_checkout_approved_at` + `late_checkout_by`, os três preenchidos — gravados
 *     só pelo trigger `guard_stay_authorizations`, que confere a permissão de quem autorizou). Aí o corte é o
 *     horário autorizado.
 * O antigo "gatilho 1" (confirmar ao alcançar o horário PREVISTO, `arrival_time_override`) foi descontinuado:
 * a previsão NUNCA antecipa a baixa. Única influência: horário definido pela EQUIPE (`arrival_time_source =
 * 'staff'`) MAIOR que o oficial estende o corte até esse horário (08/11/2026); o do hóspede (`guest`) ou da IA
 * (`guest_ai`) é só informativo. Uma data prevista diferente (`arrival_date_override`) também não
 * antecipa nada: saída antes do dia confirmado só com confirmação factual (hóspede no chat/guia ou equipe).
 * Pedido de hóspede ou da IA nunca estende o corte: só a equipe concede late checkout.
 *
 * O fuso é o do IMÓVEL (`propertyTimeZone`) — o mesmo do guia do hóspede, nunca um fuso fixo de servidor.
 * A ação reaproveita `runAdvanceArrival` — a MESMA lógica do clique manual em "Confirmar checkout" (libera o
 * imóvel, entra na fila de limpeza, avisa os prestadores) — com `supabaseAdmin`, já que não há usuário logado
 * por trás de um cron. O "silenciar" do card (`mutedUntil`) NÃO afeta esta rotina.
 */
/** Late checkout formal do card de saída (os três campos da autorização R6). */
export interface FormalLateCheckout {
  time: string | null;
  approvedAt: string | null;
  by: string | null;
}

/**
 * Horário (fuso do imóvel) do corte automático de um card de saída pendente; `null` = só manual.
 * Late checkout só conta com os três campos da autorização formal preenchidos; senão vale o oficial.
 */
export function autoCheckoutTriggerTime(r: {
  standardTime?: string | null;
  lateCheckout?: FormalLateCheckout | null;
  /** Horário definido no card (previsão). Só a EQUIPE (`arrivalTimeSource === "staff"`) estende o corte. */
  arrivalTimeOverride?: string | null;
  arrivalTimeSource?: string | null;
}): [number, number] | null {
  const late = r.lateCheckout;
  const formal = late && late.time && late.approvedAt && late.by ? parseHm(late.time) : null;
  if (formal) return formal; // late checkout formal (R6) manda
  const standard = parseHm(r.standardTime ?? null);
  // Horário definido pela EQUIPE MAIOR que o oficial estende o corte; menor nunca antecipa.
  // Hóspede (`guest`) e IA (`guest_ai`) continuam só informativos.
  const staff = r.arrivalTimeSource === "staff" ? parseHm(r.arrivalTimeOverride ?? null) : null;
  if (staff && standard && staff[0] * 60 + staff[1] > standard[0] * 60 + standard[1]) return staff;
  return standard;
}

/**
 * Lê de uma vez as autorizações formais de late checkout (R6) dos imóveis e devolve a busca por card;
 * `null` = a leitura falhou (quem chama não deve agir às cegas). Usado pela baixa automática e pelo aviso
 * de "Check-Out Atrasado", para os dois enxergarem o MESMO corte.
 */
export async function loadFormalLateCheckouts(
  admin: Admin,
  propIds: string[],
): Promise<((row: { logId: string; reservationId: string | null }) => FormalLateCheckout | null) | null> {
  const byKey = new Map<string, FormalLateCheckout>();
  if (propIds.length === 0) return () => null;
  const { data, error } = await admin
    .from("guest_arrival_status")
    .select("reservation_id, log_id, late_checkout_time, late_checkout_approved_at, late_checkout_by")
    .eq("kind", "checkout")
    .not("late_checkout_time", "is", null)
    .in("property_id", propIds);
  if (error) return null;
  for (const l of (data ?? []) as Array<{
    reservation_id: string | null;
    log_id: string | null;
    late_checkout_time: string | null;
    late_checkout_approved_at: string | null;
    late_checkout_by: string | null;
  }>) {
    const v = { time: l.late_checkout_time, approvedAt: l.late_checkout_approved_at, by: l.late_checkout_by };
    if (l.reservation_id) byKey.set(`r:${l.reservation_id}`, v);
    if (l.log_id) byKey.set(`l:${l.log_id}`, v);
  }
  return (row) => {
    const t = resolveTarget(row);
    return (
      (t.reservationId ? byKey.get(`r:${t.reservationId}`) : undefined) ??
      (t.logId ? byKey.get(`l:${t.logId}`) : undefined) ??
      null
    );
  };
}

/** Dia em que o corte vale: a saída CONFIRMADA da reserva (nunca a data prevista do card). */
export function autoCheckoutDay(r: { guestCheckout?: string | null; date: string }): string {
  return r.guestCheckout ?? r.date;
}

export async function runAutoCheckoutScan(admin: Admin, now: Date = new Date()) {
  const { buildArrivalRows } = await import("@/lib/arrival-board.server");
  const { runAdvanceArrival } = await import("@/lib/dashboard.functions");

  // Varredura cobre TODOS os imóveis da plataforma (não é por proprietário,
  // como `runOpsPushScan`) — por isso precisamos da lista completa de ids
  // antes de chamar `buildArrivalRows`, que exige `propIds` explicitamente.
  // Já aproveitamos essa mesma consulta pra montar o mapa de fuso horário
  // por imóvel logo abaixo, sem uma segunda ida ao banco.
  const { data: propsRaw } = await admin.from("properties").select("id, city, country");
  const properties = (propsRaw ?? []) as Array<{
    id: string;
    city: string | null;
    country: string | null;
  }>;
  if (properties.length === 0) return { checked: 0, confirmed: 0, failed: 0 };

  const tzByProperty = new Map<string, string>();
  for (const p of properties) {
    tzByProperty.set(p.id, propertyTimeZone(p.city, p.country));
  }
  const propIds = properties.map((p) => p.id);

  // range: "today" já inclui checkouts pendentes de dias anteriores nunca
  // confirmados (mesmo comportamento que os alertas de atraso já usam) —
  // sem isso, um checkout esquecido de ontem nunca seria pego por esta
  // varredura.
  const { rows } = await buildArrivalRows(admin as never, {
    kind: "checkout",
    range: "today",
    propIds,
  });
  const pending = rows.filter((r) => r.status === "pending");
  if (pending.length === 0) return { checked: 0, confirmed: 0, failed: 0 };

  const nowMs = now.getTime();
  let confirmed = 0;
  let failed = 0;

  // Late checkout formal (R6) dos cards de saída: poucos, lidos de uma vez (por reserva e por log).
  const late = await loadFormalLateCheckouts(admin, propIds);
  // sem a leitura das autorizações não há como saber o corte certo: nada é confirmado nesta rodada
  if (!late) return { checked: pending.length, confirmed: 0, failed: 0 };

  /** Quais cards pendentes já passaram do corte oficial (ou do late checkout formal) no dia da saída. */
  const dueNow = (list: typeof rows) => {
    const due: typeof rows = [];
    for (const r of list) {
      if (r.status !== "pending") continue;
      const lateCheckout = late(r);
      const hm = autoCheckoutTriggerTime({
        standardTime: r.standardTime,
        lateCheckout,
        arrivalTimeOverride: r.arrivalTimeOverride,
        arrivalTimeSource: r.arrivalTimeSource,
      });
      if (!hm) continue; // imóvel sem horário oficial de checkout: confirmação continua manual

      const day = autoCheckoutDay(r);
      const [y, mo, d] = day.split("-").map(Number);
      if (!y || !mo || !d) continue;
      const tz = tzByProperty.get(r.propertyId) ?? "America/Sao_Paulo";
      // Checkouts atrasados de dias anteriores (a lista "today" inclui até OVERDUE_WINDOW_DAYS para trás)
      // continuam pendentes de confirmação manual — a automação só age no próprio dia da saída.
      const todayLocal = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
      if (day !== todayLocal) continue;
      const cutoffAt = zonedTimeToUtc(y, mo, d, hm[0], hm[1], tz);
      if (cutoffAt.getTime() > nowMs) continue; // ainda não chegou o corte
      due.push(r);
    }
    return due;
  };

  const due = dueNow(pending);
  if (due.length === 0) return { checked: pending.length, confirmed: 0, failed: 0 };

  const released: string[] = [];
  for (const r of due) {
    const target = resolveTarget(r);
    if (!target.logId && !target.reservationId) continue;

    try {
      await runAdvanceArrival(admin, { ...target, from: "checkout" }, { origin: "system" });
      confirmed++;
      released.push(r.propertyId);
    } catch (err) {
      failed++;
      console.error("[auto-checkout] falha ao confirmar checkout automático:", target, err);
    }
  }

  // Aviso em massa à gestão (08/11/2026): um "🧹 Aguardando Limpeza" por pessoa para todos os imóveis
  // liberados nesta rodada, nunca um push por imóvel. Falha no aviso nunca desfaz as baixas.
  if (released.length > 0) {
    try {
      const { notifyAutoCheckoutBatch } = await import("@/lib/ops-push.server");
      await notifyAutoCheckoutBatch(admin, { propertyIds: released, runKey: now.toISOString().slice(0, 16) });
    } catch (err) {
      console.error("[auto-checkout] falha no aviso em massa:", err);
    }
  }

  return { checked: pending.length, confirmed, failed };
}
