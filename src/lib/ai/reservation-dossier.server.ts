/**
 * Dossiê completo da reserva oficial para a IA (todos os canais).
 *
 * Fonte autoritativa: reserva confirmada localizada pelo CÓDIGO (ou pelo
 * booking da Channex). Reúne código, datas, noites, ocupação, valores,
 * diárias, taxas, pagamento e política de cancelamento do anúncio.
 * Nunca busca por nome: consulta sem código não gera dossiê.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export type ReservationDossier = {
  code: string | null;
  checkin: string | null;
  checkout: string | null;
  active: boolean;
  text: string;
};

const money = (v: unknown, cur: string) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${cur} ${n.toFixed(2).replace(".", ",")}`;
};

function notesField(notes: string, label: string): string | null {
  const m = notes.match(new RegExp(`${label}:\\s*([^\\n]+)`, "i"));
  const v = m?.[1]?.trim();
  return v && v !== "N/A" ? v : null;
}

export async function loadReservationDossier(
  admin: Admin,
  params: { propertyId: string; code?: string | null; bookingId?: string | null },
): Promise<ReservationDossier | null> {
  const rawCode = (params.code ?? "").trim().toUpperCase();
  // Código de reserva só aceita letras, números e hífen — nada que vire filtro/curinga.
  const code = /^[A-Z0-9-]{3,40}$/.test(rawCode) ? rawCode : null;
  if (!code && !params.bookingId) return null;
  const okStatus = (s: unknown) => !/cancel|inquiry|request|pending|declin|expired/i.test(String(s ?? ""));

  // 1) Reserva vinda da Channex (dados completos).
  let row: Record<string, any> | null = null;
  {
    let q = admin
      .from("reservas")
      .select("codigo_reserva_channex, channex_booking_id, nome_hospede, data_checkin, data_checkout, valor_total, moeda, status, ota_name, payload")
      .order("created_at", { ascending: false })
      .limit(5);
    q = params.bookingId
      ? q.eq("channex_booking_id", params.bookingId)
      : q.ilike("codigo_reserva_channex", `%${code}`);
    const { data } = await q;
    row = ((data ?? []) as Record<string, any>[]).find((r) => okStatus(r.status)) ?? null;
  }

  // 2) Reserva oficial do imóvel (pode ter só datas).
  let pr: Record<string, any> | null = null;
  if (code) {
    // Busca parametrizada (sem montar filtro em texto): o código nunca vira sintaxe de consulta.
    const cols = "checkin_date, checkout_date, status, guest_hint, guest_contacts, amount, currency, occupancy, ota_name, payment_collect";
    const [byHint, byCode] = await Promise.all([
      admin.from("property_reservations").select(cols).eq("property_id", params.propertyId).eq("guest_hint", code).limit(5),
      admin.from("property_reservations").select(cols).eq("property_id", params.propertyId).eq("guest_contacts->>code", code).limit(5),
    ]);
    const all = [...((byHint.data ?? []) as Record<string, any>[]), ...((byCode.data ?? []) as Record<string, any>[])];
    pr = all.find((r) => okStatus(r.status)) ?? null;
  }
  if (!row && !pr) return null;

  const { data: prop } = await admin
    .from("properties")
    .select("checkin_time, checkout_time, airbnb_cancellation_policy")
    .eq("id", params.propertyId)
    .maybeSingle();
  const p = (prop ?? {}) as Record<string, any>;

  const payload = (row?.payload ?? {}) as Record<string, any>;
  const room = Array.isArray(payload.rooms) ? payload.rooms[0] ?? {} : {};
  const cur = String(row?.moeda ?? payload.currency ?? pr?.currency ?? "BRL");
  const checkin = String(row?.data_checkin ?? payload.arrival_date ?? pr?.checkin_date ?? "").slice(0, 10) || null;
  const checkout = String(row?.data_checkout ?? payload.departure_date ?? pr?.checkout_date ?? "").slice(0, 10) || null;
  const nights =
    checkin && checkout ? Math.round((Date.parse(checkout) - Date.parse(checkin)) / 86_400_000) : null;
  const occ = (payload.occupancy ?? room.occupancy ?? pr?.occupancy ?? {}) as Record<string, any>;
  const notes = String(payload.notes ?? "");
  const pets = notesField(notes, "Number Of Pets");
  const customer = (payload.customer ?? {}) as Record<string, any>;
  const guestFull = [customer.name, customer.surname].filter(Boolean).join(" ") || row?.nome_hospede || null;
  const days = (room.days ?? {}) as Record<string, string>;
  const services = (Array.isArray(room.services) ? room.services : []) as Array<Record<string, any>>;
  const total = row?.valor_total ?? payload.amount ?? pr?.amount;
  const finalCode = code ?? (String(row?.codigo_reserva_channex ?? payload.ota_reservation_code ?? "").replace(/^ABB-/, "") || null);
  const today = new Date().toISOString().slice(0, 10);
  const active = !!checkout && checkout >= today;
  const fmt = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

  const lines = [
    finalCode ? `Código da reserva: ${finalCode}` : "",
    `Status: confirmada${active ? " (ativa)" : " (encerrada)"}`,
    row?.ota_name || payload.ota_name || pr?.ota_name ? `Plataforma: ${row?.ota_name ?? payload.ota_name ?? pr?.ota_name}` : "",
    guestFull ? `Hóspede titular (apenas referência de cadastro; NÃO é necessariamente quem está escrevendo — chame pelo nome do remetente da mensagem atual): ${guestFull}` : "",
    checkin ? `Check-in: ${fmt(checkin)}${p.checkin_time ? ` a partir das ${String(p.checkin_time).slice(0, 5)}` : ""}` : "",
    checkout ? `Check-out: ${fmt(checkout)}${p.checkout_time ? ` até as ${String(p.checkout_time).slice(0, 5)}` : ""}` : "",
    nights ? `Noites: ${nights}` : "",
    occ.adults != null
      ? `Hóspedes: ${Number(occ.adults ?? 0) + Number(occ.children ?? 0)} (adultos ${occ.adults ?? 0}, crianças ${occ.children ?? 0}, bebês ${occ.infants ?? 0})`
      : "",
    pets != null ? `Pets: ${pets}` : "",
    total != null ? `Valor total da reserva: ${money(total, cur)}` : "",
    Object.keys(days).length
      ? `Diárias: ${Object.entries(days).sort().map(([d, v]) => `${fmt(d)} ${money(v, cur)}`).join("; ")}`
      : "",
    ...services.map((s) => `${s.name ?? s.type}: ${money(s.total_price, cur)}`),
    notesField(notes, "Extra Guest Fee") ? `Taxa de hóspede extra: ${cur} ${notesField(notes, "Extra Guest Fee")}` : "",
    payload.payment_collect || pr?.payment_collect
      ? `Pagamento: ${(payload.payment_collect ?? pr?.payment_collect) === "ota" ? "recebido pela plataforma" : "recebido pelo anfitrião"}`
      : "",
    p.airbnb_cancellation_policy ? `Política de cancelamento do anúncio: ${String(p.airbnb_cancellation_policy).slice(0, 600)}` : "",
  ].filter(Boolean);

  return { code: finalCode, checkin, checkout, active, text: lines.join("\n") };
}
