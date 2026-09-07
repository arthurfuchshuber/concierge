// Server-only: confirmação automática de checkout no horário previsto.
// Importar somente dentro de handlers (server routes / server functions).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { propertyTimeZone, zonedTimeToUtc } from "@/lib/property-timezone";

type Admin = SupabaseClient<Database>;

/**
 * Resolve `logId`/`reservationId` pro formato que `runAdvanceArrival` espera
 * a partir de um `ArrivalRow`. Mesmo critério de `statusTarget` (em
 * `OperationWorkspace.tsx`): `logId` só é aceito quando é um UUID real de
 * `guide_access_logs` — uma reserva só-iCal (sem log/formulário do hóspede)
 * usa o prefixo sintético "ical:<reservation_id>" no lugar de um log de
 * verdade, e nesse caso é o `reservation_id` embutido que deve ser usado.
 */
function resolveTarget(row: { logId: string; reservationId: string | null }): {
  logId?: string;
  reservationId?: string;
} {
  const logId = /^[0-9a-f-]{36}$/i.test(row.logId) ? row.logId : undefined;
  const reservationId = row.reservationId ?? (row.logId.startsWith("ical:") ? row.logId.slice(5) : undefined);
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
 * Confirma automaticamente o checkout de um card assim que o horário
 * PREVISTO chega — pedido explícito (06/09/2026): "se um usuário colocar
 * 4h00 da manhã como prevista, então o card será dado como checkout
 * confirmado nesse horário (sempre horário local do guia — usando o
 * principal horário do país em questão)". Roda por cron (`cron.auto-
 * checkout`, a cada 5 minutos) — não depende de ninguém abrir o app.
 *
 * "Horário previsto" segue EXATAMENTE o mesmo critério já usado em todo o
 * resto do sistema (ordenação inteligente dos checkouts, alertas de atraso
 * em `runOpsPushScan`): override do anfitrião (`arrivalTimeOverride`) OU,
 * na ausência dele, o horário que o próprio hóspede informou
 * (`guestArrivalTime`). O horário PADRÃO do imóvel (`checkout_time`) nunca
 * entra aqui — só dispara quando alguém de fato definiu uma previsão.
 *
 * O fuso usado é o do IMÓVEL (`propertyTimeZone`, cidade/país cadastrados),
 * a mesma função já usada pro guia do hóspede — nunca um fuso fixo de
 * servidor. Isso cobre "o principal horário do país em questão" mesmo pra
 * imóveis fora do Brasil.
 *
 * A ação em si reaproveita `runAdvanceArrival` — a MESMA lógica do clique
 * manual em "Confirmar checkout" (libera o imóvel, entra na fila de
 * limpeza, avisa os prestadores de limpeza) — só que com `supabaseAdmin`,
 * já que não há usuário logado por trás de um cron. O "silenciar" do card
 * (`mutedUntil`) NÃO afeta esta rotina: ele só existe pra parar de INCOMODAR
 * com alertas de atraso, não pra suspender a confirmação automática.
 */
export async function runAutoCheckoutScan(admin: Admin, now: Date = new Date()) {
  const { buildArrivalRows } = await import("@/lib/arrival-board.server");
  const { runAdvanceArrival } = await import("@/lib/dashboard.functions");

  // Varredura cobre TODOS os imóveis da plataforma (não é por proprietário,
  // como `runOpsPushScan`) — por isso precisamos da lista completa de ids
  // antes de chamar `buildArrivalRows`, que exige `propIds` explicitamente.
  // Já aproveitamos essa mesma consulta pra montar o mapa de fuso horário
  // por imóvel logo abaixo, sem uma segunda ida ao banco.
  const { data: propsRaw } = await admin.from("properties").select("id, city, country");
  const properties = (propsRaw ?? []) as Array<{ id: string; city: string | null; country: string | null }>;
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
  const { rows } = await buildArrivalRows(admin as never, { kind: "checkout", range: "today", propIds });
  const pending = rows.filter((r) => r.status === "pending");
  if (pending.length === 0) return { checked: 0, confirmed: 0, failed: 0 };

  const nowMs = now.getTime();
  let confirmed = 0;
  let failed = 0;

  for (const r of pending) {
    // IMPORTANTE: só o horário PREVISTO DE SAÍDA definido pelo anfitrião
    // (`arrivalTimeOverride` da linha de checkout) dispara a confirmação
    // automática. `guestArrivalTime` é o horário de CHEGADA informado pelo
    // hóspede no formulário de check-in — usá-lo aqui confirmava saídas que
    // ninguém confirmou e ainda acionava a limpeza.
    const hm = parseHm(r.arrivalTimeOverride);
    if (!hm) continue; // sem horário previsto definido: confirmação continua manual

    const [y, mo, d] = r.date.split("-").map(Number);
    if (!y || !mo || !d) continue;
    const tz = tzByProperty.get(r.propertyId) ?? "America/Sao_Paulo";
    // Checkouts atrasados de dias anteriores (a lista "today" inclui até
    // OVERDUE_WINDOW_DAYS para trás) continuam pendentes de confirmação
    // manual — a automação só age no próprio dia previsto.
    const todayLocal = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    if (r.date !== todayLocal) continue;
    const predictedAt = zonedTimeToUtc(y, mo, d, hm[0], hm[1], tz);
    if (predictedAt.getTime() > nowMs) continue; // ainda não chegou o horário previsto

    const target = resolveTarget(r);
    if (!target.logId && !target.reservationId) continue;

    try {
      await runAdvanceArrival(admin, { ...target, from: "checkout" });
      confirmed++;
    } catch (err) {
      failed++;
      console.error("[auto-checkout] falha ao confirmar checkout automático:", target, err);
    }
  }

  return { checked: pending.length, confirmed, failed };
}
