import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getPaddleEnvironment } from "@/lib/paddle";
import { getMySubscription, PLANS, type PlanKey } from "@/lib/payments.functions";

export type SubscriptionInfo = {
  plan: PlanKey | null;
  status: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  isActive: boolean;
  isTrialing: boolean;
  isPastDue: boolean;
  maxGuides: number;
  features: { autoImport: boolean; ai: boolean; customBrand: boolean };
};

const FREE_FEATURES = {
  autoImport: false,
  ai: false,
  customBrand: false,
} as const;

export function useSubscription() {
  const fetchSub = useServerFn(getMySubscription);
  const qc = useQueryClient();
  const env = getPaddleEnvironment();
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const query = useQuery({
    queryKey: ["my-subscription", env, userId],
    enabled: !!userId,
    queryFn: () => fetchSub({ data: { environment: env } }),
  });

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`subscriptions:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["my-subscription", env, userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, env, qc]);

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

  const info: SubscriptionInfo = {
    plan: isActive ? plan : null,
    status,
    cancelAtPeriodEnd: !!sub?.cancel_at_period_end,
    currentPeriodEnd: periodEnd,
    isActive,
    isTrialing,
    isPastDue,
    maxGuides: isActive && planConfig ? planConfig.maxGuides : 0,
    features: isActive && planConfig ? planConfig.features : FREE_FEATURES,
  };

  return { ...query, info };
}
