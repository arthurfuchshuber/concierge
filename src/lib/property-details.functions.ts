import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * "Detalhamento do Imóvel" — base de conhecimento livre da residência.
 * Cada entrada é um bloco independente (texto, transcrição de áudio, imagens)
 * que, somado aos demais, forma uma redação contínua sobre o imóvel.
 */

const PropertyIdInput = z.object({ propertyId: z.string().uuid() });

const SaveInput = z.object({
  id: z.string().uuid().optional().nullable(),
  propertyId: z.string().uuid(),
  title: z.string().trim().max(160).optional().nullable(),
  content: z.string().trim().min(1).max(8000),
  images: z.array(z.string().max(500)).max(8).optional(),
  source: z.enum(["text", "audio"]).optional(),
});

type AnySb = { rpc: (fn: never, args: never) => Promise<{ data: unknown; error: { message: string } | null }> };

async function assertAccess(supabase: unknown, userId: string, propertyId: string) {
  const { data, error } = await (supabase as AnySb).rpc("user_can_access_property" as never, {
    _user_id: userId,
    _property_id: propertyId,
  } as never);
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Você não tem acesso a esta propriedade.");
}

export type PropertyDetail = {
  id: string;
  title: string | null;
  content: string;
  images: string[];
  source: string;
  position: number;
  updated_at: string;
};

export const listPropertyDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => PropertyIdInput.parse(i))
  .handler(async ({ data, context }) => {
    await assertAccess(context.supabase, context.userId, data.propertyId);
    const { data: rows, error } = await context.supabase
      .from("property_details")
      .select("id, title, content, images, source, position, updated_at")
      .eq("property_id", data.propertyId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return {
      details: (rows ?? []).map((r) => ({
        ...r,
        images: Array.isArray(r.images) ? (r.images as string[]) : [],
      })) as PropertyDetail[],
    };
  });

export const savePropertyDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SaveInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAccess(supabase, userId, data.propertyId);

    const { data: prop, error: pErr } = await supabase
      .from("properties")
      .select("id, owner_id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prop) throw new Error("Propriedade não encontrada.");

    const payload = {
      property_id: data.propertyId,
      owner_id: prop.owner_id as string,
      title: data.title?.trim() || null,
      content: data.content.trim(),
      images: data.images ?? [],
      source: data.source ?? "text",
    };

    let id = data.id ?? null;
    if (id) {
      const { error } = await supabase.from("property_details").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { count } = await supabase
        .from("property_details")
        .select("id", { count: "exact", head: true })
        .eq("property_id", data.propertyId);
      const { data: created, error } = await supabase
        .from("property_details")
        .insert({ ...payload, position: count ?? 0 })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      id = created.id as string;
    }

    // Reindexa a base para a IA aprender o novo detalhe imediatamente.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { reindexProperty } = await import("@/lib/ai/indexing.server");
      await reindexProperty(supabaseAdmin, data.propertyId);
    } catch (e) {
      console.error("[property-details] reindex falhou", e);
    }

    return { ok: true, id };
  });

export const deletePropertyDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ id: z.string().uuid(), propertyId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    await assertAccess(context.supabase, context.userId, data.propertyId);
    const { error } = await context.supabase.from("property_details").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { reindexProperty } = await import("@/lib/ai/indexing.server");
      await reindexProperty(supabaseAdmin, data.propertyId);
    } catch (e) {
      console.error("[property-details] reindex falhou", e);
    }
    return { ok: true };
  });

/** Transcreve um áudio gravado pelo usuário (base64) em texto corrido. */
export const transcribeDetailAudio = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        audioBase64: z.string().min(100).max(20_000_000),
        mimeType: z.string().max(120).default("audio/webm"),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    await assertAccess(context.supabase, context.userId, data.propertyId);

    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("IA não configurada.");

    const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
    const ext =
      ({
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/ogg": "ogg",
      } as Record<string, string>)[data.mimeType.split(";")[0]] ?? "webm";

    const form = new FormData();
    form.append("model", "openai/gpt-4o-transcribe");
    form.append("file", new Blob([bytes], { type: data.mimeType }), `detalhe.${ext}`);

    const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[property-details] transcrição falhou", res.status, body.slice(0, 300));
      if (res.status === 429) throw new Error("Muitas requisições. Tente em instantes.");
      if (res.status === 402) throw new Error("Créditos de IA esgotados.");
      throw new Error("Não consegui transcrever o áudio. Tente gravar novamente.");
    }
    const json = (await res.json()) as { text?: string };
    const text = (json.text ?? "").trim();
    if (!text) throw new Error("Não entendi o áudio. Grave novamente, por favor.");
    return { text };
  });
