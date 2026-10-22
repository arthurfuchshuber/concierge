import { structuredListing, houseRulesText } from "@/lib/listing-structured";
/**
 * Ingestão do anúncio oficial do Airbnb (via Channex) para o repositório
 * central do imóvel (`property_listing_raw_data`). Somente leitura na Channex:
 * nunca envia ARI. Restrito a uma allowlist de anúncios em validação.
 */
const CHANNEX_BASE = "https://app.channex.io/api/v1";
export const AIRBNB_CHANNEL_ID = "9f7f35ab-3b40-4b84-8483-693122d9604b";
const CLAYTON_CHANNEL_ID = "24c871d9-d6fd-46f5-944d-a38b8a4df189";

type PilotListing = { slug: string; channelId: string; roomTypeId?: string; channexPropertyId?: string };

/** Anúncios principais liberados (piloto). airbnb listing id → imóvel oficial. */
export const PILOT_LISTING_CONFIG: Record<string, PilotListing> = {
  "1081915824812637088": { slug: "charmosa", channelId: AIRBNB_CHANNEL_ID },
  "1668247859065922881": { slug: "studio101", channelId: CLAYTON_CHANNEL_ID, roomTypeId: "f5911861-2f36-473a-943d-8c31598c22f6", channexPropertyId: "032fb0bc-9d2d-450f-9d9a-cf8da9b9ad60" },
  "1668250046816777608": { slug: "studio102", channelId: CLAYTON_CHANNEL_ID, roomTypeId: "4151bb96-1bbc-4f75-b54a-e745408a00e1", channexPropertyId: "a9110e74-d7b2-4d72-8b9a-a38f7014f2dc" },
  "1668251215421954022": { slug: "studio103", channelId: CLAYTON_CHANNEL_ID, roomTypeId: "82acb151-c3b5-4b78-bcff-362ed42ac86b", channexPropertyId: "b94a9b9a-899f-438b-a0a2-3e2e84d31017" },
  "1668252578084352769": { slug: "studio104", channelId: CLAYTON_CHANNEL_ID, roomTypeId: "4f33f351-cfa7-46f6-9184-024b8e4cbac3", channexPropertyId: "0376fdc7-aedf-49c3-9ee6-d524fd6d2a6c" },
  "1668254267295787925": { slug: "studio105", channelId: CLAYTON_CHANNEL_ID, roomTypeId: "8b2f3287-551d-4407-b48c-c5ce0727fe7a", channexPropertyId: "45ab6dee-01c4-4c9b-9898-8e43567d1bca" },
};

/** Anúncios gêmeos (mesma unidade física): anúncio secundário → anúncio principal. */
export const LISTING_ALIASES: Record<string, string> = {
  "1792880398875841438": "1668247859065922881", // Apartamento 101 → Studio 101
  "1792882876333057974": "1668250046816777608", // Apartamento 102 → Studio 102
  "1792868987771365608": "1668251215421954022", // Studio 103 Ponte da Amizade → Studio 103
  "901415199481975174": "1081915824812637088", // Belíssima Casa → Casa Charmosa
};

export const primaryListingId = (id: string) => LISTING_ALIASES[id] ?? id;

/** Inclui nos apelidos os pares gêmeos cadastrados pelo sistema (qualquer cliente). */
export async function refreshListingAliases() {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any).from("channex_twin_links").select("twin_listing_id, primary_listing_id").eq("status", "active");
    for (const r of (data ?? []) as any[]) LISTING_ALIASES[String(r.twin_listing_id)] = String(r.primary_listing_id);
  } catch (e) {
    console.error("[channex] apelidos de gêmeos", e);
  }
}

/** Versão assíncrona: sempre considera os pares mais recentes do banco. */
export async function resolvePrimaryListingId(id: string) {
  await refreshListingAliases();
  return primaryListingId(id);
}

/** Compat: airbnb listing id → slug. */
export const PILOT_LISTINGS: Record<string, string> = Object.fromEntries(
  Object.entries(PILOT_LISTING_CONFIG).map(([id, c]) => [id, c.slug]),
);

export type Fact = { key: string; title: string; content: string };

