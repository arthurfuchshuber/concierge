/**
 * Carga retroativa (backfill) de tudo que a Channex expõe do passado para os
 * imóveis piloto: reservas (com contatos do hóspede), conversas + mensagens do
 * Airbnb e avaliações. Idempotente — pode rodar quantas vezes quiser.
 * Somente leitura na Channex; nada é enviado ao Airbnb.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const BASE = "https://app.channex.io/api/v1";

async function get(path: string): Promise<any> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${BASE}${path}`, { headers: { "user-api-key": key, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Channex ${res.status} em ${path}`);
  return res.json();
}

async function getAll(path: string, max = 50): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page <= max; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const json = await get(`${path}${sep}pagination[page]=${page}&pagination[limit]=100`);
    const rows = (json?.data ?? []) as any[];
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out;
}

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const clean = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);

type Listing = { property_id: string; airbnb_listing_id: string };

export type BackfillResult = { reservations: number; conversations: number; messages: number; reviews: number };

export async function backfillChannexHistory(): Promise<BackfillResult> {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data: rows } = await admin.from("property_listing_raw_data").select("property_id, airbnb_listing_id");
  const byListing = new Map<string, string>(((rows ?? []) as Listing[]).map((l) => [String(l.airbnb_listing_id), l.property_id]));
  const result: BackfillResult = { reservations: 0, conversations: 0, messages: 0, reviews: 0 };
  if (!byListing.size) return result;

  // 1) Reservas (todas que a Channex devolver) com contatos do hóspede.
  const bookings = await getAll("/bookings").catch(() => []);
  const threadToBooking = new Map<string, any>();
  for (const b of bookings) {
    const a = b.attributes ?? {};
    const propertyId = byListing.get(String(a.meta?.listing_id ?? ""));
    if (!propertyId || !a.arrival_date || !a.departure_date) continue;
    const c = a.customer ?? {};
    const main = [c.name, c.surname].filter(Boolean).join(" ").trim();
    const extraNames = ((a.guests ?? a.rooms?.[0]?.guests ?? []) as any[])
      .map((g) => [g.name, g.surname].filter(Boolean).join(" ").trim())
      .filter(Boolean);
    const contacts = {
      code: clean(a.ota_reservation_code),
      unique_id: clean(a.unique_id),
      names: Array.from(new Set([main, ...extraNames].filter(Boolean))),
      phones: Array.from(new Set([digits(c.phone)].filter((p) => p.length >= 8))),
      emails: Array.from(new Set([clean(c.mail)].filter(Boolean))),
      language: clean(c.language),
      ota_thread_id: clean(a.meta?.thread_id),
    };
    if (contacts.ota_thread_id) threadToBooking.set(contacts.ota_thread_id, contacts);
    const { error } = await admin.from("property_reservations").upsert(
      {
        property_id: propertyId,
        source: "channex",
        external_uid: String(a.booking_id ?? b.id),
        checkin_date: a.arrival_date,
        checkout_date: a.departure_date,
        guest_hint: main || null,
        raw_summary: contacts.code ? `Reserva ${contacts.code}` : null,
        status: a.status === "cancelled" ? "cancelled" : "confirmed",
        synced_at: new Date().toISOString(),
        guest_contacts: contacts as never,
      } as never,
      { onConflict: "property_id,source,external_uid" },
    );
    if (!error) result.reservations++;
  }

  // 2) Conversas + mensagens do Airbnb.
  const threads = await getAll("/message_threads").catch(() => []);
  for (const t of threads) {
    const a = t.attributes ?? {};
    const propertyId = byListing.get(String(a.meta?.listing_id ?? ""));
    if (!propertyId) continue;
    const guestName =
      threadToBooking.get(String(a.ota_message_thread_id ?? ""))?.names?.[0] ??
      clean(String(a.title ?? "").replace(/^(Inquiry|Reservation|Booking|Message) from\s+/i, ""));
    const sessionId = `airbnb:${t.id}`;
    const { data: existing } = await admin
      .from("property_chat_conversations")
      .select("id")
      .eq("property_id", propertyId)
      .eq("guest_session_id", sessionId)
      .maybeSingle();
    let convId = existing?.id as string | undefined;
    if (!convId) {
      const { data: created } = await admin
        .from("property_chat_conversations")
        .insert({
          property_id: propertyId,
          guest_session_id: sessionId,
          guest_name: guestName,
          status: "resolved",
          ai_paused: false,
          created_at: a.inserted_at ? `${a.inserted_at}Z` : undefined,
          last_message_at: a.last_message_received_at ? `${a.last_message_received_at}Z` : null,
        } as never)
        .select("id")
        .single();
      convId = created?.id as string | undefined;
      if (!convId) continue;
      result.conversations++;
    }

    const msgs = await getAll(`/message_threads/${t.id}/messages`, 20).catch(() => []);
    const { data: known } = await admin
      .from("property_chat_messages")
      .select("external_id")
      .eq("conversation_id", convId)
      .not("external_id", "is", null);
    const seen = new Set(((known ?? []) as Array<{ external_id: string }>).map((k) => k.external_id));
    const toInsert = msgs
      .filter((m) => m.id && !seen.has(String(m.id)) && clean(m.attributes?.message))
      .map((m) => {
        const guest = String(m.attributes?.sender ?? "") === "guest";
        return {
          conversation_id: convId,
          role: guest ? "user" : "assistant",
          content: String(m.attributes.message),
          sender_type: guest ? "guest" : "human",
          channel: "airbnb",
          external_id: String(m.id),
          delivery_status: "delivered",
          created_at: m.attributes?.inserted_at ? `${m.attributes.inserted_at}Z` : undefined,
        };
      });
    if (toInsert.length) {
      const { error } = await admin.from("property_chat_messages").insert(toInsert as never);
      if (!error) result.messages += toInsert.length;
    }
  }

  // 3) Avaliações → anúncio do imóvel (indexadas como conhecimento da IA).
  const reviews = await getAll("/reviews").catch(() => []);
  const perProperty = new Map<string, any[]>();
  for (const r of reviews) {
    const a = r.attributes ?? {};
    const propertyId = byListing.get(String(a.meta?.listing_id ?? ""));
    const content = clean(a.content);
    if (!propertyId || !content) continue;
    const list = perProperty.get(propertyId) ?? [];
    list.push({ id: String(a.id ?? r.id), content: content.slice(0, 2000), score: a.overall_score ?? null, reply: clean(a.reply?.reply ?? a.reply), received_at: a.received_at ?? a.inserted_at ?? null });
    perProperty.set(propertyId, list);
  }
  for (const [propertyId, list] of perProperty) {
    const { data: row } = await admin.from("property_listing_raw_data").select("normalized").eq("property_id", propertyId).maybeSingle();
    const normalized = { ...(((row as any)?.normalized ?? {}) as Record<string, unknown>), reviews: list };
    await admin.from("property_listing_raw_data").update({ normalized } as never).eq("property_id", propertyId);
    result.reviews += list.length;
    const { reindexProperty } = await import("@/lib/ai/indexing.server");
    await reindexProperty(admin as never, propertyId).catch(() => null);
  }

  return result;
}
