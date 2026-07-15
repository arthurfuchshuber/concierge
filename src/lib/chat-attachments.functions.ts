import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const AttachmentType = z.enum(["image", "audio", "video", "document"]);

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_AUDIO_MS = 60_000;

/**
 * Creates a signed URL so the browser can read a private chat attachment.
 */
export const signChatAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) =>
    z.object({ path: z.string().min(3).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // RLS on storage.objects enforces property access.
    const { data: signed, error } = await context.supabase.storage
      .from("chat-attachments")
      .createSignedUrl(data.path, 60 * 60);
    if (error || !signed) throw new Error("Não consegui gerar o link do anexo.");
    return { url: signed.signedUrl };
  });

/**
 * Persists a chat message row that points at an already-uploaded storage object.
 * The client uploads directly to storage under
 *   <property_id>/<conversation_id>/<uuid>.<ext>
 * (RLS lets any member of the property write there), then calls this fn.
 */
export const attachStaffMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    conversationId: string;
    path: string;
    attachmentType: "image" | "audio" | "video" | "document";
    mime: string;
    sizeBytes: number;
    durationMs?: number | null;
    name?: string | null;
    caption?: string | null;
    internalNote?: boolean;
  }) =>
    z
      .object({
        conversationId: z.string().uuid(),
        path: z.string().min(3).max(500),
        attachmentType: AttachmentType,
        mime: z.string().min(1).max(120),
        sizeBytes: z.number().int().nonnegative().max(MAX_BYTES),
        durationMs: z.number().int().nonnegative().max(5 * 60_000).optional().nullable(),
        name: z.string().max(200).optional().nullable(),
        caption: z.string().max(2000).optional().nullable(),
        internalNote: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (data.attachmentType === "audio" && (data.durationMs ?? 0) > MAX_AUDIO_MS) {
      throw new Error("Áudio acima do limite de 60 segundos.");
    }

    // Load conversation and verify caller has access to the property.
    const { data: conv, error: cErr } = await context.supabase
      .from("property_chat_conversations")
      .select("id, property_id, assigned_to, status")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (cErr || !conv) throw new Error("Conversa não encontrada.");

    // Path prefix must match the conversation's property + conversation.
    const expected = `${conv.property_id}/${data.conversationId}/`;
    if (!data.path.startsWith(expected)) {
      throw new Error("Caminho de anexo inválido.");
    }

    // Insert message.
    const { data: inserted, error: iErr } = await context.supabase
      .from("property_chat_messages")
      .insert({
        conversation_id: data.conversationId,
        role: "assistant",
        content: data.caption ?? "",
        sender_type: "human",
        is_internal_note: !!data.internalNote,
        attachment_path: data.path,
        attachment_type: data.attachmentType,
        attachment_mime: data.mime,
        attachment_size_bytes: data.sizeBytes,
        attachment_duration_ms: data.durationMs ?? null,
        attachment_name: data.name ?? null,
      })
      .select("id")
      .single();
    if (iErr || !inserted) throw new Error("Não consegui salvar o anexo.");

    // If AI is currently handling, pause it — a human is stepping in.
    if (!data.internalNote) {
      await context.supabase
        .from("property_chat_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          ai_paused: true,
        })
        .eq("id", data.conversationId);
    }

    return { id: inserted.id };
  });
