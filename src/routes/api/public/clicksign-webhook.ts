import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const UUID = z.string().uuid();

function safeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const Route = createFileRoute("/api/public/clicksign-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ownerId = new URL(request.url).searchParams.get("o") ?? "";
        if (!UUID.safeParse(ownerId).success) {
          return new Response("Invalid owner", { status: 400 });
        }

        const rawBody = await request.text();
        if (rawBody.length > 1_000_000) return new Response("Payload too large", { status: 413 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: cred } = await supabaseAdmin
          .from("host_integration_credentials")
          .select("webhook_secret")
          .eq("owner_id", ownerId)
          .eq("provider", "clicksign")
          .maybeSingle();

        const secret = (cred?.webhook_secret as string | null) ?? null;
        if (!secret) return new Response("Integration not configured", { status: 404 });

        const header =
          request.headers.get("content-hmac") ??
          request.headers.get("Content-Hmac") ??
          "";
        const received = header.replace(/^sha256=/i, "").trim();
        const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
        if (!received || !safeEqual(received, expected)) {
          return new Response("Invalid signature", { status: 401 });
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }

        const doc = (payload["document"] ?? {}) as Record<string, unknown>;
        const key = typeof doc["key"] === "string" ? (doc["key"] as string) : null;

        if (key) {
          const downloads = (doc["downloads"] as Record<string, unknown> | undefined) ?? {};
          const signersRaw = doc["signers"] ?? [];
          const signers = Array.isArray(signersRaw) ? signersRaw : [];

          const { data: existing } = await supabaseAdmin
            .from("clicksign_documents")
            .select("id")
            .eq("account_owner_id", ownerId)
            .eq("document_key", key)
            .maybeSingle();

          const values = {
            account_owner_id: ownerId,
            document_key: key,
            name: (doc["filename"] as string) ?? (doc["path"] as string) ?? "Documento ClickSign",
            status: (doc["status"] as string) ?? "unknown",
            signers: signers as never,
            url_original: (downloads["original_file_url"] as string) ?? null,
            url_signed: (downloads["signed_file_url"] as string) ?? null,
            finished_at: (doc["finished_at"] as string) ?? null,
            raw: doc as never,
            synced_at: new Date().toISOString(),
          };

          if (existing) {
            await supabaseAdmin.from("clicksign_documents").update(values).eq("id", existing.id);
          } else {
            await supabaseAdmin.from("clicksign_documents").insert(values);
          }
        }

        await supabaseAdmin
          .from("host_integration_credentials")
          .update({ webhook_last_event_at: new Date().toISOString() })
          .eq("owner_id", ownerId)
          .eq("provider", "clicksign");

        return new Response("ok");
      },
    },
  },
});
