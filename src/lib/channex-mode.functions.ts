import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Apenas administradores podem alterar o modo de operação.");
}

const Owner = z.object({ ownerId: z.string().uuid().nullable() });

/** Conta do sistema alvo (respeita quem está impersonando); `ownerId` null = a própria. */
async function targetOwner(ctx: { supabase: any; userId: string }, ownerId: string | null) {
  const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
  return resolveAuthorizedAccountOwnerId(ctx.supabase, ctx.userId, ownerId);
}

/** Modo atual da conta (null quando o recurso ainda não está liberado para ela). */
export const getOperationMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    const ownerId = await targetOwner(ctx, data.ownerId);
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
    const ownerId = await targetOwner(ctx, data.ownerId);
    const { assertPilot, validatePricing, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    const r = await validatePricing(ownerId);
    // Validação velha não vale: se falhou agora, apaga o carimbo anterior.
    await saveAccountMode(ownerId, { pricing_validated_at: r.ok ? new Date().toISOString() : null }, ctx.userId);
    return r;
  });

/** Ativa o Modo Full para a conta inteira; exige preços validados. */
export const activateFullMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const ownerId = await targetOwner(ctx, data.ownerId);
    const { assertPilot, getAccountMode, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    const cur = await getAccountMode(ownerId);
    if (!cur.pricingValidatedAt) throw new Error("Valide primeiro o envio de preços da ferramenta de pricing.");
    await saveAccountMode(ownerId, { operation_mode: "full", mode_changed_at: new Date().toISOString() }, ctx.userId);
    return { ok: true };
  });

/** Passo "Modo": conta fica (ou volta) em Leve e o passo não é mais oferecido nas próximas conexões. */
export const chooseLightMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const ownerId = await targetOwner(ctx, data.ownerId);
    const { assertPilot, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    await saveAccountMode(ownerId, { operation_mode: "light", mode_changed_at: new Date().toISOString() }, ctx.userId);
    return { ok: true };
  });

export const answerTwinPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Owner.parse(d))
  .handler(async ({ data, context }) => {
    const ctx = context as any;
    await requireAdmin(ctx);
    const ownerId = await targetOwner(ctx, data.ownerId);
    const { assertPilot, saveAccountMode } = await import("@/lib/channex-mode.server");
    assertPilot(ownerId);
    await saveAccountMode(ownerId, { twin_prompt_answered_at: new Date().toISOString() }, ctx.userId);
    return { ok: true };
  });
