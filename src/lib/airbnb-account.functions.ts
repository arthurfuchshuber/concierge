import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Anúncios do Airbnb da conta (ficha do proprietário → aba Imóveis).
//
// Somente leitura no canal: nunca envia calendário, preço ou disponibilidade.
// "Desativar" = parar de sincronizar; os dados já importados ficam guardados.
// ---------------------------------------------------------------------------

const Base = z.object({ accountOwnerId: z.string().uuid().optional().nullable() });
const WithChannel = Base.extend({
  channelId: z.string().min(8).max(64).optional().nullable(),
  /** true = ReSincronizar: consulta a Channex ao vivo. Senão o catálogo vem do cache local. */
  live: z.boolean().optional(),
});

export type AirbnbAccountListing = {
  listingId: string;
  title: string;
  city: string | null;
  channelId: string;
  imported: boolean;
  paused: boolean;
  propertyId: string | null;
  /** Importado, mas não aparece mais no Airbnb (só sinalizado; nada é arquivado ou apagado). */
  notFound: boolean;
  /** "Proprietário(a)" do imóvel já importado (para mostrar na lista). */
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
};

async function ctx(
  supabase: Parameters<
    typeof import("@/lib/account-scope.server").resolveAuthorizedAccountOwnerId
  >[0],
  userId: string,
  accountOwnerId: string | null | undefined,
) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  const accountId = await resolveAuthorizedAccountOwnerId(supabase, userId, accountOwnerId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { accountId, admin: supabaseAdmin };
}

/** Todos os anúncios dos canais do Airbnb já conectados à conta. */
type Admin = Awaited<ReturnType<typeof ctx>>["admin"];

const NO_OWNER = { ownerName: null, ownerPhone: null, ownerPhoneCountry: null };

