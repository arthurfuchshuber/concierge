/**
 * Resolvedor unificado de intenção de estadia (14/10/2026).
 *
 * Os 3 canais (chat do Airbnb/Channex, WhatsApp e chat do Guia Digital) já
 * passam por `runHospitalityAgent` → `buildGuestTools`. Este módulo é o ponto
 * ÚNICO de escrita das duas intenções de estadia:
 *
 *  1. PREVISÃO de horário (check-in / check-out previstos) →
 *     `registerStayTimeForecast`: grava `guest_arrival_status.arrival_time_override`
 *     com `arrival_time_source = 'ai'`.
 *  2. CONFIRMAÇÃO definitiva (check-in / check-out realizados) →
 *     `registerStayDone`: delega a `applyStayEvent` (mesma rotina do clique
 *     manual: `status = done`, `done_at = now()`).
 *
 * Regras de segurança:
 *  - Nunca regride: linha já `done` não recebe previsão.
 *  - Horário gravado pela EQUIPE (`source = 'staff'`) nunca é sobrescrito pela IA.
 *  - Horário ambíguo ("à tarde", "depois do almoço") NÃO é gravado — a IA pergunta.
 *  - Upsert respeita os índices únicos `(log_id, kind)` e `(reservation_id, kind)`.
 *  - Pausa da IA (`pausePatch`): a ferramenta só roda quando o agente roda; em
 *    conversa pausada, o canal nem chama o agente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { findStayForEvent, applyStayEvent } from "./stay-events.server";

export type StayKind = "checkin" | "checkout";

/**
 * Normaliza um horário informado pelo hóspede para "HH:MM" (24h).
 * Aceita "15:30", "15h", "15h30", "3 da tarde", "3pm", "meio-dia", "meia-noite".
 * Devolve null quando for vago/ambíguo (ex.: "à tarde", "umas 3" sem período).
 */
