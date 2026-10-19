import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function accountOf(supabase: any, userId: string) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  return resolveAuthorizedAccountOwnerId(supabase, userId, null);
}

/** Anúncios do Modo Full aguardando a ferramenta de preços antes de virarem "Conectado" no Airbnb. */
export const getPendingFullConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const accountId = await accountOf(context.supabase, context.userId);
    const { listPendingFullConnections, ensureAccountPricingKey } = await import("@/lib/channex-full-connect.server");
    const items = await listPendingFullConnections(accountId, context.userId);
    const apiKey = items.length
      ? await ensureAccountPricingKey(accountId).catch((e) => {
          console.error("[full-connect] pricing key", e);
          return null;
        })
      : null;
    return { items, apiKey };
  });

/** "Já conectei": confere as diárias e só então liga o anúncio ao Airbnb. */
export const confirmFullConnectionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ propertyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { enforce } = await import("@/lib/permissions/permission.enforce.server");
    await enforce(context.userId, "stakeholders.vinculo-imovel", { propertyId: data.propertyId });
    const accountId = await accountOf(context.supabase, context.userId);
    const { confirmFullConnection } = await import("@/lib/channex-full-connect.server");
    return confirmFullConnection(accountId, data.propertyId, context.userId);
  });
