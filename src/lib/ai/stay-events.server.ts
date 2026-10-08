/**
 * Check-in / checkout confirmados pelo hóspede no chat → avanço do card no
 * painel operacional, reaproveitando a mesma rotina do clique manual
 * (`runAdvanceArrival`). Só avança se aquele lado ainda estiver pendente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { propertyTimeZone, zonedTimeToUtc } from "@/lib/property-timezone";

type Stay = { reservationId: string; checkinDate: string; checkoutDate: string | null };

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function findStayForEvent(
  supabase: SupabaseClient,
  p: { propertyId: string; checkinDate: string | null; checkoutDate: string | null },
): Promise<Stay | null> {
  let q = supabase
    .from("property_reservations")
    .select("id, checkin_date, checkout_date, status")
    .eq("property_id", p.propertyId);
  if (p.checkinDate) q = q.eq("checkin_date", p.checkinDate);
  else {
    const t = todayISO();
    q = q.lte("checkin_date", t).gte("checkout_date", t);
  }
  const { data } = await q.order("checkin_date", { ascending: false }).limit(5);
  const rows = ((data ?? []) as Array<{ id: string; checkin_date: string; checkout_date: string | null; status: string | null }>)
    .filter((r) => !(r.status ?? "").toLowerCase().includes("cancel"));
  if (rows.length !== 1 && !p.checkinDate) return null; // ambíguo: não arrisca
  const r = rows[0];
  return r ? { reservationId: r.id, checkinDate: r.checkin_date, checkoutDate: r.checkout_date } : null;
}

export async function applyStayEvent(
  supabase: SupabaseClient,
  stay: Stay,
  kind: "checkin" | "checkout",
): Promise<{ ok: boolean; motivo?: string }> {
  const { data: rows } = await supabase
    .from("guest_arrival_status")
    .select("kind, status, done_at")
    .eq("reservation_id", stay.reservationId);
  const list = (rows ?? []) as Array<{ kind: string; status: string; done_at: string | null }>;
  const done = (k: string) => list.some((r) => r.kind === k && (r.status === "done" || !!r.done_at));
  const noShow = list.some((r) => r.kind === "checkin" && r.status === "no_show");
  if (noShow) return { ok: false, motivo: "marcada_nao_compareceu" };
  if (kind === "checkin" && stay.checkinDate > todayISO()) return { ok: false, motivo: "checkin_futuro" };

  const { runAdvanceArrival } = await import("@/lib/dashboard.functions");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any;
  if (kind === "checkin") {
    if (done("checkin")) return { ok: true, motivo: "ja_registrado" };
    await runAdvanceArrival(sb, { reservationId: stay.reservationId, from: "checkin" });
    return { ok: true };
  }
  if (done("checkout")) return { ok: true, motivo: "ja_registrado" };
  if (!done("checkin")) {
    await runAdvanceArrival(sb, { reservationId: stay.reservationId, from: "checkin" });
  }
  await runAdvanceArrival(sb, { reservationId: stay.reservationId, from: "checkout" });
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * HORÁRIO PERMITIDO DE CHECK-IN / CHECK-OUT (pedido explícito, 08/10/2026)
 *
 * "a IA não pode simplesmente dar o check quando alguém fizer check-in ANTES
 *  do horário permitido: ela precisa procurar contexto e entender se, em
 *  algum momento, em alguma conversa, alguém da equipe autorizou o check-in
 *  antecipado". Sem autorização: perguntar com gentileza e reforçar o
 *  horário. Check-out acima do horário permitido: informar a
 *  impossibilidade, salvo exceção autorizada pela equipe.
 *
 * A regra do horário é a MESMA do guia (`checkinLockReason`): vale o horário
 * padrão do imóvel; um horário gravado pela EQUIPE (nunca o informado pelo
 * hóspede) só vale se for ANTERIOR ao padrão.
 * ------------------------------------------------------------------ */

