/**
 * Etiqueta de status de cada conversa da lista de Atendimento (26/11/2026).
 *
 * Fonte: o que a Channex nos manda (consulta, pedido de reserva, aceite/recusa)
 * e as reservas oficiais. Nada é estimado: sem dado, sem etiqueta.
 *
 *  - Consulta     → conversa do Airbnb que não virou reserva (consulta, ou pedido sem aceite fora das 24 h).
 *  - Solicitação  → pedido de reserva ainda sem resposta, dentro das 24 h do Airbnb.
 *  - Recusada     → consulta ou pedido recusado.
 *  - Confirmada   → reserva confirmada que ainda não começou.
 *  - Andamento → hospedagem em curso (do check-in ao dia do check-out).
 *  - Encerrada    → hospedagem já terminada.
 *  - Cancelada    → reserva cancelada.
 *
 * "Pendente de pagamento" não existe nos dados da Channex, por isso não há essa etiqueta.
 */

export type ChatStatusLabel =
  | "Consulta"
  | "Solicitação"
  | "Recusada"
  | "Confirmada"
  | "Andamento"
  | "Encerrada"
  | "Cancelada";

/** Último evento de negociação da conversa (consulta ou pedido de reserva), vindo da Channex. */
export type ChatFlow = {
  kind: "inquiry" | "request";
  /** active = consulta aberta; pending = pedido sem resposta; accepted/declined = resposta do anfitrião. */
  state: "active" | "pending" | "accepted" | "declined";
  checkin: string | null;
  checkout: string | null;
  /** Quando o evento chegou (ISO). */
  at: string;
};

export type ChatStatusReservation = {
  status: "confirmed" | "loose" | "missing" | "no_reservations" | "cancelled";
  checkin: string | null;
  checkout: string | null;
};

/** Prazo do Airbnb para o anfitrião responder a um pedido de reserva. */
export const REQUEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export const CHAT_STATUS_TONE: Record<ChatStatusLabel, string> = {
  Consulta: "bg-foreground/[0.06] text-muted-foreground",
  "Solicitação": "bg-amber-500/14 text-amber-800 dark:bg-amber-400/15 dark:text-amber-200",
  Confirmada: "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  "Andamento": "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  Encerrada: "bg-foreground/[0.06] text-muted-foreground",
  Cancelada: "bg-[#c98c8c]/16 text-[#a35d5d] dark:bg-[#c98c8c]/20 dark:text-[#e0aaaa]",
  Recusada: "bg-[#c98c8c]/16 text-[#a35d5d] dark:bg-[#c98c8c]/20 dark:text-[#e0aaaa]",
};

function byDates(checkin: string, checkout: string | null, today: string): ChatStatusLabel {
  if (checkout && checkout < today) return "Encerrada";
  if (checkin <= today) return "Andamento";
  return "Confirmada";
}

function fromFlow(flow: ChatFlow, nowMs: number): ChatStatusLabel {
  if (flow.state === "declined") return "Recusada";
  if (flow.kind === "request") {
    if (flow.state === "accepted") return "Confirmada";
    const age = nowMs - Date.parse(flow.at);
    if (flow.state === "pending" && Number.isFinite(age) && age < REQUEST_WINDOW_MS) return "Solicitação";
  }
  return "Consulta";
}

/**
 * @param today data local (YYYY-MM-DD, fuso de São Paulo)
 * @param nowMs relógio atual (para o prazo de 24 h do pedido)
 */