export function normalizeStayTime(input: unknown): string | null {
  const s = String(input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
  if (!s) return null;
  if (/meio[\s-]?dia/.test(s)) return "12:00";
  if (/meia[\s-]?noite/.test(s)) return "00:00";

  const pm = /(?<![a-z])pm(?![a-z])|da tarde|da noite|de noite|de tarde/.test(s);
  const am = /(?<![a-z])am(?![a-z])|da manha|de manha|da madrugada|de madrugada/.test(s);
  const mark = s.match(/(\d{1,2})\s*(?::|h)\s*(\d{2})?(?![a-z0-9])/); // 15:30, 15h, 15h30
  const bare = s.match(/(\d{1,2})\s*(?:am|pm|da\s|de\s|horas?\b)/); // 3pm, 3 da tarde
  const m = mark ?? bare;
  if (!m) return null;
  let h = Number(m[1]);
  const min = mark && mark[2] ? Number(mark[2]) : 0;
  if (!Number.isFinite(h) || h > 23 || min > 59) return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  // Sem período e hora de 1 a 6 ("chego às 3h"): pode ser madrugada ou tarde → pergunta.
  if (!pm && !am && h >= 1 && h <= 6) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

type Ref = { propertyId: string; checkinDate: string | null; checkoutDate: string | null; guestName?: string | null };

type Row = {
  id: string;
  status: string | null;
  done_at: string | null;
  arrival_time_override: string | null;
  arrival_time_source: string | null;
};

async function findLogId(supabase: SupabaseClient, p: { propertyId: string; checkinDate: string; guestName?: string | null }) {
  let q = supabase
    .from("guide_access_logs")
    .select("id")
    .eq("property_id", p.propertyId)
    .eq("checkin_date", p.checkinDate);
  if (p.guestName) q = q.eq("guest_name", p.guestName);
  const { data } = await q.order("created_at", { ascending: false }).limit(1);
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null;
}

export type ForecastResult = {
  ok: boolean;
  motivo?: string;
  horario?: string;
  ja_registrado?: boolean;
  /** Horário permitido do imóvel (HH:MM) quando a previsão foi recusada por estar fora dele. */
  permitido?: string;
};

/**
 * A previsão só entra no painel DENTRO do que o sistema permite (check-in a
 * partir do horário configurado; check-out até o horário limite) ou alinhada
 * com a equipe (`agreed`: horário autorizado em mensagem humana). Sem horário
 * configurado, não há regra a violar. Pura.
 */
export function forecastAllowed(p: {
  kind: StayKind;
  time: string;
  standard: unknown;
  agreed?: string | null;
}): { ok: boolean; permitido?: string } {
  const mm = (v: unknown) => {
    const r = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
    return r ? Number(r[1]) * 60 + Number(r[2]) : null;
  };
  const std = mm(p.standard);
  const v = mm(p.time);
  if (std == null || v == null) return { ok: true };
  const permitido = `${String(Math.floor(std / 60)).padStart(2, "0")}:${String(std % 60).padStart(2, "0")}`;
  const ag = mm(p.agreed);
  if (p.kind === "checkout") return v <= std || (ag != null && v <= ag) ? { ok: true } : { ok: false, permitido };
  return v >= std || (ag != null && v >= ag) ? { ok: true } : { ok: false, permitido };
}

export async function registerStayTimeForecast(
  supabase: SupabaseClient,
  ref: Ref,
  input: { kind: StayKind; time: unknown },
): Promise<ForecastResult> {
  const time = normalizeStayTime(input.time);
  if (!time) return { ok: false, motivo: "horario_ambiguo" };

  const stay = await findStayForEvent(supabase, ref);
  if (!stay) return { ok: false, motivo: "reserva_nao_encontrada" };
  const logId = await findLogId(supabase, { propertyId: ref.propertyId, checkinDate: stay.checkinDate, guestName: ref.guestName });

  // Dentro do permitido em sistema ou alinhado com a equipe; senão não grava.
  try {
    const { data: prop } = await supabase.from("properties").select("checkin_time, checkout_time").eq("id", ref.propertyId).maybeSingle();
    const pr = (prop ?? {}) as Record<string, unknown>;
    const standard = input.kind === "checkout" ? pr.checkout_time : pr.checkin_time;
    let verdict = forecastAllowed({ kind: input.kind, time, standard });
    if (!verdict.ok && ref.guestName) {
      const { loadStaffMessages } = await import("./stay-events.server");
      const { parseAgreedTime } = await import("./stay-access.server");
      const agreed = parseAgreedTime(input.kind, await loadStaffMessages(supabase, { propertyId: ref.propertyId, guestName: ref.guestName }), standard);
      verdict = forecastAllowed({ kind: input.kind, time, standard, agreed });
    }
    if (!verdict.ok) return { ok: false, motivo: "fora_do_permitido", permitido: verdict.permitido };
  } catch (e) {
    console.error("[stay-intent] não foi possível validar a previsão", e);
  }

  const sel = "id, status, done_at, arrival_time_override, arrival_time_source";
  const byRes = await supabase
    .from("guest_arrival_status")
    .select(sel)
    .eq("kind", input.kind)
    .eq("reservation_id", stay.reservationId)
    .limit(1);
  let existing = ((byRes.data ?? [])[0] as Row | undefined) ?? null;
  if (!existing && logId) {
    const byLog = await supabase.from("guest_arrival_status").select(sel).eq("kind", input.kind).eq("log_id", logId).limit(1);
    existing = ((byLog.data ?? [])[0] as Row | undefined) ?? null;
  }

  if (existing) {
    if (existing.status === "done" || existing.done_at) return { ok: true, motivo: "ja_concluido" };
    if (existing.arrival_time_source === "staff" && existing.arrival_time_override)
      return { ok: false, motivo: "horario_definido_pela_equipe" };
    if (existing.arrival_time_override === time && existing.arrival_time_source === "ai")
      return { ok: true, horario: time, ja_registrado: true };
    const { error } = await supabase
      .from("guest_arrival_status")
      .update({
        arrival_time_override: time,
        arrival_time_source: "ai",
        ...(logId ? { log_id: logId } : {}),
        reservation_id: stay.reservationId,
      })
      .eq("id", existing.id);
    if (error) return { ok: false, motivo: "erro_ao_gravar" };
    return { ok: true, horario: time };
  }

  const { error } = await supabase.from("guest_arrival_status").insert({
    property_id: ref.propertyId,
    kind: input.kind,
    reservation_id: stay.reservationId,
    ...(logId ? { log_id: logId } : {}),
    arrival_time_override: time,
    arrival_time_source: "ai",
  });
  if (error) return { ok: false, motivo: "erro_ao_gravar" };
  return { ok: true, horario: time };
}

/** Confirmação definitiva (check-in/check-out realizado) — mesma rotina do painel. */
export async function registerStayDone(supabase: SupabaseClient, ref: Ref, kind: StayKind) {
  const stay = await findStayForEvent(supabase, ref);
  if (!stay) return { ok: false, motivo: "reserva_nao_encontrada" };
  return applyStayEvent(supabase, stay, kind);
}
