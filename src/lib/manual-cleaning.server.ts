import type { ArrivalRow } from "@/lib/dashboard-arrival-types";

/**
 * AS LIMPEZAS MANUAIS NO QUADRO (02/10/2026).
 *
 * A esteira (`arrival-board.server.ts`) monta os cards a partir de reservas e
 * formulários; uma limpeza criada à mão não tem nem um nem outro. Em vez de
 * ensinar aquelas 1.300 linhas a lidar com um card sem estadia, as manuais são
 * montadas AQUI e somadas à lista de saídas só na consulta do painel
 * (`listDashboardArrivals`). Assim o assistente, os avisos por push e o
 * check-out automático — que também usam a esteira — continuam enxergando
 * apenas estadias de verdade.
 *
 * O card sai com `status: "done"`, que é o que a tela chama de "Fila de
 * Limpeza", e com `logId = "manual:<id>"` (mesma ideia do `ical:<id>` das
 * reservas sem formulário). `reservationId` fica SEMPRE nulo, mesmo quando a
 * limpeza aponta para uma reserva: nenhuma ação do card pode cair, por engano,
 * na limpeza da saída daquela reserva.
 *
 * "Aparece na fila só naquele dia" (resposta do cliente): entra a partir de
 * `manual_date` e fica até ser finalizada — atrasada continua visível, como
 * qualquer outra limpeza.
 */