export function chatStatusOf(input: {
  res: ChatStatusReservation | null | undefined;
  flow: ChatFlow | null | undefined;
  isAirbnb: boolean;
  /** Datas da reserva com que o hóspede entrou no guia (código validado). Usadas no guia/WhatsApp
   *  quando o cruzamento com a reserva oficial não achou a linha (ex.: conversas antigas, sem vínculo). */
  guideStay?: { checkin: string | null; checkout: string | null } | null;
  today: string;
  nowMs: number;
}): ChatStatusLabel | null {
  const { res, flow, isAirbnb, guideStay, today, nowMs } = input;
  const hasStay = !!res && (res.status === "confirmed" || res.status === "loose") && !!res.checkin;
  const cancelled = !!res && res.status === "cancelled";

  // Nova negociação depois de uma estadia encerrada ou cancelada (ex.: hóspede que volta a consultar):
  // vale a negociação, não a reserva antiga.
  const flowIsNewer =
    !!flow &&
    !!flow.checkin &&
    flow.checkin >= today &&
    (cancelled || (hasStay && !!res!.checkout && res!.checkout < today)) &&
    !(flow.checkin === res!.checkin && (flow.checkout ?? null) === (res!.checkout ?? null));
  if (flow && flowIsNewer) return fromFlow(flow, nowMs);

  if (hasStay) return byDates(res!.checkin!, res!.checkout, today);
  if (cancelled) return "Cancelada";
  if (flow) return fromFlow(flow, nowMs);
  // Airbnb: tudo o que não virou reserva é consulta.
  if (isAirbnb) return "Consulta";
  // Guia/WhatsApp: o hóspede só entra com o código da reserva, então sempre há datas.
  if (guideStay?.checkin) return byDates(guideStay.checkin, guideStay.checkout, today);
  return null;
}

/** Data local de São Paulo (YYYY-MM-DD). */
export function saoPauloToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

type RawRow = { entity_type: string; first_seen_at: string; payload: unknown };

/**
 * Monta o último evento de negociação por thread da Channex a partir dos registros brutos.
 * `threadRows`: webhook:inquiry e webhook:reservation_request (com message_thread_id).
 * `outcomeRows`: webhook:accepted_reservation e webhook:declined_reservation (só com o thread do Airbnb).
 */
export function buildChatFlows(threadRows: RawRow[], outcomeRows: RawRow[]): Map<string, ChatFlow> {
  const outcome = new Map<string, { state: "accepted" | "declined"; at: string }>();
  for (const r of outcomeRows) {
    const p = (r.payload as { payload?: Record<string, unknown> } | null)?.payload ?? {};
    const ota = String(((p.bms as { meta?: { thread_id?: unknown } } | undefined)?.meta?.thread_id ?? "") || "");
    if (!ota) continue;
    const state = r.entity_type === "webhook:accepted_reservation" ? "accepted" : "declined";
    const prev = outcome.get(ota);
    if (!prev || prev.at < r.first_seen_at) outcome.set(ota, { state, at: r.first_seen_at });
  }
  const flows = new Map<string, ChatFlow>();
  for (const r of threadRows) {
    const p = (r.payload as { payload?: Record<string, unknown> } | null)?.payload ?? {};
    const thread = typeof p.message_thread_id === "string" ? p.message_thread_id : "";
    if (!thread) continue;
    let flow: ChatFlow | null = null;
    if (r.entity_type === "webhook:inquiry") {
      const bd = (p.booking_details ?? {}) as { checkin_date?: unknown; checkout_date?: unknown };
      flow = {
        kind: "inquiry",
        state: p.status === "declined" ? "declined" : "active",
        checkin: typeof bd.checkin_date === "string" ? bd.checkin_date : null,
        checkout: typeof bd.checkout_date === "string" ? bd.checkout_date : null,
        at: r.first_seen_at,
      };
    } else if (r.entity_type === "webhook:reservation_request") {
      const room = (Array.isArray(p.rooms) ? p.rooms[0] : null) as { checkin_date?: unknown; checkout_date?: unknown } | null;
      const ota = String(((p.bms as { meta?: { thread_id?: unknown } } | undefined)?.meta?.thread_id ?? "") || "");
      const out = ota ? outcome.get(ota) : undefined;
      flow = {
        kind: "request",
        state: out && out.at >= r.first_seen_at ? out.state : "pending",
        checkin: typeof room?.checkin_date === "string" ? room.checkin_date : null,
        checkout: typeof room?.checkout_date === "string" ? room.checkout_date : null,
        at: r.first_seen_at,
      };
    }
    if (!flow) continue;
    const prev = flows.get(thread);
    if (!prev || prev.at < flow.at) flows.set(thread, flow);
  }
  return flows;
}
