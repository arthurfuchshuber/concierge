import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Integração Channex (staging) — importação dos anúncios do Airbnb.
 *
 * A chave fica apenas no servidor (CHANNEX_STAGING_API_KEY) e é enviada no
 * header `user-api-key`, conforme a documentação do Channex.
 */

export type ChannexSyncResult = {
  total: number;
  importados: number;
  jaExistentes: number;
  falhas: Array<{ titulo: string; erro: string }>;
};

async function requireAdmin(context: { supabase: { rpc: (fn: string, args: unknown) => Promise<{ data: unknown }> }; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Apenas administradores podem sincronizar os imóveis.");
}

/** Status da integração: chave configurada + quantos imóveis já foram importados. */
export const getChannexStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ configured: boolean; imported: number }> => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("propriedades")
      .select("id", { count: "exact", head: true });
    return {
      configured: !!(process.env["CHANNEX_API_KEY"] ?? process.env["CHANNEX_STAGING_API_KEY"]),
      imported: count ?? 0,
    };
  });

/**
 * Importa os anúncios do Airbnb conectados ao Channex: grava cada imóvel na
 * tabela `propriedades`, cria no Channex o Room Type (1 unidade) e o Rate Plan
 * padrão em BRL, e guarda os dois UUIDs de volta na linha do imóvel.
 */
export const importarAnunciosAirbnb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChannexSyncResult> => {
    await requireAdmin(context as never);
    // Fase piloto: somente os anúncios liberados (Casa Charmosa). Os demais
    // anúncios permanecem fora — nada é criado nem alterado na Channex.
    const { syncPilotListings, PILOT_LISTINGS } = await import("@/lib/channex-listing.server");
    try {
      // ConciergeIA não é PMS: nunca mapeia tarifa/calendário na Channex
      // (o Airbnb bloqueia o calendário quando o canal assume preços sem tarifa válida).
      const done = await syncPilotListings();
      // Puxa todo o histórico disponível (reservas, conversas, avaliações).
      const { backfillChannexHistory } = await import("@/lib/channex-history.server");
      await backfillChannexHistory().catch((e) => console.error("[channex-history]", e));
      const total = Object.keys(PILOT_LISTINGS).length;
      return {
        total,
        importados: done.length,
        jaExistentes: 0,
        falhas: done.length < total ? [{ titulo: "Anúncio piloto", erro: "Ainda não mapeado na Channex." }] : [],
      };
    } catch (e) {
      return { total: 1, importados: 0, jaExistentes: 0, falhas: [{ titulo: "Casa Charmosa", erro: e instanceof Error ? e.message : String(e) }] };
    }
  });

export type ConnectedListing = {
  listingId: string;
  name: string;
  kind: "primary" | "twin";
  propertyName: string;
};
export type ConnectedListingsInventory = {
  totalCount: number;
  primaryCount: number;
  twinCount: number;
  items: ConnectedListing[];
};

/**
 * Inventário de anúncios conectados ativos da conta (base da futura cobrança
 * por anúncio). Gêmeos contam individualmente. Sempre derivado do banco, então
 * anúncios entram/saem automaticamente. Não altera preços.
 */
export const getConnectedListingsInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConnectedListingsInventory> => {
    await requireAdmin(context as never);
    const userId = (context as { userId: string }).userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: prim }, { data: twins }] = await Promise.all([
      supabaseAdmin
        .from("property_listing_raw_data" as never)
        .select("property_id, airbnb_listing_id, properties!inner(name, owner_id)")
        .eq("properties.owner_id", userId),
      (supabaseAdmin as any)
        .from("channex_twin_links")
        .select("property_id, twin_listing_id, twin_title")
        .eq("owner_id", userId)
        .eq("status", "active"),
    ]);
    const nameByProp = new Map<string, string>();
    const items: ConnectedListing[] = [];
    for (const r of (prim ?? []) as any[]) {
      const n = r.properties?.name ?? "Imóvel";
      nameByProp.set(r.property_id, n);
      items.push({ listingId: String(r.airbnb_listing_id ?? r.property_id), name: n, kind: "primary", propertyName: n });
    }
    const seen = new Set(items.map((i) => i.listingId));
    for (const t of (twins ?? []) as any[]) {
      const id = String(t.twin_listing_id);
      if (seen.has(id)) continue;
      seen.add(id);
      const pn = nameByProp.get(t.property_id) ?? "Imóvel";
      items.push({ listingId: id, name: t.twin_title ?? `Anúncio ${id}`, kind: "twin", propertyName: pn });
    }
    items.sort((a, b) => a.propertyName.localeCompare(b.propertyName, "pt-BR") || (a.kind === "primary" ? -1 : 1));
    const twinCount = items.filter((i) => i.kind === "twin").length;
    return { totalCount: items.length, primaryCount: items.length - twinCount, twinCount, items };
  });

export type AirbnbAiToggle = { propertyId: string; name: string; enabled: boolean };

/** Lista os imóveis conectados ao Airbnb e o estado da chave da IA. */
export const getAirbnbAiToggles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AirbnbAiToggle[]> => {
    await requireAdmin(context as never);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Isolamento: só os anúncios da conta do próprio usuário.
    const { data } = await supabaseAdmin
      .from("property_listing_raw_data" as never)
      .select("property_id, airbnb_ai_enabled, properties!inner(name, owner_id)")
      .eq("properties.owner_id", (context as { userId: string }).userId);
    return ((data ?? []) as any[])
      .map((r) => ({
        propertyId: r.property_id,
        name: r.properties?.name ?? "Imóvel",
        enabled: !!r.airbnb_ai_enabled,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  });

/** Liga/desliga a IA no chat do Airbnb para um imóvel (e o app de mensagens na Channex). */
export const setAirbnbAiToggle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { propertyId: string; enabled: boolean }) => {
    if (typeof d?.propertyId !== "string" || typeof d?.enabled !== "boolean") throw new Error("Dados inválidos.");
    return d;
  })
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const userId = (context as { userId: string }).userId;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("owner_id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (!prop || (prop as any).owner_id !== userId) throw new Error("Imóvel não pertence à sua conta.");
    // Primeiro a Channex: se falhar, a chave não muda de estado.
    const { syncMessagesApp, channexPropertiesFor } = await import("@/lib/channex-messages-app.server");
    await syncMessagesApp(await channexPropertiesFor(supabaseAdmin, data.propertyId), data.enabled);
    const { error } = await supabaseAdmin
      .from("property_listing_raw_data" as never)
      .update({
        airbnb_ai_enabled: data.enabled,
        airbnb_ai_toggled_at: new Date().toISOString(),
        airbnb_ai_toggled_by: userId,
      } as never)
      .eq("property_id", data.propertyId);
    if (error) throw new Error(error.message);
    if (!data.enabled) {
      // Expurga mensagens de chat pendentes para a IA não responder após desligar.
      // Reservas/ARI continuam na fila (não dependem da IA).
      await supabaseAdmin
        .from("fila_webhooks_channex" as never)
        .update({
          processado: true,
          processado_em: new Date().toISOString(),
          erro: "Descartado: IA desativada pelo anfitrião",
        } as never)
        .eq("processado", false)
        .in("evento", ["message", "new_message"]);
    }
    return { ok: true };
  });
