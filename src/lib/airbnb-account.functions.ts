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

export type AirbnbAccountListing = {
  listingId: string;
  title: string;
  city: string | null;
  channelId: string;
  imported: boolean;
  paused: boolean;
  propertyId: string | null;
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

async function loadInventory(admin: Admin, accountId: string) {
  const { data: rows } = await admin
    .from("property_listing_raw_data")
    .select("property_id, airbnb_listing_id, channex_channel_id, sync_paused_at")
    .eq("owner_id", accountId);
  const channels = [
    ...new Set((rows ?? []).map((r) => r.channex_channel_id).filter(Boolean) as string[]),
  ];
  if (channels.length === 0) {
    return { connected: false, listings: [] as AirbnbAccountListing[] };
  }
  // channex_twin_links ainda não está nos tipos gerados.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: twins } = await (admin as unknown as { from: (t: string) => any })
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
  const out: AirbnbAccountListing[] = [];
  for (const channelId of channels) {
    const res = await channexGet<{
      data: { listing_id_dictionary: { values: Array<Record<string, unknown>> } };
    }>(`/channels/${channelId}/action/listings`);
    for (const m of res.data?.listing_id_dictionary?.values ?? []) {
      const id = String(m.id);
      const row = byListing.get(id);
      out.push({
        listingId: id,
        title: String(m.title ?? `Anúncio ${id}`),
        city: m.city ? String(m.city) : null,
        channelId,
        imported: !!row || twinOf.has(id),
        paused: !!row?.sync_paused_at,
        propertyId: row?.property_id ?? twinOf.get(id) ?? null,
      });
    }
  }
  return { connected: true, listings: out };
}

export const listAirbnbAccountListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => Base.parse(i))
  .handler(async ({ data, context }) => {
    const { accountId, admin } = await ctx(context.supabase, context.userId, data.accountOwnerId);
    return loadInventory(admin, accountId);
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
    let imported = 0;
    const failed: Array<{ title: string; error: string }> = [];
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
      } catch (e) {
        // Não deixa imóvel "vazio" para trás se a leitura do anúncio falhou.
        if (propertyId) await admin.from("properties").delete().eq("id", propertyId);
        failed.push({ title: l.title, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { imported, failed };
  });

/** Chavinha: ativar (volta a sincronizar) ou desativar (para de sincronizar, mantém os dados). */
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
    if (!data.active) {
      const { error } = await admin
        .from("property_listing_raw_data")
        .update({ sync_paused_at: new Date().toISOString() })
        .eq("property_id", data.propertyId);
      if (error) throw new Error(error.message);
      return { ok: true };
    }
    // Reativa lendo o anúncio de novo; só limpa a pausa se a leitura funcionou.
    const { syncAccountListing } = await import("@/lib/channex-listing.server");
    await syncAccountListing({
      listingId: String(row.airbnb_listing_id),
      channelId: String(row.channex_channel_id),
      propertyId: data.propertyId,
      ownerId: accountId,
    });
    return { ok: true };
  });
