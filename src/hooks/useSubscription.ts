import { useEffect, useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPaddleEnvironment } from "@/lib/paddle";
import {
  getMySubscription,
  getAccountSubscription,
  PLANS,
  type PlanKey,
} from "@/lib/payments.functions";
import type { PlanFeatures } from "@/lib/payments.shared";
import { useImpersonation } from "@/hooks/useImpersonation";

export type SubscriptionInfo = {
  plan: PlanKey | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isActive: boolean;
  isTrialing: boolean;
  isPastDue: boolean;
  isManual: boolean;
  maxGuides: number;
  maxGuidesOverride: number | null;
  customPriceCents: number | null;
  customCurrency: string | null;
  adminNotes: string | null;
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

/**
 * Retorna a assinatura efetiva da CONTA ativa do usuário logado:
 *  - Se ele estiver "impersonando" (SaaS admin) ou for membro de equipe de
 *    outra conta (via account_members / AccountSwitcher), usamos o plano do
 *    dono daquela conta.
 *  - Caso contrário, usamos a assinatura do próprio usuário.
 *
 * Isso garante que membros convidados enxerguem as features contratadas pelo
 * dono da conta (IA, biblioteca, etc.) em vez de caírem no plano Free.
 */
export function useSubscription(opts?: { impersonateUserId?: string | null }) {
  const fetchSelf = useServerFn(getMySubscription);
  const fetchAccount = useServerFn(getAccountSubscription);
  const qc = useQueryClient();
  const env = getPaddleEnvironment();
  const channelId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [userId, setUserId] = useState<string | null>(null);
  const { impersonation } = useImpersonation();
  const explicitImpersonate = opts?.impersonateUserId ?? null;
  // Fonte da conta ativa: parâmetro explícito > impersonação global.
  const activeOwnerId = explicitImpersonate ?? impersonation?.userId ?? null;

  useEffect(() => {
    let mounted = true;
    const sync = async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setUserId(data.session?.access_token ? data.session.user.id : null);
    };
    sync();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.access_token ? session.user.id : null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Se activeOwnerId == userId ou não houver impersonação, buscamos self.
  const ownerForQuery = activeOwnerId && activeOwnerId !== userId ? activeOwnerId : null;

  const query = useQuery({
    queryKey: ["my-subscription", env, userId, ownerForQuery],
    enabled: !!userId,
    queryFn: () =>
      ownerForQuery
        ? fetchAccount({ data: { ownerId: ownerForQuery, environment: env } })
        : fetchSelf({ data: { environment: env } }),
  });


  useEffect(() => {
    const target = ownerForQuery ?? userId;
    if (!target) return;
    const channel = supabase
      .channel(`subscriptions:${target}:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${target}` },
        () => {
          qc.invalidateQueries({ queryKey: ["my-subscription", env, userId, ownerForQuery] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, env, qc, channelId, ownerForQuery]);


  const data = query.data;
  const sub = data?.subscription ?? null;
  const plan = data?.plan ?? null;

  const status = sub?.status ?? null;
  const periodEnd = sub?.current_period_end ?? null;
  const periodEndDate = periodEnd ? new Date(periodEnd) : null;
  const periodValid = !periodEndDate || periodEndDate > new Date();

  const isTrialing = status === "trialing" && periodValid;
  const isActive =
    (status === "active" && periodValid) ||
    isTrialing ||
    (status === "past_due" && periodValid) ||
    (status === "canceled" && !!periodEndDate && periodEndDate > new Date());
  const isPastDue = status === "past_due";

  const planConfig = plan ? PLANS[plan] : null;

  const subAny = sub as (typeof sub & {
    custom_price_cents?: number | null;
    custom_currency?: string | null;
    trial_ends_at?: string | null;
    max_guides_override?: number | null;
    admin_notes?: string | null;
    is_manual?: boolean | null;
  }) | null;
  const override = subAny?.max_guides_override ?? null;
  const baseMax = planConfig ? planConfig.maxGuides : 0;

  const info: SubscriptionInfo = {
    plan: isActive ? plan : null,
    status,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    currentPeriodEnd: periodEnd,
    trialEndsAt: subAny?.trial_ends_at ?? null,
    isActive,
    isTrialing,
    isPastDue,
    isManual: !!subAny?.is_manual,
    maxGuides: isActive ? (override ?? baseMax) : 0,
    maxGuidesOverride: override,
    customPriceCents: subAny?.custom_price_cents ?? null,
    customCurrency: subAny?.custom_currency ?? null,
    adminNotes: subAny?.admin_notes ?? null,
    features: isActive && planConfig ? planConfig.features : FREE_FEATURES,
  };

  return { ...query, info };
}
