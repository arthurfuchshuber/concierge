/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Dados bancários da empresa: só o dono da conta conecta e enxerga.

export const listBankConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: items }, { data: accounts }] = await Promise.all([
      supabase
        .from("malvo_items")
        .select("malvo_item_id, connector_name, status, execution_status, last_updated_at, consent_expires_at, environment, last_synced_at")
        .eq("account_owner_id", userId)
        .is("deleted_at", null)
        .order("created_at"),
      supabase
        .from("malvo_accounts")
        .select("malvo_account_id, malvo_item_id, name, marketing_name, type, subtype, number, balance, currency_code, balance_updated_at")
        .eq("account_owner_id", userId),
    ]);
    const { count } = await supabase
      .from("malvo_transactions")
      .select("id", { count: "exact", head: true })
      .eq("account_owner_id", userId)
      .is("deleted_at", null);
    return { items: items ?? [], accounts: accounts ?? [], transactions: count ?? 0 };
  });

export const getBankConnectToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ itemId: z.string().max(100).optional() }).parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { createConnectToken } = await import("@/lib/malvo.server");
    if (data.itemId) await assertOwnItem(context.supabase, context.userId, data.itemId);
    return { connectToken: await createConnectToken(context.userId, data.itemId) };
  });

async function assertOwnItem(supabase: any, userId: string, itemId: string) {
  const { data } = await supabase
    .from("malvo_items")
    .select("malvo_item_id")
    .eq("malvo_item_id", itemId)
    .eq("account_owner_id", userId)
    .maybeSingle();
  if (!data) throw new Error("Conexão bancária não encontrada.");
}

/** Chamado logo após o widget concluir (best-effort; o webhook continua sendo a fonte da verdade). */
export const syncBankConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ itemId: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    const { malvoFetch, syncMalvoItem } = await import("@/lib/malvo.server");
    // Checa o dono real ignorando RLS: item de outra conta é rejeitado mesmo invisível ao chamador.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: known } = await supabaseAdmin
      .from("malvo_items")
      .select("account_owner_id")
      .eq("malvo_item_id", data.itemId)
      .maybeSingle();
    if (known && (known as { account_owner_id: string }).account_owner_id !== context.userId) {
      throw new Error("Conexão bancária não encontrada.");
    }
    if (!known) {
      // Conexão recém-criada: só aceita se o próprio Malvo disser que é deste usuário.
      const item = await malvoFetch(`/items/${encodeURIComponent(data.itemId)}`);
      if (!item || item.clientUserId !== context.userId) throw new Error("Conexão bancária não encontrada.");
    }
    return syncMalvoItem(data.itemId, context.userId);
  });

export const disconnectBank = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ itemId: z.string().min(1).max(100) }).parse(i))
  .handler(async ({ data, context }) => {
    await assertOwnItem(context.supabase, context.userId, data.itemId);
    const { malvoFetch } = await import("@/lib/malvo.server");
    await malvoFetch(`/items/${encodeURIComponent(data.itemId)}`, { method: "DELETE" });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("malvo_items")
      .update({ deleted_at: new Date().toISOString() } as never)
      .eq("malvo_item_id", data.itemId)
      .eq("account_owner_id", context.userId);
    return { ok: true };
  });
