import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Server function pública: retorna a chave pública VAPID para o cliente
// registrar a subscription. Chave pública é segura para expor.
export const getVapidPublicKey = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.VAPID_PUBLIC_KEY;
  if (!key) throw new Error("VAPID não configurado");
  return { publicKey: key };
});

const SubscribeInput = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
  userAgent: z.string().max(500).optional().nullable(),
});

export const subscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SubscribeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: data.endpoint,
          p256dh: data.keys.p256dh,
          auth: data.keys.auth,
          user_agent: data.userAgent ?? null,
          enabled: true,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: "endpoint" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UnsubscribeInput = z.object({ endpoint: z.string().url().max(2000) });

export const unsubscribePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UnsubscribeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("push_subscriptions")
      .delete()
      .eq("user_id", userId)
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const PrefsInput = z.object({
  enabled: z.boolean().optional(),
  soundEnabled: z.boolean().optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullable().optional(),
  quietHoursEnd: z.number().int().min(0).max(23).nullable().optional(),
});

export const updatePushPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PrefsInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const patch: {
      enabled?: boolean;
      sound_enabled?: boolean;
      quiet_hours_start?: number | null;
      quiet_hours_end?: number | null;
    } = {};
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.soundEnabled !== undefined) patch.sound_enabled = data.soundEnabled;
    if (data.quietHoursStart !== undefined) patch.quiet_hours_start = data.quietHoursStart;
    if (data.quietHoursEnd !== undefined) patch.quiet_hours_end = data.quietHoursEnd;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabase
      .from("push_subscriptions")
      .update(patch)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyPushSubscriptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, user_agent, enabled, sound_enabled, quiet_hours_start, quiet_hours_end, created_at, last_used_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { subscriptions: data ?? [] };
  });