async function loadInventory(
  admin: Admin,
  accountId: string,
  onlyChannelId?: string | null,
  live = false,
) {
  const { data: rows } = await admin
    .from("property_listing_raw_data")
    .select("property_id, airbnb_listing_id, channex_channel_id, sync_paused_at, listing_meta")
    .eq("owner_id", accountId);
  // Contas do Airbnb conectadas (várias por conta do sistema); `onlyChannelId` = uma só.
  const { activeChannelIds } = await import("@/lib/airbnb-accounts.server");
  const all = await activeChannelIds(admin, accountId);
  const channels = onlyChannelId ? all.filter((c) => c === onlyChannelId) : all;
  if (channels.length === 0) {
    return { connected: false, listings: [] as AirbnbAccountListing[] };
  }
  // channex_twin_links ainda não está nos tipos gerados.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = admin as unknown as { from: (t: string) => any };
  const { data: twins } = await raw
    .from("channex_twin_links")
    .select("property_id, twin_listing_id")
    .eq("owner_id", accountId)
    .eq("status", "active");
  const byListing = new Map(
    (rows ?? []).filter((r) => r.airbnb_listing_id).map((r) => [String(r.airbnb_listing_id), r]),
  );
  const twinOf = new Map<string, string>(
    ((twins ?? []) as Array<{ property_id: string; twin_listing_id: string }>).map((t) => [
      String(t.twin_listing_id),
      t.property_id,
    ]),
  );
  const { channexGet } = await import("@/lib/channex-listing.server");
  const { saveRawRecords } = await import("@/lib/channex-raw.server");
  type Meta = Record<string, unknown>;
  const out: AirbnbAccountListing[] = [];
  for (const channelId of channels) {
    // Catálogo: do cache local (`channex_raw_records`); ao vivo só no ReSincronizar
    // (ou quando a conta acabou de ser conectada e ainda não tem cache).
    let values: Meta[] = [];
    let fromLive = false;
    if (!live) {
      const { data: cached } = await raw
        .from("channex_raw_records")
        .select("payload")
        .eq("entity_type", "channel_listing")
        .eq("parent_id", channelId);
      values = ((cached ?? []) as Array<{ payload: Meta }>).map((c) => c.payload);
    }
    if (live || values.length === 0) {
      const res = await channexGet<{
        data: { listing_id_dictionary: { values: Meta[] } };
      }>(`/channels/${channelId}/action/listings`);
      values = res.data?.listing_id_dictionary?.values ?? [];
      fromLive = true;
      await saveRawRecords(
        values
          .filter((m) => m?.id != null)
          .map((m) => ({
            entity_type: "channel_listing",
            channex_id: String(m.id),
            parent_id: channelId,
            payload: m,
            source: "airbnb-accounts",
          })),
      ).catch(() => 0);
    }
    const seen = new Set<string>();
    for (const m of values) {
      const id = String(m.id);
      seen.add(id);
      const row = byListing.get(id);
      out.push({
        listingId: id,
        title: String(m.title ?? `Anúncio ${id}`),
        city: m.city ? String(m.city) : null,
        channelId,
        imported: !!row || twinOf.has(id),
        paused: !!row?.sync_paused_at,
        propertyId: row?.property_id ?? twinOf.get(id) ?? null,
        notFound: false,
        ...NO_OWNER,
      });
    }
    // Importado que sumiu do Airbnb: só sinaliza ("Não encontrado no Airbnb"). Nunca arquiva nem apaga.
    if (fromLive) {
      const mine = (rows ?? []).filter(
        (r) => r.airbnb_listing_id && r.channex_channel_id === channelId,
      );
      const goneIds = mine
        .filter((r) => !seen.has(String(r.airbnb_listing_id)))
        .map((r) => r.property_id);
      const backIds = mine
        .filter((r) => seen.has(String(r.airbnb_listing_id)))
        .map((r) => r.property_id);
      if (goneIds.length > 0)
        await raw
          .from("property_listing_raw_data")
          .update({ not_found_at: new Date().toISOString() })
          .in("property_id", goneIds)
          .is("not_found_at", null);
      if (backIds.length > 0)
        await raw
          .from("property_listing_raw_data")
          .update({ not_found_at: null })
          .in("property_id", backIds);
      for (const r of mine) {
        const id = String(r.airbnb_listing_id);
        if (seen.has(id)) continue;
        const meta = (r.listing_meta ?? {}) as Meta;
        out.push({
          listingId: id,
          title: String(meta.title ?? `Anúncio ${id}`),
          city: meta.city ? String(meta.city) : null,
          channelId,
          imported: true,
          paused: !!r.sync_paused_at,
          propertyId: r.property_id,
          notFound: true,
          ...NO_OWNER,
        });
      }
    }
  }
  // Proprietário de cada imóvel já importado.
  const propIds = [...new Set(out.map((l) => l.propertyId).filter(Boolean) as string[])];
  if (propIds.length > 0) {
    const { data: props } = await admin
      .from("properties")
      .select("id, owner_contact_id")
      .in("id", propIds);
    const ownerIds = [
      ...new Set((props ?? []).map((p) => p.owner_contact_id).filter(Boolean) as string[]),
    ];
    const { data: owners } = ownerIds.length
      ? await admin
          .from("property_owners")
          .select("id, name, trade_name, phone, phone_country")
          .in("id", ownerIds)
      : {
          data: [] as Array<{
            id: string;
            name: string | null;
            trade_name: string | null;
            phone: string | null;
            phone_country: string | null;
          }>,
        };
    const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));
    const ownerOfProp = new Map(
      (props ?? []).map((p) => [
        p.id,
        p.owner_contact_id ? ownerById.get(p.owner_contact_id) : undefined,
      ]),
    );
    for (const l of out) {
      const o = l.propertyId ? ownerOfProp.get(l.propertyId) : undefined;
      if (!o) continue;
      l.ownerName = String(o.trade_name || o.name || "") || null;
      l.ownerPhone = o.phone ?? null;
      l.ownerPhoneCountry = o.phone_country ?? null;
    }
  }
  return { connected: true, listings: out };
}

