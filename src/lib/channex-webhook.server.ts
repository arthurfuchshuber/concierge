/**
 * Processamento da fila de webhooks do Channex.
 *
 * O endpoint público apenas enfileira o JSON bruto e responde 200 na hora;
 * este módulo transforma os itens pendentes em linhas da tabela `reservas`.
 */
const CHANNEX_BASE = "https://staging.channex.io/api/v1";

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
  const key = process.env["CHANNEX_STAGING_API_KEY"];
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

/** Extrai (ou busca no Channex) os dados completos da reserva de um payload de webhook. */
async function resolveBooking(payload: unknown): Promise<BookingAttributes | null> {
  const root = asRecord(payload);
  if (!root) return null;

  // 1) O webhook pode vir com os dados completos (send_data = true).
  const inner = asRecord(root["payload"]) ?? root;
  const data = asRecord(inner["data"]) ?? inner;
  const attributes = asRecord(data["attributes"]) ?? data;
  if (Array.isArray(attributes["rooms"]) || attributes["arrival_date"]) {
    return attributes as BookingAttributes;
  }

  // 2) Caso contrário, buscamos a revisão / reserva na API.
  const revisionId = inner["revision_id"] ?? attributes["revision_id"];
  const bookingId = inner["booking_id"] ?? attributes["booking_id"] ?? attributes["id"];
  if (typeof revisionId === "string") {
    const res = await channexGet<{ data?: { attributes?: BookingAttributes } }>(
      `/booking_revisions/${revisionId}`,
    );
    if (res?.data?.attributes) return res.data.attributes;
  }
  if (typeof bookingId === "string") {
    const res = await channexGet<{ data?: { attributes?: BookingAttributes } }>(`/bookings/${bookingId}`);
    if (res?.data?.attributes) return res.data.attributes;
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
      channex_booking_id: booking.id ?? null,
      channex_revision_id: booking.revision_id ?? null,
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
      // Só reservas nos interessam; os demais eventos são apenas marcados como lidos.
      if (!evento || evento.startsWith("booking")) {
        await aplicarReserva(supabaseAdmin, item.payload);
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
  const { error } = await supabaseAdmin.from("fila_webhooks_channex").insert({
    payload: payload as never,
    evento: eventOf(payload),
  });
  if (error) throw new Error(error.message);
}
