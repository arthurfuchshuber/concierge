/* eslint-disable @typescript-eslint/no-explicit-any */
// Envio de volta ao Airbnb (via Channex) — anúncio e calendário. Tudo passa por aqui:
// valida, confere o modo da conta, envia, registra (antes/depois) e reflete no banco na hora,
// para o sistema e o Airbnb nunca divergirem. Pedido do anfitrião (17/10/2026): toda
// informação precisa ser bidirecional, inclusive a gestão do calendário.
import { buildWriteback, mergeIntoSettings, type ListingPatch } from "@/lib/listing-writeback";
import { structuredListing } from "@/lib/listing-structured";

type Result = { ok: boolean; sent: string[]; errors: string[]; dryRun?: boolean; preview?: Record<string, any> };

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function loadTarget(propertyId: string) {
  const sb = await admin();
  const { data } = await sb
    .from("property_listing_raw_data")
    .select("owner_id, channex_channel_id, channex_property_id, channex_room_type_id, channex_rate_plan_id, airbnb_listing_id, raw_settings, normalized")
    .eq("property_id", propertyId)
    .maybeSingle();
  return data as null | {
    owner_id: string; channex_channel_id: string | null; channex_property_id: string | null; channex_room_type_id: string | null;
    channex_rate_plan_id: string | null; airbnb_listing_id: string | null; raw_settings: Record<string, any> | null; normalized: Record<string, any> | null;
  };
}

async function log(row: Record<string, unknown>) {
  const sb = await admin();
  await sb.from("channex_writeback_log").insert(row as never).then(undefined, () => undefined);
}

/** Mapping id = `rate_plans[].id` do canal (não o rate_plan_id da Channex). */
async function mappingIdOf(channelId: string, ratePlanId: string): Promise<string | null> {
  const { channexGet } = await import("@/lib/channex-listing.server");
  const ch = await channexGet<{ data: { attributes: { rate_plans: Array<{ id: string; rate_plan_id: string }> } } }>(`/channels/${channelId}`);
  return ch.data.attributes.rate_plans.find((r) => r.rate_plan_id === ratePlanId)?.id ?? null;
}

/** Envia alterações do anúncio (horários, política, regras, estadia, preço, publicação). */
export async function pushListingSettings(args: {
  propertyId: string;
  patch: ListingPatch;
  userId: string | null;
  allowPricing?: boolean;
  dryRun?: boolean;
  source?: string;
}): Promise<Result> {
  const t = await loadTarget(args.propertyId);
  // Imóvel sem anúncio conectado: não há o que enviar, o sistema é a fonte (não é erro).
  if (!t?.channex_channel_id || !t.channex_rate_plan_id) return { ok: true, sent: [], errors: [] };
  // Vale nos modos Light e Full. Preço é a exceção: o calendário/preço do Airbnb só é IMPORTADO.
  if (args.patch.pricing) {
    return { ok: false, sent: [], errors: ["Preço não é enviado ao Airbnb: o calendário e os preços da plataforma só são importados."] };
  }
  const mappingId = await mappingIdOf(t.channex_channel_id, t.channex_rate_plan_id).catch(() => null);
  if (!mappingId) return { ok: false, sent: [], errors: ["Não encontrei o mapeamento deste anúncio no canal."] };

  const built = buildWriteback({ channelId: t.channex_channel_id, mappingId, current: t.raw_settings ?? {}, patch: args.patch });
  if (args.dryRun) return { ok: built.errors.length === 0, sent: [], errors: built.errors, dryRun: true, preview: built.requests as unknown as Record<string, any> };
  const { channexRequest } = await import("@/lib/channex-ari.server");
  const errors = [...built.errors];
  const sent: string[] = [];
  let settings = t.raw_settings ?? {};
  for (const req of built.requests) {
    const before = req.merge.group ? (settings as any)[req.merge.group] ?? null : null;
    const res = await channexRequest({ operation: req.operation, method: req.method, path: req.path, body: req.body });
    await log({
      property_id: args.propertyId, owner_id: t.owner_id, user_id: args.userId, source: args.source ?? "system",
      operation: req.operation, request: req.body, before, after: req.merge.values,
      status: res.ok ? "sent" : "failed", http_status: res.status, response: res.json, error: res.error,
    });
    if (!res.ok) { errors.push(`${req.operation}: ${res.error ?? "falhou"}`); continue; }
    sent.push(req.operation);
    settings = mergeIntoSettings(settings, req);
  }
  if (sent.length) {
    // Reflexo imediato: raw_settings, normalized e as colunas do imóvel.
    const sb = await admin();
    const hadCohost = Boolean(t.normalized?.["cohosts"]?.length);
    await sb
      .from("property_listing_raw_data")
      .update({ raw_settings: settings, normalized: { ...(t.normalized ?? {}), ...structuredListing(settings, hadCohost) }, updated_at: new Date().toISOString() } as never)
      .eq("property_id", args.propertyId);
    try {
      const { applyListingToProperty } = await import("@/lib/channex-listing.server");
      await applyListingToProperty({ propertyId: args.propertyId, listingId: t.airbnb_listing_id ?? "", meta: {}, settings, pub: null });
    } catch (e) {
      console.error("[writeback] reflexo no imóvel", e);
    }
  }
  return { ok: errors.length === 0, sent, errors };
}

/**
 * Calendário (disponibilidade, bloqueios, preço): SOMENTE IMPORTAÇÃO (decisão do anfitrião,
 * 17/10/2026). O sistema guarda o calendário da plataforma como está (`calendar-import.server.ts`)
 * e não trava o calendário do anfitrião no Airbnb.
 */
export async function pushCalendar(_args: {
  propertyId: string;
  dateFrom: string;
  dateTo: string;
  fields: Record<string, unknown>;
  userId: string | null;
  allowPricing?: boolean;
  source?: string;
}): Promise<Result> {
  return { ok: false, sent: [], errors: ["O calendário do Airbnb (preços e disponibilidade) é somente importado; altere-o na plataforma."] };
}

/**
 * O Airbnb é a FONTE DA VERDADE do que existe no anúncio. Se o envio de uma alteração falhar,
 * o sistema volta ao valor do Airbnb (guardado em `raw_settings`/`listing_meta`) em vez de
 * ficar com um valor que o anúncio não tem.
 */
export async function restoreFromAirbnb(propertyId: string): Promise<void> {
  const sb = await admin();
  const { data } = await sb
    .from("property_listing_raw_data")
    .select("airbnb_listing_id, listing_meta, raw_settings")
    .eq("property_id", propertyId)
    .maybeSingle();
  if (!data?.airbnb_listing_id) return;
  const { applyListingToProperty } = await import("@/lib/channex-listing.server");
  await applyListingToProperty({
    propertyId,
    listingId: String(data.airbnb_listing_id),
    meta: (data.listing_meta ?? {}) as Record<string, unknown>,
    settings: (data.raw_settings ?? {}) as Record<string, any>,
    pub: null,
  });
}

/** Envia o que mudou e, se o Airbnb recusar, devolve o sistema ao valor do Airbnb. */
export async function pushOrRestore(args: { propertyId: string; patch: ListingPatch; userId: string | null; source: string }) {
  const r = await pushListingSettings(args);
  if (!r.ok && r.errors.length) await restoreFromAirbnb(args.propertyId).catch((e) => console.error("[writeback] restaurar", e));
  return r;
}
