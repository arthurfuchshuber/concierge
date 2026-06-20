// Server-side plan/quota enforcement. Loaded inside server-fn handlers only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, type PlanKey, planFromProductId } from "@/lib/payments.functions";

export type PaddleEnv = "sandbox" | "live";

export type ResolvedPlan = {
  plan: PlanKey | null;
  status: string | null;
  maxGuides: number;
  features: { autoImport: boolean; ai: boolean; customBrand: boolean };
};

const FREE: ResolvedPlan = {
  plan: null,
  status: null,
  maxGuides: 0,
  features: { autoImport: false, ai: false, customBrand: false },
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
    .select("status, product_id, current_period_end, environment, created_at")
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
    return { plan, status, maxGuides: cfg.maxGuides, features: { ...cfg.features } };
  }
  return FREE;
}


export async function assertCanCreateGuide(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const plan = await resolveUserPlan(supabase, userId);
  if (!plan.plan) {
    throw new Error("Você precisa de um plano ativo para criar guias. Assine em /precos.");
  }
  const { count, error } = await supabase
    .from("properties")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", userId);
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
): Promise<void> {
  const plan = await resolveUserPlan(supabase, userId);
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
    .select("status, product_id, current_period_end, environment, created_at")
    .eq("user_id", ownerId)
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
    return { plan, status, maxGuides: cfg.maxGuides, features: { ...cfg.features } };
  }
  return FREE;
}