export const listAirbnbAccountListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => WithChannel.parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    return loadInventory(admin, accountId, data.channelId, data.live === true);
  });

/** Contas do Airbnb conectadas à conta do sistema (com quantos anúncios têm e quantos já foram importados). */
export const listAirbnbAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Base.parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { listAccounts } = await import("@/lib/airbnb-accounts.server");
    return listAccounts(admin, accountId);
  });

/** "Conectar conta": devolve o endereço do IFrame da Channex onde a pessoa autoriza o Airbnb. */
export const startAirbnbConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Base.extend({ reauthChannelId: z.string().min(8).max(64).optional().nullable() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { startConnect, registry } = await import("@/lib/airbnb-accounts.server");
    if (data.reauthChannelId) {
      const mine = await registry(admin, accountId, true);
      if (!mine.some((r) => r.channex_channel_id === data.reauthChannelId))
        throw new Error("Conta do Airbnb não encontrada.");
    }
    return startConnect(context.userId, data.reauthChannelId ?? undefined);
  });

/**
 * Reconectar conta existente: confere se a autorização voltou a valer; se sim, reativa a conta
 * e retoma o que a desconexão pausou. Enquanto não autorizar, devolve `authorized: false`.
 */
export const checkAirbnbReconnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Base.extend({ channelId: z.string().min(8).max(64) }).parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { registry, accountAuthorized, reactivate } =
      await import("@/lib/airbnb-accounts.server");
    const mine = await registry(admin, accountId, true);
    const row = mine.find((r) => r.channex_channel_id === data.channelId);
    if (!row) throw new Error("Conta do Airbnb não encontrada.");
    if (!(await accountAuthorized(data.channelId))) return { authorized: false as const };
    const res =
      row.status === "active"
        ? { resumed: 0, chatPending: 0 }
        : await reactivate(admin, accountId, data.channelId);
    return { authorized: true as const, ...res };
  });

/** Consulta se a conta nova já foi autorizada; se sim, registra e devolve. */
export const detectAirbnbConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Base.extend({ baseline: z.array(z.string()).max(500) }).parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { detectNew } = await import("@/lib/airbnb-accounts.server");
    return detectNew(admin, accountId, data.baseline);
  });

/** Desconectar: desliga o chat, pausa a sincronização e arquiva os imóveis. Não toca no canal da Channex. */
export const disconnectAirbnbAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Base.extend({ channelId: z.string().min(8).max(64) }).parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { disconnect } = await import("@/lib/airbnb-accounts.server");
    return disconnect(admin, accountId, data.channelId);
  });

const slugify = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "imovel";

