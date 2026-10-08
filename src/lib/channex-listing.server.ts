/**
 * Ingestão do anúncio oficial do Airbnb (via Channex) para o repositório
 * central do imóvel (`property_listing_raw_data`). Somente leitura na Channex:
 * nunca envia ARI. Restrito a uma allowlist de anúncios em validação.
 */
const CHANNEX_BASE = "https://app.channex.io/api/v1";
export const AIRBNB_CHANNEL_ID = "9f7f35ab-3b40-4b84-8483-693122d9604b";

/** Anúncios liberados para o Cérebro de IA (piloto). airbnb listing id → slug do imóvel oficial. */
export const PILOT_LISTINGS: Record<string, string> = {
  "1081915824812637088": "charmosa",
};

type Fact = { key: string; title: string; content: string };

async function channexGet<T>(path: string): Promise<T> {
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
  const [channel, listings] = await Promise.all([
    channexGet<{ data: { attributes: { properties: string[]; rate_plans: Array<{ rate_plan_id: string; settings: Record<string, any> }> } } }>(
      `/channels/${AIRBNB_CHANNEL_ID}`,
    ),
    channexGet<{ data: { listing_id_dictionary: { values: Array<Record<string, unknown>> } } }>(`/channels/${AIRBNB_CHANNEL_ID}/action/listings`),
  ]);
  const metas = listings.data?.listing_id_dictionary?.values ?? [];
  const out: Array<{ listingId: string; propertyId: string; facts: number }> = [];

  for (const [listingId, slug] of Object.entries(PILOT_LISTINGS)) {
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
    const rp = live ?? (prevRow?.raw_settings ? { rate_plan_id: prevRow.channex_rate_plan_id ?? "", settings: prevRow.raw_settings } : null);
    if (!rp) continue;
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
        channex_channel_id: AIRBNB_CHANNEL_ID,
        channex_property_id: channel.data.attributes.properties[0] ?? null,
        channex_room_type_id: ratePlan?.data?.relationships?.room_type?.data?.id ?? prevRow?.channex_room_type_id ?? null,
        channex_rate_plan_id: rp.rate_plan_id || null,
        airbnb_listing_id: listingId,
        listing_meta: meta,
        raw_settings: rp.settings,
        normalized: { ...(((prev as { normalized?: Record<string, unknown> } | null)?.normalized) ?? {}), facts, public_listing: pub },
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

type PublicListing = { descriptions: string[]; amenities: string[]; unavailable: string[] };

const stripHtml = (h: string) =>
  h.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

/** Lê a página pública do anúncio (descrição completa, "o que você vai receber", comodidades). Somente leitura. */
export async function fetchPublicListing(listingId: string): Promise<PublicListing | null> {
  const res = await fetch(`https://www.airbnb.com.br/rooms/${listingId}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Accept-Language": "pt-BR,pt;q=0.9" },
  });
  if (!res.ok) return null;
  const html = await res.text();
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

function publicFacts(p: PublicListing): Fact[] {
  const out: Fact[] = [];
  p.descriptions.forEach((d, i) => out.push({ key: `descricao_${i}`, title: "Descrição do anúncio no Airbnb (inclui o que o hóspede recebe)", content: d }));
  if (p.amenities.length) out.push({ key: "comodidades", title: "Comodidades oferecidas (anúncio Airbnb)", content: p.amenities.join("\n") });
  if (p.unavailable.length) out.push({ key: "comodidades_ausentes", title: "Comodidades NÃO oferecidas (anúncio Airbnb)", content: p.unavailable.join("\n") });
  return out;
}
