import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { SITE_ORIGIN } from "@/lib/site-url";

// Public shape (safe to expose to client): no token.
export type WhatsappConfigPublic = {
  provider: string;
  senderNumber: string | null;
  projectId: string | null;
  appId: string | null;
  status: "pending" | "testing" | "active" | "error";
  lastVerifiedAt: string | null;
  lastError: string | null;
  webhookUrl: string;
  webhookSecretMasked: string;
  hasToken: boolean;
};

const CONFIG_INPUT = z.object({
  senderNumber: z.string().trim().min(6).max(20),
  projectId: z.string().trim().min(3),
  appId: z.string().trim().min(3),
  apiToken: z.string().trim().min(8).optional(),
});

function maskSecret(s: string | null): string {
  if (!s) return "";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}${"•".repeat(s.length - 8)}${s.slice(-4)}`;
}

function siteOrigin(): string {
  // Fonte única do endereço do sistema — ver src/lib/site-url.ts.
  return SITE_ORIGIN;
}

export const getMyWhatsappConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ ownerId: z.string().uuid().nullish() }).parse(raw ?? {}))
  .handler(async ({ data: input, context }): Promise<WhatsappConfigPublic> => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, input.ownerId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("host_whatsapp_config")
      .select(
        "provider, sender_number, service_plan_id, app_id, api_token_encrypted, webhook_secret, status, last_verified_at, last_error",
      )
      .eq("owner_id", ownerId)
      .maybeSingle();
    const webhookUrl = `${siteOrigin()}/api/public/whatsapp/sinch-webhook?owner=${ownerId}`;
    return {
      provider: (data?.provider as string) ?? "sinch",
      senderNumber: (data?.sender_number as string) ?? null,
      projectId: (data?.service_plan_id as string) ?? null,
      appId: (data?.app_id as string) ?? null,
      status: (data?.status as WhatsappConfigPublic["status"]) ?? "pending",
      lastVerifiedAt: (data?.last_verified_at as string) ?? null,
      lastError: (data?.last_error as string) ?? null,
      webhookUrl,
      webhookSecretMasked: maskSecret((data?.webhook_secret as string) ?? null),
      hasToken: Boolean(data?.api_token_encrypted),
    };
  });

export const saveMyWhatsappConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CONFIG_INPUT.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let encrypted: string | undefined;
    if (data.apiToken) {
      const { encryptToken } = await import("@/lib/whatsapp.server");
      encrypted = encryptToken(data.apiToken);
    }
    const { error } = await supabase.from("host_whatsapp_config").upsert(
      {
        owner_id: userId,
        provider: "sinch",
        sender_number: data.senderNumber.replace(/[^\d+]/g, ""),
        service_plan_id: data.projectId,
        app_id: data.appId,
        status: "testing",
        last_error: null,
        updated_at: new Date().toISOString(),
        ...(encrypted ? { api_token_encrypted: encrypted } : {}),
      },
      { onConflict: "owner_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const disconnectMyWhatsappConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("host_whatsapp_config").delete().eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---- Send a proactive/reply WhatsApp message from a conversation ----
const SEND_INPUT = z.object({
  conversationId: z.string().uuid(),
  text: z.string().trim().min(1).max(4000),
});

export const sendWhatsappFromConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => SEND_INPUT.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // núcleo único de envio humano pelo WhatsApp oficial (servidor; também usado pelo Copiloto)
    const { sendWhatsappMessageToConversation } = await import("@/lib/whatsapp-send.server");
    await sendWhatsappMessageToConversation(supabase, userId, data);
    return { ok: true };
  });
