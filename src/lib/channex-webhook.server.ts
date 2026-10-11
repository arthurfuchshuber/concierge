/**
 * Processamento da fila de webhooks do Channex.
 *
 * O endpoint público apenas enfileira o JSON bruto e responde 200 na hora;
 * este módulo transforma os itens pendentes em linhas da tabela `reservas`.
 */
const CHANNEX_BASE = "https://app.channex.io/api/v1";

type BookingAttributes = {
  id?: string;
  revision_id?: string;
  unique_id?: string;
  ota_reservation_code?: string;
  ota_name?: string;
  status?: string;
  arrival_date?: string;
  departure_date?: string;
  amount?: string | number;
  currency?: string;
  customer?: { name?: string; surname?: string; mail?: string };
  rooms?: Array<{
    room_type_id?: string;
    rate_plan_id?: string;
    checkin_date?: string;
    checkout_date?: string;
  }>;
};

async function channexGet<T>(path: string): Promise<T | null> {
  const key = (process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"]);
  if (!key) return null;
  const res = await fetch(`${CHANNEX_BASE}${path}`, {
    headers: { "user-api-key": key, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

type ResolvedBooking = BookingAttributes & { _revisionId?: string | null; _bookingId?: string | null };

/**
 * Busca sempre a REVISÃO da reserva (exigência da certificação: nunca usar
 * GET /bookings). Payloads de feed já trazem a revisão completa.
 */
async function resolveBooking(payload: unknown): Promise<ResolvedBooking | null> {
  const root = asRecord(payload);
  if (!root) return null;

  // Revisão vinda do feed (/booking_revisions/feed): { id, type: "booking_revision", attributes }.
  if (root["type"] === "booking_revision" && asRecord(root["attributes"])) {
    const a = asRecord(root["attributes"]) as BookingAttributes & { booking_id?: string };
    return { ...a, _revisionId: String(root["id"]), _bookingId: a.booking_id ?? null };
  }

  const inner = asRecord(root["payload"]) ?? root;
  const revisionId = inner["revision_id"] ?? inner["booking_revision_id"];
  const bookingId = inner["booking_id"];
  if (typeof revisionId === "string") {
    const res = await channexGet<{ data?: { id?: string; attributes?: BookingAttributes & { booking_id?: string } } }>(
      `/booking_revisions/${revisionId}`,
    );
    if (res?.data?.attributes) {
      return { ...res.data.attributes, _revisionId: res.data.id ?? revisionId, _bookingId: res.data.attributes.booking_id ?? (typeof bookingId === "string" ? bookingId : null) };
    }
  }
  return null;
}

function eventOf(payload: unknown): string | null {
  const root = asRecord(payload);
  const ev = root?.["event"];
  return typeof ev === "string" ? ev : null;
}

/** Nova reserva, alteração ou cancelamento, conforme o evento/status recebido. */
function statusOf(evento: string | null, booking: BookingAttributes): string {
  if (evento === "booking_cancellation") return "cancelled";
  if (evento === "booking_modification") return "modified";
  if (evento === "booking_new") return "new";
  return booking.status ?? "new";
}

type SupabaseAdmin = typeof import("@/integrations/supabase/client.server")["supabaseAdmin"];

const txt = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);
const numero = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** Imóvel ConciergeIA dono do quarto Channex (principal ou anúncio gêmeo). */
async function imovelDoQuarto(admin: SupabaseAdmin, roomTypeId: string | null, channexPropertyId: string | null): Promise<string | null> {
  if (roomTypeId) {
    const { data } = await admin.from("property_listing_raw_data").select("property_id").eq("channex_room_type_id", roomTypeId).limit(1);
    if (data?.[0]) return data[0].property_id as string;
    const { data: tw } = await admin.from("channex_twin_links").select("property_id").eq("twin_room_type_id", roomTypeId).eq("status", "active").limit(1);
    if (tw?.[0]) return tw[0].property_id as string;
  }
  if (channexPropertyId) {
    const { data } = await admin.from("property_listing_raw_data").select("property_id").eq("channex_property_id", channexPropertyId);
    if (data && data.length === 1) return data[0].property_id as string;
    const { data: tw } = await admin.from("channex_twin_links").select("property_id").eq("twin_channex_property_id", channexPropertyId).eq("status", "active").limit(1);
    if (tw?.[0]) return tw[0].property_id as string;
  }
  return null;
}

async function gravarReservaOficial(admin: SupabaseAdmin, booking: ResolvedBooking, roomTypeId: string | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a = booking as any;
  const propertyId = await imovelDoQuarto(admin, roomTypeId, txt(a.property_id));
  const bookingId = booking._bookingId ?? a.booking_id ?? null;
  if (!propertyId || !bookingId || !a.arrival_date || !a.departure_date) return;
  const c = a.customer ?? {};
  const main = [c.name, c.surname].filter(Boolean).join(" ").trim();
  const rooms = (a.rooms ?? []) as Array<Record<string, unknown>>;
  const extra = ((a.guests ?? rooms[0]?.["guests"] ?? []) as Array<{ name?: string; surname?: string }>)
    .map((g) => [g.name, g.surname].filter(Boolean).join(" ").trim()).filter(Boolean);
  const phone = String(c.phone ?? "").replace(/\D/g, "");
  const contacts = {
    code: txt(a.ota_reservation_code),
    unique_id: txt(a.unique_id),
    names: Array.from(new Set([main, ...extra].filter(Boolean))),
    phones: phone.length >= 8 ? [phone] : [],
    emails: txt(c.mail) ? [txt(c.mail)] : [],
    language: txt(c.language),
    ota_thread_id: txt(a.meta?.thread_id),
  };
  const { error } = await admin.from("property_reservations").upsert(
    {
      property_id: propertyId,
      source: "channex",
      external_uid: String(bookingId),
      checkin_date: a.arrival_date,
      checkout_date: a.departure_date,
      guest_hint: main || null,
      raw_summary: contacts.code ? `Reserva ${contacts.code}` : null,
      status: a.status === "cancelled" ? "cancelled" : "confirmed",
      synced_at: new Date().toISOString(),
      guest_contacts: contacts,
      amount: numero(a.amount),
      currency: txt(a.currency),
      ota_commission: numero(a.ota_commission),
      payment_collect: txt(a.payment_collect),
      payment_type: txt(a.payment_type),
      ota_name: txt(a.ota_name),
      occupancy: a.occupancy ?? rooms[0]?.["occupancy"] ?? null,
      daily_rates: rooms.map((r) => ({ room_type_id: r["room_type_id"], rate_plan_id: r["rate_plan_id"], amount: r["amount"], days: r["days"] })),
      raw_payload: booking,
    } as never,
    { onConflict: "property_id,source,external_uid" },
  );
  if (error) throw new Error(error.message);
}

async function aplicarReserva(supabaseAdmin: SupabaseAdmin, payload: unknown) {
  const booking = await resolveBooking(payload);
  if (!booking) throw new Error("Payload sem dados de reserva reconhecíveis.");

  const codigo =
    booking.unique_id ?? booking.ota_reservation_code ?? booking.id ?? booking.revision_id ?? null;
  if (!codigo) throw new Error("Reserva sem código identificador.");

  const room = booking.rooms?.[0] ?? {};
  /* IDENTIFICADORES DO CANAL SÓ VALEM SE FOREM UUID (23/09/2026).
     O quarto/tarifa vinham do corpo do webhook e eram concatenados num filtro
     de busca. Um valor com vírgula ou ponto mudava o filtro e podia amarrar a
     reserva ao imóvel errado — de outro anfitrião, inclusive. */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const somenteUuid = (v: unknown): string | null =>
    typeof v === "string" && UUID.test(v.trim()) ? v.trim() : null;
  const roomTypeId = somenteUuid(room.room_type_id);
  const ratePlanId = somenteUuid(room.rate_plan_id);

  // Vincula ao imóvel pelo UUID do quarto ou da tarifa criados na sincronização.
  let propriedadeId: string | null = null;
  if (roomTypeId || ratePlanId) {
    const { data: prop } = await supabaseAdmin
      .from("propriedades")
      .select("id")
      .or(
        [
          roomTypeId ? `channex_room_type_id.eq.${roomTypeId}` : null,
          ratePlanId ? `channex_rate_plan_id.eq.${ratePlanId}` : null,
        ]
          .filter(Boolean)
          .join(","),
      )
      .limit(1)
      .maybeSingle();
    propriedadeId = prop?.id ?? null;
  }


  const nome = [booking.customer?.name, booking.customer?.surname].filter(Boolean).join(" ").trim();
  const valor = booking.amount != null ? Number(booking.amount) : null;

  const { error } = await supabaseAdmin.from("reservas").upsert(
    {
      codigo_reserva_channex: codigo,
      propriedade_id: propriedadeId,
      channex_booking_id: booking._bookingId ?? booking.id ?? null,
      channex_revision_id: booking._revisionId ?? booking.revision_id ?? null,
      channex_room_type_id: roomTypeId,
      channex_rate_plan_id: ratePlanId,
      nome_hospede: nome || null,
      email_hospede: booking.customer?.mail ?? null,
      data_checkin: booking.arrival_date ?? room.checkin_date ?? null,
      data_checkout: booking.departure_date ?? room.checkout_date ?? null,
      valor_total: Number.isFinite(valor as number) ? valor : null,
      moeda: booking.currency ?? null,
      status: statusOf(eventOf(payload), booking),
      ota_name: booking.ota_name ?? null,
      payload: booking as never,
    },
    { onConflict: "codigo_reserva_channex" },
  );
  if (error) throw new Error(error.message);

  // Reserva oficial do imóvel (API, nunca iCal): grava em property_reservations.
  await gravarReservaOficial(supabaseAdmin, booking, roomTypeId);

  // Guarda a revisão completa, sem perder nenhum campo.
  const { saveRawRecords } = await import("@/lib/channex-raw.server");
  await saveRawRecords([
    { entity_type: "booking_revision", channex_id: String(booking._revisionId ?? booking.revision_id ?? codigo), parent_id: booking._bookingId ?? null, payload: booking, source: "webhook" },
  ]);

  // Booking Acknowledge (obrigatório): só depois de gravar com sucesso. Idempotente.
  if (booking._revisionId) {
    const { ackBookingRevision } = await import("@/lib/channex-ari.server");
    const ack = await ackBookingRevision(booking._revisionId, booking._bookingId ?? null);
    if (!ack.ok) throw new Error("Falha ao confirmar (ACK) a revisão na Channex.");
  }

  // Reserva nova/alterada/cancelada: reexporta a disponibilidade real (Channex → PriceLabs).
  const { syncPilotAvailability } = await import("@/lib/channex-mapping.server");
  await syncPilotAvailability().catch((e) => console.error("[channex] sync disponibilidade", e));
}

/** Puxa revisões ainda não confirmadas (feed) e processa + confirma cada uma. */
export async function puxarFeedReservas(): Promise<{ recebidas: number; processadas: number; falhas: string[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const res = await channexGet<{ data?: Array<Record<string, unknown>> }>(`/booking_revisions/feed`);
  const itens = res?.data ?? [];
  let processadas = 0;
  const falhas: string[] = [];
  for (const item of itens) {
    try {
      await aplicarReserva(supabaseAdmin, item);
      processadas += 1;
    } catch (e) {
      falhas.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { recebidas: itens.length, processadas, falhas };
}

/** Processa os itens pendentes da fila. Seguro para rodar em paralelo/repetidamente. */
export async function processarFilaChannex(limite = 20): Promise<{ processados: number; falhas: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pendentes } = await supabaseAdmin
    .from("fila_webhooks_channex")
    .select("id, payload, tentativas")
    .eq("processado", false)
    .order("id", { ascending: true })
    .limit(limite);

  let processados = 0;
  let falhas = 0;
  for (const item of pendentes ?? []) {
    try {
      const evento = eventOf(item.payload);
      // Reservas e mensagens são tratadas; os demais eventos são apenas marcados como lidos.
      if (evento === "message" || evento === "new_message") {
        const { handleChannexMessage } = await import("@/lib/channex-messages.server");
        await handleChannexMessage(item.payload);
      } else if (!evento || evento.startsWith("booking")) {
        await aplicarReserva(supabaseAdmin, item.payload);
      } else {
        // Qualquer outro evento (quarto, propriedade, tarifa, canal, anúncio...):
        // relê as entidades da Channex e grava tudo (throttle de 5 min no banco).
        const { syncChannexEntities } = await import("@/lib/channex-entity-sync.server");
        await syncChannexEntities({ source: `webhook:${evento}` });
      }
      await supabaseAdmin
        .from("fila_webhooks_channex")
        .update({ processado: true, processado_em: new Date().toISOString(), erro: null })
        .eq("id", item.id);
      processados += 1;
    } catch (e) {
      falhas += 1;
      const tentativas = (item.tentativas ?? 0) + 1;
      await supabaseAdmin
        .from("fila_webhooks_channex")
        .update({
          tentativas,
          erro: e instanceof Error ? e.message : String(e),
          // Após 5 tentativas paramos de reprocessar para não travar a fila.
          processado: tentativas >= 5,
          processado_em: tentativas >= 5 ? new Date().toISOString() : null,
        })
        .eq("id", item.id);
    }
  }
  return { processados, falhas };
}

/** Guarda o JSON bruto na fila. */
export async function enfileirarWebhookChannex(payload: unknown): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ev = eventOf(payload);
  const root = asRecord(payload);
  const { saveRawRecords } = await import("@/lib/channex-raw.server");
  await saveRawRecords([
    { entity_type: `webhook:${ev ?? "unknown"}`, channex_id: crypto.randomUUID(), channex_property_id: typeof root?.["property_id"] === "string" ? (root["property_id"] as string) : null, payload, source: "webhook" },
  ]).catch(() => 0);
  const { error } = await supabaseAdmin.from("fila_webhooks_channex").insert({
    payload: payload as never,
    evento: eventOf(payload),
  });
  if (error) throw new Error(error.message);
}
