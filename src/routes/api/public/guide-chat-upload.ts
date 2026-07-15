import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

// Guest uploads for chat: multipart form. Validated by (conversationId, sessionId) pair.
// Only allowed during human handoff (ai_paused = true) to keep AI-mode conversations light.

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_AUDIO_MS = 60_000;

const ALLOWED_MIME: Record<string, "image" | "audio" | "video" | "document"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "audio/webm": "audio",
  "audio/webm;codecs=opus": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "application/pdf": "document",
};

const Meta = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  sessionId: z.string().min(8).max(80),
  conversationId: z.string().uuid(),
  durationMs: z.coerce.number().int().nonnegative().max(5 * 60_000).optional(),
});

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

export const Route = createFileRoute("/api/public/guide-chat-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response(JSON.stringify({ error: "invalid_form" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const parsedMeta = Meta.safeParse({
          slug: form.get("slug"),
          sessionId: form.get("sessionId"),
          conversationId: form.get("conversationId"),
          durationMs: form.get("durationMs") ?? undefined,
        });
        if (!parsedMeta.success) {
          return new Response(JSON.stringify({ error: "invalid_meta" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const meta = parsedMeta.data;

        const file = form.get("file");
        if (!(file instanceof File)) {
          return new Response(JSON.stringify({ error: "no_file" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (file.size > MAX_BYTES) {
          return new Response(JSON.stringify({ error: "file_too_large" }), {
            status: 413,
            headers: { "Content-Type": "application/json" },
          });
        }
        const mimeKey = (file.type || "").toLowerCase();
        const kind = ALLOWED_MIME[mimeKey] ?? ALLOWED_MIME[mimeKey.split(";")[0]];
        if (!kind) {
          return new Response(JSON.stringify({ error: "mime_not_allowed" }), {
            status: 415,
            headers: { "Content-Type": "application/json" },
          });
        }
        if (kind === "audio" && (meta.durationMs ?? 0) > MAX_AUDIO_MS) {
          return new Response(JSON.stringify({ error: "audio_too_long" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Validate conversation ownership by (slug, session).
        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("id, published")
          .eq("slug", meta.slug)
          .eq("published", true)
          .maybeSingle();
        if (!prop) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const { data: conv } = await supabaseAdmin
          .from("property_chat_conversations")
          .select("id, property_id, guest_session_id, ai_paused, status")
          .eq("id", meta.conversationId)
          .maybeSingle();
        if (!conv || conv.property_id !== prop.id || conv.guest_session_id !== meta.sessionId) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }

        // Only allow guest uploads while a human is handling — reduces abuse surface.
        if (!conv.ai_paused) {
          return new Response(JSON.stringify({ error: "not_in_human_mode" }), {
            status: 403,
            headers: { "Content-Type": "application/json" },
          });
        }

        const ext = extFromMime(mimeKey);
        const objectId = crypto.randomUUID();
        const path = `${prop.id}/${conv.id}/guest-${objectId}.${ext}`;

        const buffer = new Uint8Array(await file.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from("chat-attachments")
          .upload(path, buffer, {
            contentType: mimeKey || "application/octet-stream",
            upsert: false,
          });
        if (upErr) {
          return new Response(JSON.stringify({ error: "upload_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { data: inserted, error: iErr } = await supabaseAdmin
          .from("property_chat_messages")
          .insert({
            conversation_id: conv.id,
            role: "user",
            content: "",
            sender_type: "guest",
            attachment_path: path,
            attachment_type: kind,
            attachment_mime: mimeKey,
            attachment_size_bytes: file.size,
            attachment_duration_ms: kind === "audio" || kind === "video" ? meta.durationMs ?? null : null,
            attachment_name: file.name || null,
          })
          .select("id")
          .single();
        if (iErr || !inserted) {
          return new Response(JSON.stringify({ error: "persist_failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        await supabaseAdmin
          .from("property_chat_conversations")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", conv.id);

        // Return a short-lived signed URL so the guest UI can preview right away.
        const { data: signed } = await supabaseAdmin.storage
          .from("chat-attachments")
          .createSignedUrl(path, 60 * 60);

        return new Response(
          JSON.stringify({
            id: inserted.id,
            path,
            url: signed?.signedUrl ?? null,
            type: kind,
            mime: mimeKey,
            durationMs: meta.durationMs ?? null,
            name: file.name ?? null,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
