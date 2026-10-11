import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Apenas administradores podem alterar o modo de operação.");
}

const Owner = z.object({ ownerId: z.string().uuid().nullable() });

/** Modo atual da conta (null quando o recurso ainda não está liberado para ela). */
export const getOperationMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const ownerId = data.ownerId ?? ctx.userId;
    const { MODE_PILOT_OWNERS, getAccountMode } = await import("@/lib/channex-mode.server");
    if (!MODE_PILOT_OWNERS.has(ownerId)) return null;
    return getAccountMode(ownerId);
  });

export const getTwinSuggestions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const { assertPilot, detectTwinCandidates } = await import("@/lib/channex-mode.server");
    assertPilot(data.ownerId ?? ctx.userId);
    return detectTwinCandidates();
  });

export const validatePricingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const ownerId = data.ownerId ?? ctx.userId;
    const { assertPilot, validatePricing, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    const r = await validatePricing();
    if (r.ok) await saveAccountMode(ownerId, { pricing_validated_at: new Date().toISOString() }, ctx.userId);
    return r;
  });

/** Ativa o Modo Full para a conta inteira; exige preços validados. */
export const activateFullMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const ownerId = data.ownerId ?? ctx.userId;
    const { assertPilot, getAccountMode, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    const cur = await getAccountMode(ownerId);
    if (!cur.pricingValidatedAt) throw new Error("Valide primeiro o envio de preços da ferramenta de pricing.");
    await saveAccountMode(ownerId, { operation_mode: "full", mode_changed_at: new Date().toISOString() }, ctx.userId);
    return { ok: true };
  });

export const answerTwinPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const ownerId = data.ownerId ?? ctx.userId;
    const { assertPilot, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    await saveAccountMode(ownerId, { twin_prompt_answered_at: new Date().toISOString() }, ctx.userId);
    return { ok: true };
  });
