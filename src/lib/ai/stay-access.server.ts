/**
 * MENTE ÚNICA DE ACESSO (pedido explícito, 15/10/2026): durante a estadia em
 * andamento — reserva confirmada, do dia da entrada até 3 h após o horário de
 * check-out (17/10/2026) e card NÃO marcado como "Não Compareceu" —
 * todos os dados do anúncio ficam liberados para a IA (Wi-Fi, senhas, códigos,
 * endereço, instruções), em TODOS os canais. Fora disso, segue bloqueado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone, todayInTZ, zonedTimeToUtc } from "@/lib/property-timezone";
import { isStayMarkedNoShow } from "@/lib/guest-access.server";

export type StayAccess = {
  open: boolean;
  checkin: string | null;
  checkout: string | null;
  /** Card de check-in liberado (botão verde). Só tem sentido com `open`. */
  released?: boolean;
  /** Check-out tardio alinhado com a equipe ("HH:MM"), se houver. */
  agreedCheckout?: string | null;
  reason: "in_stay" | "no_reservation" | "outside_window" | "no_show" | "checked_out" | "unverified" | "not_released";
};

/** Regra pura: hoje dentro da janela [entrada, saída]. */
export function isWithinStay(today: string, checkin: string | null, checkout: string | null): boolean {
  if (!checkin) return false;
  const ci = checkin.slice(0, 10);
  const co = (checkout ?? checkin).slice(0, 10);
  return today >= ci && today <= co;
}

export const CHECKOUT_GRACE_HOURS = 1;

/**
 * Exceção de horário ALINHADA com a equipe, lida de mensagens HUMANAS (nunca da
 * IA): a mensagem precisa falar do evento (saída/check-out ou entrada/check-in),
 * trazer um horário fora do padrão (checkout: mais tarde; checkin: mais cedo)
 * e não ser pergunta nem recusa. Devolve "HH:MM". Conservadora de propósito:
 * na dúvida, não considera alinhado.
 */
