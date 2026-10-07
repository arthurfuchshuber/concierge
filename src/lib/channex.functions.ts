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
      const done = await syncPilotListings();
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
