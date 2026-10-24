/**
 * Resolvedor unificado de intenção de estadia (14/10/2026).
 *
 * Os 3 canais (chat do Airbnb/Channex, WhatsApp e chat do Guia Digital) já
 * passam por `runHospitalityAgent` → `buildGuestTools`. Este módulo é o ponto
 * ÚNICO de escrita das duas intenções de estadia:
 *
 *  1. PREVISÃO de horário (check-in / check-out previstos) →
 *     `registerStayTimeForecast`: grava `guest_arrival_status.arrival_time_override`
 *     com `arrival_time_source = 'guest'` (a IA registra o que o hóspede disse; 'staff' é só da equipe).
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
  // Exceção: formato 24h com zero à esquerda ("02:30", "03h") é explícito (madrugada).
  const zeroPadded = /^0\d/.test(m[1] ?? "");
  if (!pm && !am && !zeroPadded && h >= 1 && h <= 6) return null;
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
  // Madrugada (00:00–05:59) num check-in = chegada TARDIA da noite da diária de
  // entrada (ex.: "chegamos 00:00"), não chegada antes do horário oficial.
  const effV = v < 360 ? v + 1440 : v;
  const effAg = ag != null ? (ag < 360 ? ag + 1440 : ag) : null;
  return effV >= std || (effAg != null && effV >= effAg) ? { ok: true } : { ok: false, permitido };
}

/** "Saio no limite", "nos últimos minutos permitidos", "no horário máximo" → horário limite. Pura. */
export function isLimitExpression(input: unknown): boolean {
  const s = String(input ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\b(limite|ultim[oa]s?\s+min|ultimo\s+minuto|ultima\s+hora|horario\s+maximo|maximo\s+permitido|horario\s+(do\s+)?checkout|no\s+horario\s+certo|ate\s+o\s+fim\s+do\s+horario)/.test(s);
}

/**
 * Detecta, numa mensagem do hóspede, uma PREVISÃO de horário de chegada ou de
 * saída ("Chegaremos por volta das 00:00", "Vamos sair às 10h", "saio no
 * limite", "consigo ingresar antes? Meio dia?"). Pura. Pedido de antecipação
 * com horário também é previsão (o painel mostra a diferença em vermelho);
 * só incerteza ("talvez", "não sei") e dúvida sobre o horário oficial viram null.
 */
export function detectStayForecast(message: string): { kind: StayKind; time: string } | null {
  const raw = String(message ?? "");
  const s = raw.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!s) return null;
  // Só dúvida/incerteza descarta. Pergunta de ANTECIPAÇÃO ("consigo ingresar
  // antes? Meio dia?", "podemos chegar às 12h?") é intenção de horário: entra.
  if (/\b(nao sei|no se si|talvez|se der|quizas|tal vez)\b/.test(s)) return null;

  const asks = s.includes("?");
  // Verbos de chegada/saída (pt + es). "check-in"/"entrada" soltos, numa PERGUNTA,
  // costumam ser dúvida sobre o horário oficial ("o check-in é às 15h?") — aí só
  // vale com verbo de movimento ou com "antes".
  const inVerb = /\b(cheg\w*|ingres\w*|lleg\w*|entrar|entraremos|entramos)\b/.test(s);
  const outVerb = /\b(sai\w*|sal[ei]\w*|salgo|saldr\w*|desocup\w*|liberar\w*|deixar o (apto|imovel|quarto|casa|flat))\b/.test(s);
  const inNoun = /\b(check-?in|entrada|previsao de chegada|horario de chegada|hora de llegada)\b/.test(s);
  const outNoun = /\bcheck-?out\b/.test(s);
  const early = /\b(antes|antecipa\w*|adelant\w*|mais cedo|mas temprano)\b/.test(s);
  const isIn = inVerb || (inNoun && (!asks || early));
  const isOut = outVerb || (outNoun && !asks);
  if (!isIn && !isOut) return null;

  const kind: StayKind = isOut && !isIn ? "checkout" : "checkin";
  if (kind === "checkout" && isLimitExpression(s)) return { kind, time: "limite" };

  const time = normalizeStayTime(s);
  return time ? { kind, time } : null;
}

export async function registerStayTimeForecast(
  supabase: SupabaseClient,
  ref: Ref,
  input: { kind: StayKind; time: unknown },
): Promise<ForecastResult> {
  let time = normalizeStayTime(input.time);
  if (!time && input.kind === "checkout" && isLimitExpression(input.time)) {
    const { data: p } = await supabase.from("properties").select("checkout_time").eq("id", ref.propertyId).maybeSingle();
    const r = String((p as { checkout_time?: string } | null)?.checkout_time ?? "").match(/^(\d{1,2}):(\d{2})/);
    if (r) time = `${r[1]!.padStart(2, "0")}:${r[2]}`;
  }
  if (!time) return { ok: false, motivo: "horario_ambiguo" };

  const stay = await findStayForEvent(supabase, ref);
  if (!stay) return { ok: false, motivo: "reserva_nao_encontrada" };
  const logId = await findLogId(supabase, { propertyId: ref.propertyId, checkinDate: stay.checkinDate, guestName: ref.guestName });

  // SEM trava de horário (23/10/2026): IA e equipe registram qualquer horário
  // informado pelo hóspede, mesmo antes do check-in oficial ou depois do
  // checkout. O painel destaca a diferença em vermelho; quem decide é a equipe.

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
    if (existing.arrival_time_override === time && (existing.arrival_time_source === "ai" || existing.arrival_time_source === "guest"))
      return { ok: true, horario: time, ja_registrado: true };
    const { error } = await supabase
      .from("guest_arrival_status")
      .update({
        arrival_time_override: time,
        arrival_time_source: "guest",
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
    arrival_time_source: "guest",
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
