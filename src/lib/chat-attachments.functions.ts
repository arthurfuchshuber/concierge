import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { pausePatch } from "@/lib/ai/pause";

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
    // Confere o acesso ao imóvel na hora (RLS do usuário) antes de assinar.
    const propertyId = data.path.split("/")[0] ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(propertyId)) throw new Error("Caminho de anexo inválido.");
    const { data: prop } = await context.supabase
      .from("properties")
      .select("id")
      .eq("id", propertyId)
      .maybeSingle();
    if (!prop) throw new Error("Sem acesso a este anexo.");
    // Sem link assinado: o arquivo é lido agora, com a RLS do usuário, e
    // entregue direto. Nenhum link reutilizável sobrevive à remoção do acesso.
    const { data: blob, error } = await context.supabase.storage
      .from("chat-attachments")
      .download(data.path);
    if (error || !blob) throw new Error("Não consegui carregar o anexo.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return { base64: btoa(bin), mime: blob.type || "application/octet-stream" };
  });

/**
 * Persists a chat message row that points at an already-uploaded storage object.
 * The client uploads directly to storage under
 *   <property_id>/<conversation_id>/<uuid>.<ext>
 * (RLS lets any member of the property write there), then calls this fn.
 */
export const attachStaffMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
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
          durationMs: z
            .number()
            .int()
            .nonnegative()
            .max(5 * 60_000)
            .optional()
            .nullable(),
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

    /* ÁUDIO DO ATENDENTE TAMBÉM É CONTEXTO (pedido explícito, 11/09/2026).
       Sem isto, o que o atendente combinou por áudio some para a IA: quando
       ela voltar a atender essa conversa, vai ler uma mensagem em branco no
       lugar da negociação inteira. Transcrever aqui custa uma vez; ler errado
       custa toda vez. Falha na transcrição não impede o envio. */
    if (data.attachmentType === "audio" || data.attachmentType === "video") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { transcribeChatAttachment } = await import("@/lib/chat-audio.server");
      await transcribeChatAttachment(supabaseAdmin as never, {
        messageId: inserted.id as string,
        path: data.path,
        mime: data.mime,
      });
    }

    // If AI is currently handling, pause it — a human is stepping in.
    if (!data.internalNote) {
      await context.supabase
        .from("property_chat_conversations")
        .update({
          last_message_at: new Date().toISOString(),
          ...pausePatch(),
        })
        .eq("id", data.conversationId);
    }

    return { id: inserted.id };
  });
