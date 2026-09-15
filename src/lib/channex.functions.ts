import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Integração Channex (staging) — importação dos anúncios do Airbnb.
 *
 * A chave fica apenas no servidor (CHANNEX_STAGING_API_KEY) e é enviada no
 * header `user-api-key`, conforme a documentação do Channex.
 */
const CHANNEX_BASE = "https://staging.channex.io/api/v1";
const AIRBNB_CHANNEL_ID = "33cda52b-db68-4784-ae20-e4e3ec072fb0";

type AirbnbListing = {
  id: string;
  title: string;
  occupancies?: number[];
};

export type ChannexSyncResult = {
  total: number;
  importados: number;
  jaExistentes: number;
  falhas: Array<{ titulo: string; erro: string }>;
};

async function channex<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const key = process.env["CHANNEX_STAGING_API_KEY"];
  if (!key) throw new Error("A chave da integração Channex não está configurada.");
  const res = await fetch(`${CHANNEX_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      "user-api-key": key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Channex ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

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
      configured: !!process.env["CHANNEX_STAGING_API_KEY"],
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
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Propriedade do Channex onde os quartos serão criados.
    const props = await channex<{ data: Array<{ id: string }> }>("/properties");
    const channexPropertyId = props.data?.[0]?.id;
    if (!channexPropertyId) throw new Error("Nenhuma propriedade encontrada na conta Channex.");

    const listingsRes = await channex<{
      data: { listing_id_dictionary: { values: AirbnbListing[] } };
    }>(`/channels/${AIRBNB_CHANNEL_ID}/action/listings`);
    const listings = listingsRes.data?.listing_id_dictionary?.values ?? [];

    const result: ChannexSyncResult = { total: listings.length, importados: 0, jaExistentes: 0, falhas: [] };

    for (const listing of listings) {
      const titulo = (listing.title ?? "").trim() || `Anúncio ${listing.id}`;
      try {
        const { data: existing } = await supabaseAdmin
          .from("propriedades")
          .select("id, channex_room_type_id, channex_rate_plan_id")
          .eq("channex_listing_id", listing.id)
          .maybeSingle();

        if (existing?.channex_room_type_id && existing.channex_rate_plan_id) {
          result.jaExistentes += 1;
          continue;
        }

        let rowId = existing?.id ?? null;
        if (!rowId) {
          const { data: inserted, error } = await supabaseAdmin
            .from("propriedades")
            .insert({
              nome: titulo,
              channex_listing_id: listing.id,
              channex_property_id: channexPropertyId,
              status: "importando",
            })
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          rowId = inserted.id;
        }

        const maxOcc = Math.max(1, ...(listing.occupancies ?? [2]));

        const roomTypeRes = await channex<{ data: { id: string } }>("/room_types", {
          method: "POST",
          body: {
            room_type: {
              property_id: channexPropertyId,
              title: titulo.slice(0, 250),
              count_of_rooms: 1,
              occ_adults: maxOcc,
              occ_children: 0,
              occ_infants: 0,
              default_occupancy: maxOcc,
              facilities: [],
              room_kind: "room",
            },
          },
        });
        const roomTypeId = roomTypeRes.data.id;

        const ratePlanRes = await channex<{ data: { id: string } }>("/rate_plans", {
          method: "POST",
          body: {
            rate_plan: {
              property_id: channexPropertyId,
              room_type_id: roomTypeId,
              title: "Tarifa padrão",
              currency: "BRL",
              sell_mode: "per_room",
              rate_mode: "manual",
              options: [{ occupancy: maxOcc, is_primary: true, rate: 0 }],
            },
          },
        });
        const ratePlanId = ratePlanRes.data.id;

        const { error: upErr } = await supabaseAdmin
          .from("propriedades")
          .update({
            nome: titulo,
            channex_room_type_id: roomTypeId,
            channex_rate_plan_id: ratePlanId,
            status: "sincronizado",
          })
          .eq("id", rowId);
        if (upErr) throw new Error(upErr.message);

        result.importados += 1;
      } catch (e) {
        result.falhas.push({ titulo, erro: e instanceof Error ? e.message : String(e) });
      }
    }

    return result;
  });
