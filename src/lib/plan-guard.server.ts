// Server-side plan/quota enforcement. Loaded inside server-fn handlers only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, type PlanKey, planFromProductId } from "@/lib/payments.functions";
import type { PlanFeatures } from "@/lib/payments.shared";

export type PaddleEnv = "sandbox" | "live";

export type ResolvedPlan = {
  plan: PlanKey | null;
  status: string | null;
  maxGuides: number;
  features: PlanFeatures;
};

const FREE_FEATURES: PlanFeatures = {
  guestChat: false,
  autoImport: false,
  advancedIntake: false,
  ai: false,
  humanHandoff: false,
  team: false,
  customBrand: false,
  externalIntegration: false,
};

const FREE: ResolvedPlan = {
  plan: null,
  status: null,
  maxGuides: 0,
  features: FREE_FEATURES,
};

// Runtime env: production build → live; preview/dev → sandbox. Mirrors how
// the frontend derives env from the Paddle client token, but is evaluated
// server-side so sandbox subscriptions can never grant access in production.
function getRuntimeEnv(): PaddleEnv {
  return import.meta.env.PROD ? "live" : "sandbox";
}

// Resolves the active plan for the authenticated user using their RLS-scoped
// supabase client. Only honours subscriptions in the current runtime env so
// a sandbox-signed webhook cannot unlock paid features in production.
export async function resolveUserPlan(
  supabase: SupabaseClient,
  userId: string,
): Promise<ResolvedPlan> {
  const runtimeEnv = getRuntimeEnv();
  const { data: subs } = await supabase
    .from("subscriptions")
    .select("status, product_id, current_period_end, environment, max_guides_override, created_at")
    .eq("user_id", userId)
    .eq("environment", runtimeEnv)
    .order("created_at", { ascending: false });

  const candidates = subs ?? [];
  for (const sub of candidates) {
    const status = (sub.status as string) ?? null;
    const endIso = (sub.current_period_end as string | null) ?? null;
    const endDate = endIso ? new Date(endIso) : null;
    const periodValid = !endDate || endDate > new Date();
    const isActive =
      ((status === "active" || status === "trialing" || status === "past_due") && periodValid) ||
      (status === "canceled" && !!endDate && endDate > new Date());
    if (!isActive) continue;
    const plan = planFromProductId(sub.product_id as string | null);
    if (!plan) continue;
    const cfg = PLANS[plan];
    const override = (sub.max_guides_override as number | null) ?? null;
    return { plan, status, maxGuides: override ?? cfg.maxGuides, features: { ...cfg.features } };
  }
  return FREE;
}


/**
 * Resolve o plano EFETIVO para uma operação. Diferente de `resolveUserPlan`
 * (que sempre olha a assinatura do próprio caller), este helper considera o
 * contexto da operação:
 *
 *  - Se `ownerId` (ou `propertyId`) apontar para outra conta e o caller for
 *    membro ativo dessa conta, retornamos o plano do DONO daquela conta.
 *  - Caso contrário, retornamos o plano do próprio caller.
 *
 * Isso garante que membros convidados operem sob o plano da conta
 * (Enterprise / Business / Pro) — nunca caindo em Free silenciosamente.
 */
export async function resolveEffectivePlan(
  supabase: SupabaseClient,
  userId: string,
  opts?: { ownerId?: string | null; propertyId?: string | null },
): Promise<ResolvedPlan> {
  let ownerId = opts?.ownerId ?? null;
  if (!ownerId && opts?.propertyId) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("owner_id")
      .eq("id", opts.propertyId)
      .maybeSingle();
    ownerId = (prop?.owner_id as string | null) ?? null;
  }
  if (ownerId && ownerId !== userId) {
    // Verifica membership antes de usar o admin client (evita leak entre contas).
    const { data: isMember } = await supabase.rpc("is_account_member", {
      _user_id: userId,
      _owner_id: ownerId,
    });
    if (isMember) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return await resolveOwnerPlanAdmin(supabaseAdmin, ownerId);
    }
  }
  return await resolveUserPlan(supabase, userId);
}

export async function assertCanCreateGuide(
  supabase: SupabaseClient,
  userId: string,
  opts?: { ownerId?: string | null },
): Promise<void> {
  const targetOwner = opts?.ownerId ?? userId;
  const plan = await resolveEffectivePlan(supabase, userId, { ownerId: targetOwner });
  if (!plan.plan) {
    throw new Error("Você precisa de um plano ativo para criar guias. Assine em /precos.");
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = targetOwner !== userId ? supabaseAdmin : supabase;
  const { count, error } = await client
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", targetOwner);
  if (error) return; // soft-fail on count errors
  if ((count ?? 0) >= plan.maxGuides) {
    throw new Error(
      `Limite de guias do plano ${plan.plan} atingido (${plan.maxGuides}). Faça upgrade em /precos.`,
    );
  }
}

export async function assertFeature(
  supabase: SupabaseClient,
  userId: string,
  feature: "autoImport" | "ai" | "customBrand",
  opts?: { ownerId?: string | null; propertyId?: string | null },
): Promise<void> {
  const plan = await resolveEffectivePlan(supabase, userId, opts);
  if (!plan.features[feature]) {
    const labels = {
      autoImport: "Importação automática (Airbnb)",
      ai: "Concierge IA",
      customBrand: "Marca personalizada",
    } as const;
    throw new Error(
      `${labels[feature]} não está disponível no seu plano. Faça upgrade em /precos.`,
    );
  }
}


/**
 * Resolves a property owner's plan using the service role client. For use in
 * unauthenticated public routes (guide page, public chat). Mirrors
 * resolveUserPlan but bypasses RLS by querying through supabaseAdmin.
 */
export async function resolveOwnerPlanAdmin(
  supabaseAdmin: SupabaseClient,
  ownerId: string,
): Promise<ResolvedPlan> {
  const runtimeEnv = getRuntimeEnv();
  const { data: subs } = await supabaseAdmin
    .from("subscriptions")
    .select("status, product_id, current_period_end, environment, is_manual, max_guides_override, created_at")
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false });
  const list = subs ?? [];
  const candidates = [
    ...list.filter((sub) => sub.environment === runtimeEnv),
    ...list.filter((sub) => sub.environment !== runtimeEnv && (sub.is_manual || sub.product_id === "enterprise_plan")),
  ];
  for (const sub of candidates) {
    const status = (sub.status as string) ?? null;
    const endIso = (sub.current_period_end as string | null) ?? null;
    const endDate = endIso ? new Date(endIso) : null;
    const periodValid = !endDate || endDate > new Date();
    const isActive =
      ((status === "active" || status === "trialing" || status === "past_due") && periodValid) ||
      (status === "canceled" && !!endDate && endDate > new Date());
    if (!isActive) continue;
    const plan = planFromProductId(sub.product_id as string | null);
    if (!plan) continue;
    const cfg = PLANS[plan];
    const override = (sub.max_guides_override as number | null) ?? null;
    return { plan, status, maxGuides: override ?? cfg.maxGuides, features: { ...cfg.features } };
  }
  return FREE;
}