type Sb = {
  from: (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export const MANUAL_LOG_PREFIX = "manual:";

export async function buildManualCleaningRows(
  supabase: unknown,
  propIds: string[],
  today: string,
): Promise<ArrivalRow[]> {
  const sb = supabase as Sb;
  if (propIds.length === 0) return [];
  const { data: raw, error } = await sb
    .from("guest_arrival_status")
    .select(
      "id, property_id, manual_date, manual_cleaning_type, manual_reservation_id, cleaning_price_override_cents, note, muted_until, done_at, created_at",
    )
    .eq("manual", true)
    .is("concluded_at", null)
    .in("property_id", propIds)
    .lte("manual_date", today)
    .order("manual_date", { ascending: true })
    .limit(500);
  // Uma falha aqui (ex.: coluna ainda não criada num ambiente novo) nunca pode
  // derrubar o quadro inteiro: as manuais só deixam de aparecer.
  if (error) {
    console.error("[manual-cleaning] falha ao listar limpezas manuais:", error);
    return [];
  }
  type Row = {
    id: string;
    property_id: string;
    manual_date: string | null;
    manual_cleaning_type: string | null;
    manual_reservation_id: string | null;
    cleaning_price_override_cents: number | null;
    note: string | null;
    muted_until: string | null;
    done_at: string | null;
    created_at: string;
  };
  const rows = (raw ?? []) as Row[];
  if (rows.length === 0) return [];

  const usedProps = Array.from(new Set(rows.map((r) => r.property_id)));
  const resIds = Array.from(
    new Set(rows.map((r) => r.manual_reservation_id).filter((v): v is string => !!v)),
  );
  const [{ data: props }, { data: res }] = await Promise.all([
    sb
      .from("properties")
      .select(
        "id, name, address, owner_contact_id, maps_url, garage_maps_url, lat, lng, wifi_ssid, wifi_password, lock_code, gate_code, checkin_time, checkout_time, cleaning_price_normal_cents, cleaning_price_full_cents",
      )
      .in("id", usedProps),
    resIds.length > 0
      ? sb
          .from("property_reservations")
          .select("id, property_id, checkin_date, checkout_date, guest_hint")
          .in("id", resIds)
      : Promise.resolve({ data: [] }),
  ]);
  type Prop = {
    id: string;
    name: string | null;
    address: string | null;
    owner_contact_id: string | null;
    maps_url: string | null;
    garage_maps_url: string | null;
    lat: number | null;
    lng: number | null;
    wifi_ssid: string | null;
    wifi_password: string | null;
    lock_code: string | null;
    gate_code: string | null;
    checkin_time: string | null;
    checkout_time: string | null;
    cleaning_price_normal_cents: number | null;
    cleaning_price_full_cents: number | null;
  };
  const propById = new Map(((props ?? []) as Prop[]).map((p) => [p.id, p]));
  type Res = {
    id: string;
    property_id: string;
    checkin_date: string;
    checkout_date: string | null;
    guest_hint: string | null;
  };
  const resById = new Map(((res ?? []) as Res[]).map((r) => [r.id, r]));

  const ownerIds = Array.from(
    new Set(
      Array.from(propById.values())
        .map((p) => p.owner_contact_id)
        .filter((v): v is string => !!v),
    ),
  );
  const owner = new Map<string, { name: string; phone: string | null; country: string | null }>();
  if (ownerIds.length > 0) {
    const { data: owners } = await sb
      .from("property_owners")
      .select("id, name, trade_name, phone, phone_country")
      .in("id", ownerIds);
    for (const o of (owners ?? []) as Array<{
      id: string;
      name: string | null;
      trade_name: string | null;
      phone: string | null;
      phone_country: string | null;
    }>) {
      owner.set(o.id, {
        name: (o.trade_name || o.name || "").trim(),
        phone: o.phone ?? null,
        country: o.phone_country ?? null,
      });
    }
  }

  // Hóspede da reserva vinculada: do formulário do guia (imóvel + entrada).
  const guestByStay = new Map<string, string>();
  if (resById.size > 0) {
    const list = Array.from(resById.values());
    const { data: logs } = await sb
      .from("guide_access_logs")
      .select("property_id, checkin_date, guest_name")
      .in("property_id", Array.from(new Set(list.map((r) => r.property_id))))
      .in("checkin_date", Array.from(new Set(list.map((r) => r.checkin_date))))
      .limit(1000);
    for (const l of (logs ?? []) as Array<{
      property_id: string;
      checkin_date: string;
      guest_name: string | null;
    }>) {
      const n = (l.guest_name ?? "").trim();
      if (!n || n.toLowerCase() === "hóspede pendente") continue;
      const k = `${l.property_id}|${l.checkin_date}`;
      if (!guestByStay.has(k)) guestByStay.set(k, n);
    }
  }

  return rows.map((r): ArrivalRow => {
    const p = propById.get(r.property_id);
    const o = p?.owner_contact_id ? owner.get(p.owner_contact_id) : undefined;
    const linked = r.manual_reservation_id ? resById.get(r.manual_reservation_id) : undefined;
    const date = r.manual_date ?? today;
    const type = r.manual_cleaning_type === "completa" ? "completa" : "normal";
    const standard =
      type === "completa"
        ? (p?.cleaning_price_full_cents ?? null)
        : (p?.cleaning_price_normal_cents ?? null);
    const guest = linked
      ? (guestByStay.get(`${linked.property_id}|${linked.checkin_date}`) ??
        (linked.guest_hint ?? "").trim())
      : "";
    return {
      logId: `${MANUAL_LOG_PREFIX}${r.id}`,
      reservationId: null,
      propertyId: r.property_id,
      propertyName: p?.name ?? null,
      ownerName: o?.name || null,
      ownerPhone: o?.phone ?? null,
      ownerPhoneCountry: o?.country ?? null,
      propertyAddress: p?.address ?? null,
      mapsUrl: p?.maps_url ?? null,
      garageMapsUrl: p?.garage_maps_url ?? null,
      lat: p?.lat ?? null,
      lng: p?.lng ?? null,
      hasPasswords: !!(p?.lock_code?.trim() || p?.gate_code?.trim()),
      hasAccessInfo: !!(
        p?.lock_code?.trim() ||
        p?.gate_code?.trim() ||
        p?.wifi_ssid?.trim() ||
        p?.wifi_password?.trim()
      ),
      openedCheckin: false,
      openedGuide: false,
      readInstructions: false,
      viewedPasswords: false,
      guestName: guest,
      guestPhone: null,
      guestPhoneCountry: null,
      guestArrivalTime: null,
      standardTime: null,
      standardTimeMax: null,
      propertyCheckinTime: p?.checkin_time ?? null,
      propertyCheckoutTime: p?.checkout_time ?? null,
      cleaningPriceNormalCents: p?.cleaning_price_normal_cents ?? null,
      cleaningPriceFullCents: p?.cleaning_price_full_cents ?? null,
      date,
      guestCheckin: linked?.checkin_date ?? date,
      guestCheckout: linked?.checkout_date ?? date,
      reservationCode: null,
      createdAt: r.created_at,
      status: "done",
      note: r.note,
      arrivalTimeOverride: null,
      arrivalDateOverride: null,
      mutedUntil: r.muted_until,
      doneAt: r.done_at,
      pendingFill: false,
      ical: { hasIcal: false, matched: false, icalCheckin: null, icalCheckout: null },
      additionalGuests: [],
      manual: {
        id: r.id,
        cleaningType: type,
        priceCents: r.cleaning_price_override_cents ?? standard,
        reservationLinked: !!linked,
      },
    };
  });
}