/** Cria o imóvel de cada anúncio novo (vinculado ao proprietário da ficha) e importa os dados. */
export const importAirbnbListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Base.extend({
      ownerId: z.string().uuid(),
      listingIds: z.array(z.string().min(3).max(40)).min(1).max(100),
    }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { data: ow } = await admin
      .from("property_owners")
      .select("id")
      .eq("id", data.ownerId)
      .eq("account_owner_id", accountId)
      .maybeSingle();
    if (!ow) throw new Error("Proprietário não encontrado.");

    // Só importa o que realmente existe nos canais da conta e ainda não foi importado.
    const inv = await loadInventory(admin, accountId);
    const wanted = new Set(data.listingIds);
    const todo = inv.listings.filter((l) => wanted.has(l.listingId) && !l.imported);
    const { syncAccountListing } = await import("@/lib/channex-listing.server");
    const { enableChat } = await import("@/lib/airbnb-accounts.server");
    let imported = 0;
    const failed: Array<{ title: string; error: string }> = [];
    // Importado, mas ainda não 100% ativo: chat (Messages) ou tarifa/rate plan na Channex.
    const pending: Array<{ propertyId: string; title: string; kind: "chat" | "config" }> = [];
    for (const l of todo) {
      let propertyId: string | null = null;
      try {
        const slug = `${slugify(l.title)}-${crypto.randomUUID().slice(0, 6)}`;
        const { data: ins, error } = await admin
          .from("properties")
          .insert({
            owner_id: accountId,
            owner_contact_id: data.ownerId,
            name: l.title,
            slug,
            city: l.city,
            published: false,
            airbnb_listing_url: `https://www.airbnb.com.br/rooms/${l.listingId}`,
          } as never)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        propertyId = ins.id as string;
        await syncAccountListing({
          listingId: l.listingId,
          channelId: l.channelId,
          propertyId,
          ownerId: accountId,
        });
        imported += 1;
        // Anúncio habilitado = app Messages ligado (independe da chave da IA). Falhou → pendente + retentativa.
        if (!(await enableChat(admin, propertyId)).ok)
          pending.push({ propertyId, title: l.title, kind: "chat" });
        // Sem rate plan na Channex: "pendente de configuração" — nenhum ARI é enviado, nada é mapeado.
        const { data: rp } = await admin
          .from("property_listing_raw_data")
          .select("channex_rate_plan_id")
          .eq("property_id", propertyId)
          .maybeSingle();
        if (!rp?.channex_rate_plan_id) pending.push({ propertyId, title: l.title, kind: "config" });
      } catch (e) {
        // Não deixa imóvel "vazio" para trás se a leitura do anúncio falhou.
        if (propertyId) await admin.from("properties").delete().eq("id", propertyId);
        failed.push({ title: l.title, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { imported, failed, pending };
  });

/** Chavinha: ativar (volta a sincronizar e liga o chat) ou desativar (para de sincronizar, desliga o chat, mantém os dados). */
export const setAirbnbListingActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    Base.extend({ propertyId: z.string().uuid(), active: z.boolean() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { data: row } = await admin
      .from("property_listing_raw_data")
      .select("property_id, airbnb_listing_id, channex_channel_id")
      .eq("property_id", data.propertyId)
      .eq("owner_id", accountId)
      .maybeSingle();
    if (!row || !row.airbnb_listing_id || !row.channex_channel_id) {
      throw new Error("Este imóvel ainda não foi importado do Airbnb. Use o ReImportar.");
    }
    const { enableChat, disableChat } = await import("@/lib/airbnb-accounts.server");
    if (!data.active) {
      // Primeiro a Channex (chat desligado); se falhar, o estado não muda.
      await disableChat(admin, data.propertyId);
      const { error } = await admin
        .from("property_listing_raw_data")
        .update({ sync_paused_at: new Date().toISOString(), paused_reason: "manual" } as never)
        .eq("property_id", data.propertyId);
      if (error) throw new Error(error.message);
      return { ok: true, chatPending: false };
    }
    // Reativa lendo o anúncio de novo; só limpa a pausa se a leitura funcionou.
    const { syncAccountListing } = await import("@/lib/channex-listing.server");
    await syncAccountListing({
      listingId: String(row.airbnb_listing_id),
      channelId: String(row.channex_channel_id),
      propertyId: data.propertyId,
      ownerId: accountId,
    });
    const chat = await enableChat(admin, data.propertyId);
    return { ok: true, chatPending: !chat.ok };
  });

/** "Tentar ativar o chat de novo": repete a ativação do app Messages de um anúncio pendente. */
export const retryAirbnbChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Base.extend({ propertyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    const { data: row } = await admin
      .from("property_listing_raw_data")
      .select("property_id, sync_paused_at")
      .eq("property_id", data.propertyId)
      .eq("owner_id", accountId)
      .maybeSingle();
    if (!row || row.sync_paused_at) throw new Error("Este imóvel não está ativo.");
    const { enableChat } = await import("@/lib/airbnb-accounts.server");
    const r = await enableChat(admin, data.propertyId);
    return r.ok ? { ok: true as const } : { ok: false as const, error: r.error };
  });