const hm = (v: unknown): [number, number] | null => {
  const m = String(v ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? [Number(m[1]), Number(m[2])] : null;
};
const label = (t: [number, number]) => `${String(t[0]).padStart(2, "0")}h${String(t[1]).padStart(2, "0")}`;

export type TimeWindow = {
  /** Check-in: ainda não chegou o horário permitido? */
  early: boolean;
  /** Horário permitido de check-in já considerando o da equipe (ex.: "15h00"). */
  checkinAllowed: string | null;
  /** Horário definido pela EQUIPE fora do padrão (ex.: "12h00"), se existir. */
  staffCheckin: string | null;
  /** Horário limite de check-out (ex.: "11h00"). */
  checkoutLimit: string | null;
};

export async function assessStayTimes(
  supabase: SupabaseClient,
  p: { propertyId: string; stay: Stay; now?: Date },
): Promise<TimeWindow> {
  const now = p.now ?? new Date();
  const { data: prop } = await supabase
    .from("properties")
    .select("checkin_time, checkout_time, city, country")
    .eq("id", p.propertyId)
    .maybeSingle();
  const pr = (prop ?? {}) as Record<string, unknown>;
  const tz = propertyTimeZone(pr.city as string | null, pr.country as string | null);
  const std = hm(pr.checkin_time);
  const out = hm(pr.checkout_time);

  // Horário gravado pela equipe (editor de Previsão do painel).
  const { data: st } = await supabase
    .from("guest_arrival_status")
    .select("arrival_date_override, arrival_time_override, arrival_time_source")
    .eq("reservation_id", p.stay.reservationId)
    .eq("kind", "checkin");
  const staffRow = ((st ?? []) as Array<{
    arrival_date_override: string | null;
    arrival_time_override: string | null;
    arrival_time_source: string | null;
  }>).find((r) => r.arrival_time_source === "staff" && r.arrival_time_override);
  const staffT = hm(staffRow?.arrival_time_override);

  let early = false;
  let allowed: string | null = std ? label(std) : null;
  let staffLabel: string | null = null;
  if (std) {
    const [y, mo, d] = p.stay.checkinDate.split("-").map(Number);
    let gate = zonedTimeToUtc(y, mo, d, std[0], std[1], tz).getTime();
    if (staffT) {
      const sd = (staffRow?.arrival_date_override || p.stay.checkinDate).split("-").map(Number);
      const staffGate = zonedTimeToUtc(sd[0], sd[1], sd[2], staffT[0], staffT[1], tz).getTime();
      staffLabel = label(staffT);
      if (staffGate < gate) {
        gate = staffGate;
        allowed = staffLabel;
      }
    }
    early = now.getTime() < gate;
  }
  return { early, checkinAllowed: allowed, staffCheckin: staffLabel, checkoutLimit: out ? label(out) : null };
}

export type StaffMessage = { id: string; canal: string; quando: string; nota_interna: boolean; texto: string };

const normTxt = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Mensagens DA EQUIPE (resposta humana ou nota interna) em TODAS as conversas
 * deste hóspede neste imóvel — qualquer canal (guia, chat, WhatsApp, Airbnb…).
 * Mensagens da própria IA NÃO contam: ela não pode se autorizar.
 */
export async function loadStaffMessages(
  supabase: SupabaseClient,
  p: { propertyId: string; guestName: string | null },
): Promise<StaffMessage[]> {
  const { data: convs } = await supabase
    .from("property_chat_conversations")
    .select("id, guest_name")
    .eq("property_id", p.propertyId)
    .order("created_at", { ascending: false })
    .limit(80);
  const target = normTxt(p.guestName ?? "");
  const ids = ((convs ?? []) as Array<{ id: string; guest_name: string | null }>)
    .filter((c) => !!target && !!c.guest_name && normTxt(c.guest_name) === target)
    .map((c) => c.id);
  if (ids.length === 0) return [];
  const { data: msgs } = await supabase
    .from("property_chat_messages")
    .select("id, channel, created_at, content, is_internal_note, sender_type")
    .in("conversation_id", ids)
    .or("sender_type.eq.human,is_internal_note.eq.true")
    .order("created_at", { ascending: false })
    .limit(60);
  return ((msgs ?? []) as Array<{
    id: string;
    channel: string;
    created_at: string;
    content: string;
    is_internal_note: boolean;
  }>)
    .filter((m) => (m.content ?? "").trim())
    .map((m) => ({
      id: m.id,
      canal: m.channel,
      quando: m.created_at,
      nota_interna: !!m.is_internal_note,
      texto: m.content.trim().slice(0, 500),
    }));
}

/** O trecho citado pela IA existe MESMO numa mensagem da equipe? (anti-invenção) */
export function quoteExistsInStaffMessages(quote: string, msgs: StaffMessage[]): boolean {
  const q = normTxt(quote);
  if (q.length < 12) return false;
  return msgs.some((m) => normTxt(m.texto).includes(q));
}