export function parseAgreedTime(
  kind: "checkin" | "checkout",
  messages: Array<{ texto: string; nota_interna?: boolean }>,
  standard: unknown,
): string | null {
  const std = String(standard ?? "").match(/^(\d{1,2}):(\d{2})/);
  const stdMin = std ? Number(std[1]) * 60 + Number(std[2]) : null;
  const topic =
    kind === "checkout"
      ? /(check-?out|saida|sair|deixar o imovel|desocup)/
      : /(check-?in|entrada|entrar|chegar|chegada|antecip)/;
  for (const m of messages) {
    const t = m.texto
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    if (!topic.test(t)) continue;
    if (/\?\s*$/.test(t.trim()) || /(nao (da|pode|conseguimos)|impossivel|nao foi possivel)/.test(t)) continue;
    if (!/(pode|podem|liberad|autoriz|combinad|alinhad|ok|tudo bem|sem problema|tardio|estendid|antecip|ate as?)/.test(t)) continue;
    const tm = t.match(/\b(?:ate\s+(?:as\s+)?|as\s+|por volta d?as?\s+)?(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/);
    if (!tm) continue;
    const h = Number(tm[1]);
    const min = tm[2] ? Number(tm[2]) : 0;
    if (h > 23 || min > 59) continue;
    const v = h * 60 + min;
    if (stdMin != null && (kind === "checkout" ? v <= stdMin : v >= stdMin)) continue;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  }
  return null;
}

export const parseAgreedCheckout = (
  messages: Array<{ texto: string; nota_interna?: boolean }>,
  standard: unknown,
) => parseAgreedTime("checkout", messages, standard);

/**
 * Janela de acesso: do dia do check-in até 1 h após o HORÁRIO de check-out
 * (17/10/2026) — o padrão do imóvel ou, havendo check-out tardio alinhado com
 * a equipe, o horário alinhado (vale o mais tarde). Atravessa a meia-noite.
 * Sem horário configurado, cai na regra por data.
 */
export function withinAccessWindow(p: {
  today: string;
  nowMs: number;
  checkin: string | null;
  checkout: string | null;
  checkoutTime: unknown;
  /** Check-out tardio alinhado ("HH:MM"), se houver. */
  agreedCheckoutTime?: string | null;
  tz: string;
}): boolean {
  if (!p.checkin) return false;
  const ci = p.checkin.slice(0, 10);
  const co = (p.checkout ?? p.checkin).slice(0, 10);
  if (p.today < ci) return false;
  const mm = (v: unknown) => {
    const r = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
    return r ? ([Number(r[1]), Number(r[2])] as [number, number]) : null;
  };
  const std = mm(p.checkoutTime);
  const agreed = mm(p.agreedCheckoutTime);
  const m =
    std && agreed ? (agreed[0] * 60 + agreed[1] > std[0] * 60 + std[1] ? agreed : std) : (std ?? agreed);
  if (!m) return p.today <= co;
  const [y, mo, d] = co.split("-").map(Number);
  if (![y, mo, d].every((x) => Number.isFinite(x))) return p.today <= co;
  const gate = zonedTimeToUtc(y!, mo!, d!, m[0], m[1], p.tz).getTime();
  return p.nowMs <= gate + CHECKOUT_GRACE_HOURS * 3_600_000;
}

/**
 * CHECK-IN LIBERADO = botão verde do card (17/10/2026, decisão do anfitrião).
 * Mesmo critério do card do Kanban e da faixa do guia: a data de entrada já
 * chegou E o imóvel não está em turnover (nenhuma saída ANTERIOR, vencida,
 * ainda sem a limpeza concluída). Quem já fez o check-in está liberado.
 * Liberado NÃO significa "antes do horário pode": se for antes do horário
 * configurado, a IA sempre confirma com a equipe (ver access-guidance).
 */
export function isCheckinReleased(p: {
  today: string;
  checkin: string;
  checkinDone: boolean;
  /** Datas de saída (checkout) de OUTRAS estadias ainda sem limpeza concluída. */
  openTurnoverCheckouts: string[];
}): boolean {
  if (p.checkinDone) return true;
  if (p.checkin > p.today) return false;
  return !p.openTurnoverCheckouts.some((d) => d <= p.today);
}

async function loadReleaseFacts(
  supabase: SupabaseClient,
  propertyId: string,
  checkin: string,
  logId: string | null,
): Promise<{ checkinDone: boolean; checkoutDone: boolean; openTurnoverCheckouts: string[]; agreedCheckoutTime: string | null }> {
  try {
    const { data: ownRes } = await supabase
      .from("property_reservations")
      .select("id")
      .eq("property_id", propertyId)
      .eq("checkin_date", checkin);
    const ownResIds = ((ownRes ?? []) as Array<{ id: string }>).map((r) => r.id);
    const { data: st } = await supabase
      .from("guest_arrival_status")
      .select("kind, status, concluded_at, reservation_id, log_id, arrival_time_override, arrival_time_source")
      .eq("property_id", propertyId)
      .in("kind", ["checkin", "checkout"])
      .limit(1000);
    const rows = (st ?? []) as Array<{
      kind: string;
      status: string | null;
      concluded_at: string | null;
      reservation_id: string | null;
      log_id: string | null;
      arrival_time_override: string | null;
      arrival_time_source: string | null;
    }>;
    const isOwn = (r: { reservation_id: string | null; log_id: string | null }) =>
      (!!r.reservation_id && ownResIds.includes(r.reservation_id)) || (!!logId && r.log_id === logId);
    const checkinDone = rows.some(
      (r) => r.kind === "checkin" && isOwn(r) && (r.status === "done" || !!r.concluded_at),
    );
    const checkoutDone = rows.some(
      (r) => r.kind === "checkout" && isOwn(r) && (r.status === "done" || !!r.concluded_at),
    );
    // Horário de saída definido pela EQUIPE no editor de Previsão = check-out alinhado.
    const agreedRow = rows.find(
      (r) => r.kind === "checkout" && isOwn(r) && r.arrival_time_source === "staff" && !!r.arrival_time_override,
    );
    const agreedCheckoutTime = agreedRow?.arrival_time_override
      ? String(agreedRow.arrival_time_override).slice(0, 5)
      : null;
    const open = rows.filter((r) => r.kind === "checkout" && !r.concluded_at && !isOwn(r));
    const resIds = open.map((r) => r.reservation_id).filter((x): x is string => !!x);
    const logIds = open.map((r) => r.log_id).filter((x): x is string => !!x);
    const [a, b] = await Promise.all([
      resIds.length
        ? supabase.from("property_reservations").select("checkout_date").in("id", resIds)
        : Promise.resolve({ data: [] as Array<{ checkout_date: string | null }> }),
      logIds.length
        ? supabase.from("guide_access_logs").select("checkout_date").in("id", logIds)
        : Promise.resolve({ data: [] as Array<{ checkout_date: string | null }> }),
    ]);
    const dates = [...((a.data ?? []) as Array<{ checkout_date: string | null }>), ...((b.data ?? []) as Array<{ checkout_date: string | null }>)]
      .map((r) => (r.checkout_date ? String(r.checkout_date).slice(0, 10) : ""))
      .filter(Boolean);
    return { checkinDone, checkoutDone, openTurnoverCheckouts: dates, agreedCheckoutTime };
  } catch (e) {
    console.error("[stay-access] não foi possível ler a liberação do check-in", e);
    // Falha de leitura: NÃO libera (fail-closed para credenciais).
    return { checkinDone: false, checkoutDone: false, agreedCheckoutTime: null, openTurnoverCheckouts: [new Date(0).toISOString().slice(0, 10)] };
  }
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export async function resolveStayAccess(params: {
  supabase: SupabaseClient;
  property: Record<string, unknown>;
  channel: string;
  guestName?: string | null;
  checkinDate?: string | null;
  checkoutDate?: string | null;
  reservationVerified?: boolean;
  /** Guia: visitante não provou a reserva → nunca libera. */
  credentialsLocked?: boolean;
}): Promise<StayAccess> {
  const p = params.property;
  const propertyId = String(p.id);
  const tz = propertyTimeZone(
    typeof p.city === "string" ? p.city : null,
    typeof p.country === "string" ? p.country : null,
  );
  const today = todayInTZ(tz);
  const base = { checkin: null, checkout: null } as const;
  if (params.credentialsLocked === true || params.reservationVerified === false) {
    return { open: false, ...base, reason: "unverified" };
  }

  let checkin = params.checkinDate ? params.checkinDate.slice(0, 10) : null;
  let checkout = params.checkoutDate ? params.checkoutDate.slice(0, 10) : null;
  let logId: string | null = null;

  // Airbnb exige a validação do próprio canal (reserva oficial do thread).
  if (params.channel === "airbnb" && params.reservationVerified !== true) {
    return { open: false, ...base, reason: "unverified" };
  }
  if (!checkin) {
    const target = norm(params.guestName ?? "");
    if (!target) return { open: false, ...base, reason: "no_reservation" };
    const { data } = await params.supabase
      .from("guide_access_logs")
      .select("id, guest_name, checkin_date, checkout_date")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as Array<{ id: string; guest_name: string; checkin_date: string; checkout_date: string | null }>;
    const first = target.split(" ")[0];
    const log =
      rows.find((r) => norm(r.guest_name ?? "") === target) ??
      rows.find((r) => norm(r.guest_name ?? "").split(" ")[0] === first);
    if (!log?.checkin_date) return { open: false, ...base, reason: "no_reservation" };
    checkin = String(log.checkin_date).slice(0, 10);
    checkout = log.checkout_date ? String(log.checkout_date).slice(0, 10) : null;
    logId = log.id;
  }

  if (await isStayMarkedNoShow(propertyId, checkin)) return { open: false, checkin, checkout, reason: "no_show" };
  const facts = await loadReleaseFacts(params.supabase, propertyId, checkin, logId);
  // Janela: padrão do imóvel + 1 h; com check-out tardio alinhado, o horário
  // alinhado + 1 h. O alinhamento vem do editor de Previsão (equipe) ou de
  // mensagem humana na conversa; só é consultado se a janela padrão já fechou.
  const win = { today, nowMs: Date.now(), checkin, checkout, checkoutTime: p.checkout_time, tz };
  let agreedCheckout: string | null = facts.agreedCheckoutTime;
  if (!withinAccessWindow({ ...win, agreedCheckoutTime: agreedCheckout })) {
    if (!agreedCheckout && params.guestName) {
      try {
        const { loadStaffMessages } = await import("./stay-events.server");
        agreedCheckout = parseAgreedCheckout(
          await loadStaffMessages(params.supabase, { propertyId, guestName: params.guestName }),
          p.checkout_time,
        );
      } catch (e) {
        console.error("[stay-access] não foi possível ler o check-out alinhado", e);
      }
    }
    if (!withinAccessWindow({ ...win, agreedCheckoutTime: agreedCheckout })) {
      return { open: false, checkin, checkout, reason: "outside_window" };
    }
  }
  // Liberação do card NÃO fecha o acesso (decisão de 17/10/2026): no dia do
  // check-in a IA pode entregar as credenciais mesmo com o card travado,
  // reforçando que o check-in ainda não foi liberado. A decisão fina
  // (entregar / consultar a equipe) é de `decideAccess`.
  // Saída concluída NÃO fecha mais o acesso: vale até 3 h após o horário de
  // check-out (decisão de 17/10/2026).
  const released = isCheckinReleased({ today, checkin, checkinDone: facts.checkinDone, openTurnoverCheckouts: facts.openTurnoverCheckouts });
  return { open: true, released, agreedCheckout, checkin, checkout, reason: "in_stay" };
}

/** Fatos completos do anúncio liberados durante a estadia (evidência oficial). */
export function stayFactsText(p: Record<string, unknown>): string {
  const rows: Array<[string, unknown]> = [
    ["Endereço", p.address],
    ["Como chegar", p.address_note],
    ["Rede Wi-Fi", p.wifi_ssid],
    ["Senha do Wi-Fi", p.wifi_password],
    [`Portão${p.gate_label ? ` (${p.gate_label})` : ""} — senha temporária (código de acesso)`, p.gate_code],
    ["Portão — instruções", p.gate_instructions],
    [`Fechadura${p.lock_label ? ` (${p.lock_label})` : ""} — senha temporária (código de acesso)`, p.lock_code],
    ["Fechadura — instruções", p.lock_instructions],
    ["Instruções de check-in", p.checkin_instructions],
    ["Instruções de check-out", p.checkout_instructions],
  ];
  return rows
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${k}: ${String(v).trim()}`)
    .join("\n");
}
