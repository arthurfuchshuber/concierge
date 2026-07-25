// Server-only: envia push para todos os admins do SaaS (role=admin em user_roles).
// Importar apenas dentro de handlers de server functions / server routes.
import { sendPushToSubscriptions, type PushPayload } from "@/lib/push.server";

export async function notifySaasAdmins(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: roleRows } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin");

  const ids = Array.from(new Set((roleRows ?? []).map((r) => r.user_id as string)));
  if (ids.length === 0) return { sent: 0, failed: 0 };

  const { data: subs } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids)
    .eq("enabled", true);

  if (!subs || subs.length === 0) return { sent: 0, failed: 0 };

  const res = await sendPushToSubscriptions(
    subs.map((s) => ({
      id: s.id as string,
      endpoint: s.endpoint as string,
      p256dh: s.p256dh as string,
      auth: s.auth as string,
    })),
    payload,
  );

  if (res.stale.length) {
    await supabaseAdmin.from("push_subscriptions").delete().in("id", res.stale);
  }
  return { sent: res.sent, failed: res.failed };
}

export async function notifySaasAdminsTrialStarted(opts: {
  userId: string;
  productId: string;
  environment: string;
  trialEndsAt: string | null;
}): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: profile }, { data: userRes }] = await Promise.all([
      supabaseAdmin.from("profiles").select("full_name, phone").eq("id", opts.userId).maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(opts.userId),
    ]);

    const email = userRes?.user?.email ?? null;
    const name = (profile?.full_name as string | null)?.trim() || email || "Novo cliente";
    const planLabel = opts.productId.replace(/_plan$/, "").replace(/^\w/, (c) => c.toUpperCase());

    let trialLabel = "";
    if (opts.trialEndsAt) {
      try {
        const d = new Date(opts.trialEndsAt);
        trialLabel = ` • trial até ${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      } catch {}
    }

    const envLabel = opts.environment === "live" ? "" : ` [${opts.environment}]`;
    const bodyParts = [
      `Plano ${planLabel}${trialLabel}`,
      email ?? undefined,
      profile?.phone ? String(profile.phone) : undefined,
    ].filter(Boolean);

    await notifySaasAdmins({
      title: `🎉 Novo trial: ${name}${envLabel}`,
      body: bodyParts.join(" • ").slice(0, 220),
      data: {
        url: `/admin/clientes`,
        tag: `trial-${opts.userId}`,
      },
    });
  } catch (err) {
    console.error("notifySaasAdminsTrialStarted failed", err);
  }
}
