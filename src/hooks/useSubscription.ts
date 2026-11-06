import { useEffect, useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getAccountBilling } from "@/lib/billing/billing.functions";
import { NO_FEATURES, type PlanFeatures, type PlanKey } from "@/lib/billing/plan";
import { useImpersonation } from "@/hooks/useImpersonation";

type BillingSummary = NonNullable<Awaited<ReturnType<typeof getAccountBilling>>>["billing"];

export type SubscriptionInfo = {
  /** Plano único quando a conta tem acesso; null = sem assinatura ativa. */
  plan: PlanKey | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  isActive: boolean;
  isTrialing: boolean;
  isPastDue: boolean;
  /** Liberação manual antiga (sem cobrança na Stripe). */
  isManual: boolean;
  /** Assinatura com cobrança na Stripe. */
  hasStripeBilling: boolean;
  /** Cobrança pausada (conta com zero anúncios ativos). */
  billingPaused: boolean;
  maxGuides: number;
  maxGuidesOverride: number | null;
  adminNotes: string | null;
  features: PlanFeatures;
  billing: BillingSummary | null;
};

/**
 * Assinatura efetiva da CONTA ativa: a do titular para membros de equipe e para o admin SaaS que
 * impersona, senão a do próprio usuário. Atualiza sozinha quando a linha da assinatura muda.
 */
export function useSubscription(opts?: { impersonateUserId?: string | null }) {
  const fetchBilling = useServerFn(getAccountBilling);
  const qc = useQueryClient();
  const channelId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [userId, setUserId] = useState<string | null>(null);
  const { impersonation } = useImpersonation();
  const activeOwnerId = opts?.impersonateUserId ?? impersonation?.userId ?? null;

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setUserId(data.session?.access_token ? data.session.user.id : null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.access_token ? session.user.id : null);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const ownerForQuery = activeOwnerId && activeOwnerId !== userId ? activeOwnerId : null;
  const queryKey = ["my-subscription", userId, ownerForQuery] as const;
  const query = useQuery({
    queryKey,
    enabled: !!userId,
    queryFn: () => fetchBilling({ data: { ownerId: ownerForQuery } }),
  });

  useEffect(() => {
    const target = ownerForQuery ?? userId;
    if (!target) return;
    const channel = supabase
      .channel(`subscriptions:${target}:${channelId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${target}` }, () => {
        qc.invalidateQueries({ queryKey: ["my-subscription", userId, ownerForQuery] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, qc, channelId, ownerForQuery]);

  const data = query.data;
  const sub = data?.subscription ?? null;
  const status = sub?.status ?? null;
  const hasAccess = !!data?.hasAccess;

  const info: SubscriptionInfo = {
    plan: hasAccess ? ("conciergeia" as PlanKey) : null,
    status,
    cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    trialEndsAt: sub?.trialEndsAt ?? null,
    isActive: hasAccess,
    isTrialing: hasAccess && status === "trialing",
    isPastDue: status === "past_due",
    isManual: !!sub?.isManual,
    hasStripeBilling: !!sub?.hasStripeBilling,
    billingPaused: !!sub?.billingPaused,
    maxGuides: hasAccess ? (data?.maxGuides ?? 0) : 0,
    maxGuidesOverride: sub?.maxGuidesOverride ?? null,
    adminNotes: sub?.adminNotes ?? null,
    features: hasAccess && data ? data.features : NO_FEATURES,
    billing: data?.billing ?? null,
  };

  return { ...query, info };
}