export async function channexGet<T>(path: string): Promise<T> {
  const key = process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("Chave Channex ausente.");
  const res = await fetch(`${CHANNEX_BASE}${path}`, { headers: { "user-api-key": key, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Channex ${res.status}`);
  return (await res.json()) as T;
}

const yn = (v: unknown) => (v === true ? "permitido" : v === false ? "não permitido" : null);
const brl = (v: unknown) => (typeof v === "number" ? `R$ ${v.toFixed(2).replace(".", ",")}` : null);

const FEE_LABEL: Record<string, string> = {
  PASS_THROUGH_CLEANING_FEE: "Taxa de limpeza",
  PASS_THROUGH_SHORT_TERM_CLEANING_FEE: "Taxa de limpeza para estadias curtas",
  PASS_THROUGH_PET_FEE: "Taxa de pet",
  PASS_THROUGH_RESORT_FEE: "Taxa de resort",
  PASS_THROUGH_LINEN_FEE: "Taxa de roupa de cama",
};
const PERIOD: Record<string, string> = { PER_BOOKING: "por reserva", PER_NIGHT: "por noite" };
const CHARGE: Record<string, string> = { PER_GROUP: "", PER_PET: "por pet", PER_PERSON: "por pessoa" };

/** Converte as configurações do anúncio em fatos legíveis para a IA. */
export function normalizeListing(meta: Record<string, unknown>, s: Record<string, any>): Fact[] {
  const facts: Fact[] = [];
  const add = (key: string, title: string, lines: Array<string | null | undefined>) => {
    const content = lines.filter(Boolean).join("\n");
    if (content) facts.push({ key, title, content });
  };
  const b = s.booking_setting ?? {};
  const g = b.guest_controls ?? {};
  const p = s.pricing_setting ?? {};
  const a = s.availability_rule ?? {};

  add("identificacao", "Identificação", [
    meta.title ? `Título do anúncio: ${String(meta.title)}` : null,
    meta.city ? `Cidade: ${String(meta.city)}` : null,
    Array.isArray(meta.occupancies) && meta.occupancies.length ? `Capacidade máxima: ${Math.max(...(meta.occupancies as number[]))} hóspedes` : null,
  ]);
  add("horarios", "Horários de check-in e check-out", [
    b.check_in_time_start ? `Check-in a partir das ${b.check_in_time_start}h${b.check_in_time_end ? ` até as ${b.check_in_time_end}h` : ""}` : null,
    b.check_out_time != null ? `Check-out até as ${b.check_out_time}h` : null,
  ]);
  add("regras", "Regras da casa", [
    yn(g.allows_children_as_host) ? `Crianças: ${yn(g.allows_children_as_host)}` : null,
    yn(g.allows_infants_as_host) ? `Bebês: ${yn(g.allows_infants_as_host)}` : null,
    yn(g.allows_pets_as_host) ? `Animais de estimação: ${yn(g.allows_pets_as_host)}${g.pet_capacity ? ` (até ${g.pet_capacity})` : ""}` : null,
    yn(g.allows_events_as_host) ? `Festas e eventos: ${yn(g.allows_events_as_host)}` : null,
    yn(g.allows_smoking_as_host) ? `Fumar: ${yn(g.allows_smoking_as_host)}` : null,
    g.children_not_allowed_details ? `Detalhe sobre crianças: ${g.children_not_allowed_details}` : null,
  ]);
  for (const [i, e] of ((b.listing_expectations_for_guests ?? []) as Array<{ type?: string; added_details?: string }>).entries()) {
    const label = e.type === "surveillance" ? "Câmeras de segurança" : `Aviso ao hóspede (${e.type ?? "geral"})`;
    add(`aviso_${i}`, label, [e.added_details ?? "Declarado no anúncio."]);
  }
  if (b.instant_book_welcome_message) add("boas_vindas", "Mensagem de reserva/regras ao hóspede", [String(b.instant_book_welcome_message)]);
  const cp = b.cancellation_policy_settings ?? {};
  add("cancelamento", "Política de cancelamento", [
    cp.cancellation_policy_category ? `Categoria: ${cp.cancellation_policy_category}` : null,
    cp.non_refundable_price_factor ? `Opção não reembolsável com fator ${cp.non_refundable_price_factor}` : null,
  ]);
  add("precos", "Parâmetros de preço do anúncio (referência; preço final varia por data)", [
    p.default_daily_price != null ? `Diária base: ${brl(p.default_daily_price)}` : null,
    p.guests_included ? `Hóspedes incluídos na diária: ${p.guests_included}` : null,
    p.price_per_extra_person ? `Por hóspede adicional: ${brl(p.price_per_extra_person)} por noite` : null,
    p.weekend_price ? `Diária de fim de semana: ${brl(p.weekend_price)}` : null,
    p.weekly_price_factor ? `Desconto semanal: fator ${p.weekly_price_factor}` : null,
    p.monthly_price_factor ? `Desconto mensal: fator ${p.monthly_price_factor}` : null,
    p.security_deposit ? `Caução: ${brl(p.security_deposit)}` : null,
    ...((p.standard_fees ?? []) as Array<Record<string, any>>).map((f) =>
      [FEE_LABEL[f.fee_type] ?? f.fee_type, brl(f.amount), PERIOD[f.charge_period] ?? "", CHARGE[f.charge_type] ?? ""].filter(Boolean).join(" "),
    ),
  ]);
  add("estadia", "Estadia mínima, máxima e antecedência", [
    a.default_min_nights ? `Mínimo padrão: ${a.default_min_nights} noite(s)` : null,
    a.default_max_nights ? `Máximo: ${a.default_max_nights} noites` : null,
    a.booking_lead_time != null ? `Antecedência mínima: ${a.booking_lead_time} dia(s)` : null,
    a.max_days_notice ? `Reservas abertas até ${a.max_days_notice} dias no futuro` : null,
    a.instant_booking_allowed_category ? `Reserva instantânea: ${a.instant_booking_allowed_category === "everyone" ? "para todos" : a.instant_booking_allowed_category}` : null,
    ...((a.seasonal_min_nights ?? []) as Array<{ start_date: string; end_date: string; min_nights: number }>)
      .slice()
      .sort((x, y) => x.start_date.localeCompare(y.start_date))
      .map((x) => `De ${x.start_date} a ${x.end_date}: mínimo ${x.min_nights} noite(s)`),
  ]);
  return facts;
}

/** Sincroniza apenas os anúncios piloto. Retorna o que foi gravado. */
export async function syncPilotListings(): Promise<Array<{ listingId: string; propertyId: string; facts: number }>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  type Ch = { data: { attributes: { properties: string[]; rate_plans: Array<{ rate_plan_id: string; settings: Record<string, any> }> } } };
  const channels = new Map<string, { channel: Ch; metas: Array<Record<string, unknown>> }>();
  for (const channelId of new Set(Object.values(PILOT_LISTING_CONFIG).map((c) => c.channelId))) {
    const [channel, listings] = await Promise.all([
      channexGet<Ch>(`/channels/${channelId}`),
      channexGet<{ data: { listing_id_dictionary: { values: Array<Record<string, unknown>> } } }>(`/channels/${channelId}/action/listings`),
    ]);
    channels.set(channelId, { channel, metas: listings.data?.listing_id_dictionary?.values ?? [] });
  }
  const out: Array<{ listingId: string; propertyId: string; facts: number }> = [];

  const { data: pausedRows } = await supabaseAdmin
    .from("property_listing_raw_data" as never)
    .select("airbnb_listing_id")
    .not("sync_paused_at" as never, "is", null);
  const paused = new Set(((pausedRows ?? []) as Array<{ airbnb_listing_id: string | null }>).map((r) => String(r.airbnb_listing_id)));

  for (const [listingId, cfg] of Object.entries(PILOT_LISTING_CONFIG)) {
    if (paused.has(listingId)) continue; // anúncio desativado na ficha do proprietário: não sincroniza
    const slug = cfg.slug;
    const ctx = channels.get(cfg.channelId);
    if (!ctx) continue;
    const { channel, metas } = ctx;
    const { data: prop } = await supabaseAdmin.from("properties").select("id, owner_id").eq("slug", slug).maybeSingle();
    if (!prop) continue;
    // Sem mapeamento de tarifa (não somos PMS): reaproveita as últimas configurações lidas.
    const { data: prev } = await supabaseAdmin
      .from("property_listing_raw_data" as never)
      .select("raw_settings, channex_rate_plan_id, channex_room_type_id, listing_meta, normalized")
      .eq("property_id", prop.id)
      .maybeSingle();
    const prevRow = prev as { raw_settings?: Record<string, any>; channex_rate_plan_id?: string; channex_room_type_id?: string } | null;
    const live = channel.data.attributes.rate_plans.find((r) => String(r.settings?.listing_id) === listingId);
    // Sem mapeamento: ainda grava identidade + anúncio público (somente leitura).
    const rp = live ?? { rate_plan_id: prevRow?.channex_rate_plan_id ?? "", settings: prevRow?.raw_settings ?? {} };
    const meta = metas.find((m) => String(m.id) === listingId) ?? {};

    const ratePlan = live
      ? await channexGet<{ data: { relationships?: { room_type?: { data?: { id: string } } } } }>(`/rate_plans/${rp.rate_plan_id}`).catch(() => null)
      : null;
    // A Channex não entrega descrição nem comodidades: lê do anúncio público do Airbnb.
    const pub = await fetchPublicListing(listingId).catch(() => null);
    const facts = [...normalizeListing(meta, rp.settings), ...(pub ? publicFacts(pub) : [])];
    const { error } = await supabaseAdmin.from("property_listing_raw_data" as never).upsert(
      {
        property_id: prop.id,
        owner_id: prop.owner_id,
        channex_channel_id: cfg.channelId,
        channex_property_id: cfg.channexPropertyId ?? channel.data.attributes.properties[0] ?? null,
        channex_room_type_id: ratePlan?.data?.relationships?.room_type?.data?.id ?? cfg.roomTypeId ?? prevRow?.channex_room_type_id ?? null,
        channex_rate_plan_id: rp.rate_plan_id || null,
        airbnb_listing_id: listingId,
        listing_meta: meta,
        raw_settings: rp.settings,
        normalized: { ...(((prev as { normalized?: Record<string, unknown> } | null)?.normalized) ?? {}), facts, public_listing: pub, ...structuredListing(rp.settings, Boolean((((prev as { normalized?: Record<string, any> } | null)?.normalized) ?? {})["cohosts"]?.length)) },
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "property_id" },
    );
    if (error) throw new Error(error.message);

    const { reindexProperty } = await import("@/lib/ai/indexing.server");
    await reindexProperty(supabaseAdmin as never, prop.id as string).catch(() => undefined);
    out.push({ listingId, propertyId: prop.id as string, facts: facts.length });
  }
  return out;
}

export type PublicListing = { descriptions: string[]; amenities: string[]; unavailable: string[] };

const stripHtml = (h: string) =>
  h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Lê a página pública do anúncio (descrição completa, "o que você vai receber", comodidades). Somente leitura. */
export async function fetchPublicListing(listingId: string): Promise<PublicListing | null> {
  // Leitura nativa (custo zero): até 2 tentativas com timeout, para o scrap não falhar à toa.
  let html: string | null = null;
  for (let i = 0; i < 2 && !html; i++) {
    const res = await fetch(`https://www.airbnb.com.br/rooms/${listingId}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9" },
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
    if (res?.ok) html = await res.text().catch(() => null);
  }
  if (!html) return null;
  const m = html.match(/<script id="data-deferred-state-0"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let root: unknown;
  try { root = JSON.parse(m[1]!); } catch { return null; }
  const descriptions = new Set<string>();
  const amenities = new Set<string>();
  const unavailable = new Set<string>();
  const walk = (n: any, depth: number) => {
    if (!n || typeof n !== "object" || depth > 40) return;
    if (Array.isArray(n)) { for (const x of n) walk(x, depth + 1); return; }
    if (typeof n.htmlText === "string") { const t = stripHtml(n.htmlText); if (t.length > 20) descriptions.add(t); }
    if (typeof n.__typename === "string" && /Amenity/i.test(n.__typename) && typeof n.title === "string") {
      const label = [n.title, typeof n.subtitle === "string" && n.subtitle ? `(${n.subtitle})` : ""].join(" ").trim();
      (n.available === false ? unavailable : amenities).add(label);
    }
    for (const v of Object.values(n)) walk(v, depth + 1);
  };
  walk(root, 0);
  return { descriptions: [...descriptions], amenities: [...amenities], unavailable: [...unavailable] };
}

export function publicFacts(p: PublicListing): Fact[] {
  const out: Fact[] = [];
  p.descriptions.forEach((d, i) => out.push({ key: `descricao_${i}`, title: "Descrição do anúncio no Airbnb (inclui o que o hóspede recebe)", content: d }));
  if (p.amenities.length) out.push({ key: "comodidades", title: "Comodidades oferecidas (anúncio Airbnb)", content: p.amenities.join("\n") });
  if (p.unavailable.length) out.push({ key: "comodidades_ausentes", title: "Comodidades NÃO oferecidas (anúncio Airbnb)", content: p.unavailable.join("\n") });
  return out;
}


const hhmm = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (!t) return null;
  return /^\d{1,2}$/.test(t) ? `${t.padStart(2, "0")}:00` : /^\d{1,2}:\d{2}$/.test(t) ? `${t.padStart(5, "0")}` : null;
};

/**
 * Airbnb é a fonte soberana: SUBSTITUI integralmente os campos visíveis do imóvel
 * (`properties`) e os títulos dos anúncios gêmeos (`channex_twin_links`).
 * Só grava o que o anúncio informou (campo ausente não zera o existente).
 * Somente leitura na Channex: nunca envia ARI/preço.
 */
export async function applyListingToProperty(args: {
  propertyId: string;
  listingId: string;
  meta: Record<string, unknown>;
  settings?: Record<string, any> | null;
  pub?: PublicListing | null;
}): Promise<{ title: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { listingTitle } = await import("@/lib/channex-entity-sync.server");
  const cleanTitle = listingTitle(args.meta.title);
  const b = (args.settings?.booking_setting ?? {}) as Record<string, any>;
  const patch: Record<string, unknown> = {};
  if (cleanTitle) patch["name"] = cleanTitle;
  const cin = hhmm(b.check_in_time_start);
  if (cin) patch["checkin_time"] = cin;
  const cout = hhmm(b.check_out_time);
  if (cout) patch["checkout_time"] = cout;
  const occ = Array.isArray(args.meta.occupancies) ? (args.meta.occupancies as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n > 0) : [];
  const guests = occ.length ? Math.max(...occ) : Number(args.settings?.pricing_setting?.guests_included) || null;
  if (guests) patch["airbnb_guest_count"] = Math.min(200, guests);
  // Campos estruturados (17/10/2026): janela de check-in, reserva instantânea,
  // política padrão e regras. Sempre refletem o anúncio; textos livres do
  // anfitrião só são preenchidos quando estão vazios.
  const st = structuredListing(args.settings, false);
  if (st.checkin_window.end) patch["checkin_time_max"] = st.checkin_window.end;
  if (st.instant_booking_enabled !== null) patch["airbnb_instant_booking"] = st.instant_booking_enabled;
  if (st.cancellation_policy_default) patch["airbnb_cancellation_category"] = st.cancellation_policy_default;
  {
    const { data: cur } = await supabaseAdmin
      .from("properties")
      .select("airbnb_cancellation_policy, airbnb_house_rules")
      .eq("id", args.propertyId)
      .maybeSingle();
    const c = cur as { airbnb_cancellation_policy?: string | null; airbnb_house_rules?: string | null } | null;
    const blank = (t?: string | null) => !t || !t.trim() || /^Adicione as datas de viagem/i.test(t.trim());
    if (st.cancellation_policy_label && blank(c?.airbnb_cancellation_policy)) patch["airbnb_cancellation_policy"] = st.cancellation_policy_label;
    const hr = houseRulesText(st.house_rules);
    if (hr && blank(c?.airbnb_house_rules)) patch["airbnb_house_rules"] = hr;
  }
  if (args.pub) {
    patch["airbnb_description_full"] = args.pub.descriptions.join("\n\n").slice(0, 20_000);
    // Mesmo formato do editor do imóvel: { name, category, available }.
    patch["airbnb_amenities"] = [
      ...args.pub.amenities.map((name) => ({ name: name.slice(0, 120), category: null, available: true })),
      ...args.pub.unavailable.map((name) => ({ name: name.slice(0, 120), category: null, available: false })),
    ].slice(0, 300);
    patch["airbnb_listing_last_synced_at"] = new Date().toISOString();
  }
  {
    // Só a foto de capa do anúncio (leitura nativa, custo zero); imóvel fica com 1 foto.
    const { fetchListingCover } = await import("@/lib/airbnb-cover.server");
    const cover = await fetchListingCover(args.listingId).catch(() => null);
    if (cover) { patch["hero_image_url"] = cover; patch["gallery_images"] = [cover]; }
  }
  if (Object.keys(patch).length) {
    const { error } = await supabaseAdmin.from("properties").update(patch as never).eq("id", args.propertyId);
    if (error) throw new Error(error.message);
  }
  if (cleanTitle) {
    const tw = supabaseAdmin.from("channex_twin_links" as never) as any;
    await tw.update({ primary_title: cleanTitle }).eq("primary_listing_id", args.listingId);
    await (supabaseAdmin.from("channex_twin_links" as never) as any).update({ twin_title: cleanTitle }).eq("twin_listing_id", args.listingId);
  }
  return { title: cleanTitle };
}

/**
 * Sincroniza UM anúncio de qualquer canal da conta (somente leitura na Channex:
 * nunca envia ARI/preço). Grava/atualiza `property_listing_raw_data` e reindexa o imóvel.
 */
export async function syncAccountListing(args: {
  listingId: string;
  channelId: string;
  propertyId: string;
  ownerId: string;
}): Promise<{ facts: number; title: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  type Ch = {
    data: {
      attributes: {
        properties: string[];
        rate_plans: Array<{ rate_plan_id: string; settings: Record<string, any> }>;
      };
    };
  };
  const [channel, listings] = await Promise.all([
    channexGet<Ch>(`/channels/${args.channelId}`),
    channexGet<{ data: { listing_id_dictionary: { values: Array<Record<string, unknown>> } } }>(
      `/channels/${args.channelId}/action/listings`,
    ),
  ]);
  const meta =
    (listings.data?.listing_id_dictionary?.values ?? []).find(
      (m) => String(m.id) === args.listingId,
    ) ?? {};
  const { data: prev } = await supabaseAdmin
    .from("property_listing_raw_data" as never)
    .select(
      "raw_settings, channex_rate_plan_id, channex_room_type_id, channex_property_id, normalized",
    )
    .eq("property_id", args.propertyId)
    .maybeSingle();
  const prevRow = prev as {
    raw_settings?: Record<string, any>;
    channex_rate_plan_id?: string;
    channex_room_type_id?: string;
    channex_property_id?: string;
    normalized?: Record<string, unknown>;
  } | null;
  const live = channel.data.attributes.rate_plans.find(
    (r) => String(r.settings?.listing_id) === args.listingId,
  );
  const rp = live ?? {
    rate_plan_id: prevRow?.channex_rate_plan_id ?? "",
    settings: prevRow?.raw_settings ?? {},
  };
  const ratePlan = live
    ? await channexGet<{
        data: {
          relationships?: {
            room_type?: { data?: { id: string } };
            property?: { data?: { id: string } };
          };
        };
      }>(`/rate_plans/${rp.rate_plan_id}`).catch(() => null)
    : null;
  const pub = await fetchPublicListing(args.listingId).catch(() => null);
  const facts = [...normalizeListing(meta, rp.settings), ...(pub ? publicFacts(pub) : [])];
  const { error } = await supabaseAdmin.from("property_listing_raw_data" as never).upsert(
    {
      property_id: args.propertyId,
      owner_id: args.ownerId,
      channex_channel_id: args.channelId,
      channex_property_id:
        ratePlan?.data?.relationships?.property?.data?.id ??
        prevRow?.channex_property_id ??
        channel.data.attributes.properties[0] ??
        null,
      channex_room_type_id:
        ratePlan?.data?.relationships?.room_type?.data?.id ?? prevRow?.channex_room_type_id ?? null,
      channex_rate_plan_id: rp.rate_plan_id || null,
      airbnb_listing_id: args.listingId,
      listing_meta: meta,
      raw_settings: rp.settings,
      normalized: { ...(prevRow?.normalized ?? {}), facts, public_listing: pub, ...structuredListing(rp.settings, Boolean((prevRow?.normalized as any)?.cohosts?.length)) },
      sync_paused_at: null,
      paused_reason: null,
      not_found_at: null,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "property_id" },
  );
  if (error) throw new Error(error.message);
  const { title } = await applyListingToProperty({
    propertyId: args.propertyId,
    listingId: args.listingId,
    meta,
    settings: rp.settings,
    pub,
  });
  const { reindexProperty } = await import("@/lib/ai/indexing.server");
  await reindexProperty(supabaseAdmin as never, args.propertyId).catch(() => undefined);
  // Conta/anúncio novo: já puxa o calendário da plataforma (somente importação).
  try {
    const { importCalendarWindow } = await import("@/lib/calendar-import.server");
    await importCalendarWindow(args.propertyId);
  } catch (e) {
    console.error("[syncAccountListing] importação inicial do calendário", e);
  }
  return { facts: facts.length, title };
}
