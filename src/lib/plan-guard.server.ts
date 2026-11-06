// Server-side plan/quota enforcement. Loaded inside server-fn handlers only.
//
// 06/11/2026: plano único cobrado por anúncio (Stripe). Assinatura que concede acesso = TODOS os
// recursos e guias ilimitados (salvo `max_guides_override` definido pelo admin).
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ALL_FEATURES,
  NO_FEATURES,
  PLAN_KEY,
  UNLIMITED_GUIDES,
  type PlanFeatures,
  type PlanKey,
} from "@/lib/billing/plan";

export type BillingEnv = "sandbox" | "live";

export type ResolvedPlan = {
  plan: PlanKey | null;
  hasAccess: boolean;
  status: string | null;
  maxGuides: number;
  features: PlanFeatures;
};

const FREE: ResolvedPlan = {
  plan: null,
  hasAccess: false,
  status: null,
  maxGuides: 0,
  features: NO_FEATURES,
};

const SUB_FIELDS =
  "status, current_period_end, trial_ends_at, environment, is_manual, max_guides_override, created_at, stripe_subscription_id";

// Ambiente da cobrança: o da chave da Stripe; sem chave, produção → live, preview → sandbox.
// Assinatura de teste nunca libera acesso em produção.
async function getRuntimeEnv(): Promise<BillingEnv> {
  const { stripeEnvOrNull } = await import("@/lib/billing/stripe.server");
  return stripeEnvOrNull() ?? (import.meta.env.PROD ? "live" : "sandbox");
}

const TRIAL_MAX_DAYS = 7;

/**
 * Uma assinatura só concede acesso se o período for válido. Para trials (liberação manual do
 * admin), o limite é `trial_ends_at`.
 */
function subscriptionGrantsAccess(sub: {
  status?: string | null;
  current_period_end?: string | null;
  trial_ends_at?: string | null;
  created_at?: string | null;
}): boolean {
  const status = sub.status ?? null;
  const now = new Date();
  const endDate = sub.current_period_end ? new Date(sub.current_period_end) : null;
  const periodValid = !endDate || endDate > now;

  if (status === "trialing") {
    const trialEnd = sub.trial_ends_at
      ? new Date(sub.trial_ends_at)
      : sub.created_at
        ? new Date(new Date(sub.created_at).getTime() + TRIAL_MAX_DAYS * 86_400_000)
        : null;
    const trialValid = !!trialEnd && trialEnd > now;
    return trialValid && periodValid;
  }
  if (status === "active" || status === "past_due") return periodValid;
  if (status === "canceled") return !!endDate && endDate > now;
  return false;
}

function grantFrom(rows: any[], runtimeEnv: BillingEnv): ResolvedPlan {
  const candidates = [
    ...rows.filter((s) => s.environment === runtimeEnv),
    // Entre ambientes, só liberação manual criada pelo painel admin (sem cobrança na Stripe).
    ...rows.filter((s) => s.environment !== runtimeEnv && s.is_manual === true && !s.stripe_subscription_id),
  ];
  for (const sub of candidates) {
    if (!subscriptionGrantsAccess(sub)) continue;
    const override = (sub.max_guides_override as number | null) ?? null;
    return {
      plan: PLAN_KEY,
      hasAccess: true,
      status: (sub.status as string) ?? null,
      maxGuides: override ?? UNLIMITED_GUIDES,
      features: { ...ALL_FEATURES },
    };
  }
  return FREE;
}

// Plano do próprio usuário pelo cliente com RLS.
export async function resolveUserPlan(supabase: SupabaseClient, userId: string): Promise<ResolvedPlan> {
  const { data: subs } = await supabase
    .from("subscriptions")
    .select(SUB_FIELDS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return grantFrom((subs ?? []) as any[], await getRuntimeEnv());
}

/**
 * Resolve o plano EFETIVO para uma operação: se `ownerId` (ou `propertyId`) aponta para outra
 * conta e o caller é membro ativo dela, vale o plano do DONO daquela conta.
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
    const { data: isMember, error: memberRpcError } = await supabase.rpc("is_account_member", {
      _user_id: userId,
      _owner_id: ownerId,
    });
    let memberAllowed = !!isMember;
    if (memberRpcError) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: member } = await supabaseAdmin
        .from("account_members")
        .select("id")
        .eq("member_user_id", userId)
        .eq("owner_id", ownerId)
        .eq("status", "active")
        .maybeSingle();
      memberAllowed = !!member;
    }
    if (memberAllowed) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      return await resolveOwnerPlanAdmin(supabaseAdmin, ownerId);
    }
  }
  return await resolveUserPlan(supabase, userId);
}

const NO_PLAN_MESSAGE = "Você precisa de uma assinatura ativa para usar este recurso. Assine em Administrativo › Assinatura.";

export async function assertCanCreateGuide(
  supabase: SupabaseClient,
  userId: string,
  opts?: { ownerId?: string | null },
): Promise<void> {
  const targetOwner = opts?.ownerId ?? userId;
  const plan = await resolveEffectivePlan(supabase, userId, { ownerId: targetOwner });
  if (!plan.hasAccess) throw new Error(NO_PLAN_MESSAGE);
  if (plan.maxGuides >= UNLIMITED_GUIDES) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = targetOwner !== userId ? supabaseAdmin : supabase;
  const { count, error } = await client
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", targetOwner);
  if (error) return; // soft-fail on count errors
  if ((count ?? 0) >= plan.maxGuides) {
    throw new Error(`Limite de ${plan.maxGuides} guias definido para esta conta foi atingido. Fale com o suporte.`);
  }
}

export async function assertFeature(
  supabase: SupabaseClient,
  userId: string,
  feature: keyof PlanFeatures,
  opts?: { ownerId?: string | null; propertyId?: string | null },
): Promise<void> {
  const plan = await resolveEffectivePlan(supabase, userId, opts);
  if (!plan.features[feature]) throw new Error(NO_PLAN_MESSAGE);
}

/**
 * Plano do dono de uma conta pelo service role (rotas públicas: guia, chat). Cache curto,
 * invalidado pelo webhook da Stripe e pela sincronização de anúncios.
 */
const ownerPlanCache = new Map<string, { at: number; value: ResolvedPlan }>();
const OWNER_PLAN_TTL = 20_000;

export function invalidateOwnerPlanCache(ownerId?: string): void {
  if (ownerId) ownerPlanCache.delete(ownerId);
  else ownerPlanCache.clear();
}

export async function resolveOwnerPlanAdmin(supabaseAdmin: SupabaseClient, ownerId: string): Promise<ResolvedPlan> {
  const hit = ownerPlanCache.get(ownerId);
  if (hit && Date.now() - hit.at < OWNER_PLAN_TTL) return hit.value;
  const { data: subs } = await supabaseAdmin
    .from("subscriptions")
    .select(SUB_FIELDS)
    .eq("user_id", ownerId)
    .order("created_at", { ascending: false });
  const value = grantFrom((subs ?? []) as any[], await getRuntimeEnv());
  ownerPlanCache.set(ownerId, { at: Date.now(), value });
  return value;
}
