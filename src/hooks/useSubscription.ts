import { useEffect, useId, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPaddleEnvironment } from "@/lib/paddle";
import { getMySubscription, PLANS, type PlanKey } from "@/lib/payments.functions";
import { adminGetUserSubscription } from "@/lib/admin-subs.functions";

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
  features: { autoImport: boolean; ai: boolean; customBrand: boolean };
};

const FREE_FEATURES = {
  autoImport: false,
  ai: false,
  customBrand: false,
} as const;

export function useSubscription(opts?: { impersonateUserId?: string | null }) {
  const fetchSub = useServerFn(getMySubscription);
  const fetchAsUser = useServerFn(adminGetUserSubscription);
  const qc = useQueryClient();
  const env = getPaddleEnvironment();
  const channelId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [userId, setUserId] = useState<string | null>(null);
  const impersonateId = opts?.impersonateUserId ?? null;

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

  const query = useQuery({
    queryKey: ["my-subscription", env, userId, impersonateId],
    enabled: !!userId,
    queryFn: () =>
      impersonateId
        ? fetchAsUser({ data: { userId: impersonateId, environment: env } })
        : fetchSub({ data: { environment: env } }),
  });


  useEffect(() => {
    const target = impersonateId ?? userId;
    if (!target) return;
    const channel = supabase
      .channel(`subscriptions:${target}:${channelId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${target}` },
        () => {
          qc.invalidateQueries({ queryKey: ["my-subscription", env, userId, impersonateId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, env, qc, channelId, impersonateId]);


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
