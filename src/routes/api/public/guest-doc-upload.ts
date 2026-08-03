import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

// Upload de documento pessoal pelo hóspede durante o formulário de primeiro acesso.
// A IA (Gemini vision) faz a checagem de legibilidade e retorna feedback.

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB

const ALLOWED_MIME: Record<string, true> = {
  "image/jpeg": true,
  "image/png": true,
  "image/webp": true,
  "image/heic": true,
  "image/heif": true,
  "application/pdf": true,
};

const Meta = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
});

function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
  };
  return map[mime] ?? "bin";
}

async function checkLegibilityWithGemini(base64: string, mime: string): Promise<{ legible: boolean; reason: string }> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return { legible: true, reason: "" };
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: AI_MODELS.documents,
        messages: [
          {
            role: "system",
            content:
              "Você é um verificador de qualidade de fotos de documentos pessoais (RG, CNH, passaporte, CPF). Responda APENAS em JSON válido no formato {\"legible\": boolean, \"reason\": string}. legible=true somente se: (a) parece um documento pessoal, (b) todos os textos principais estão nítidos e legíveis, (c) sem reflexos ou cortes graves, (d) enquadramento adequado. Em português. reason curto (máx 120 chars).",
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Este documento está legível para envio à portaria?" },
              { type: "image_url", image_url: { url: `data:${mime};base64,${base64}` } },
            ],
          },
        ],
        temperature: 0.1,
      }),
    });
    if (!res.ok) return { legible: true, reason: "" };
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned) as { legible?: boolean; reason?: string };
    return {
      legible: parsed.legible !== false,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 200) : "",
    };
  } catch {
    return { legible: true, reason: "" };
  }
}

export const Route = createFileRoute("/api/public/guest-doc-upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response(JSON.stringify({ error: "invalid_form" }), { status: 400 });
        }
        const parsed = Meta.safeParse({ slug: form.get("slug") });
        if (!parsed.success) {
          return new Response(JSON.stringify({ error: "invalid_meta" }), { status: 400 });
        }
        const file = form.get("file");
        if (!(file instanceof File)) {
          return new Response(JSON.stringify({ error: "no_file" }), { status: 400 });
        }
        if (file.size > MAX_BYTES) {
          return new Response(JSON.stringify({ error: "file_too_large" }), { status: 413 });
        }
        const mime = (file.type || "").toLowerCase();
        if (!ALLOWED_MIME[mime]) {
          return new Response(JSON.stringify({ error: "mime_not_allowed" }), { status: 415 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("id, published")
          .eq("slug", parsed.data.slug)
          .eq("published", true)
          .maybeSingle();
        if (!prop) {
          return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
        }

        const ext = extFromMime(mime);
        const objectId = crypto.randomUUID();
        const path = `${prop.id}/${objectId}.${ext}`;
        const buffer = new Uint8Array(await file.arrayBuffer());
        const { error: upErr } = await supabaseAdmin.storage
          .from("guest-documents")
          .upload(path, buffer, { contentType: mime, upsert: false });
        if (upErr) {
          return new Response(JSON.stringify({ error: "upload_failed" }), { status: 500 });
        }

        // Legibility check apenas para imagens.
        let legibility = { legible: true, reason: "" };
        if (mime.startsWith("image/") && mime !== "image/heic" && mime !== "image/heif") {
          let bin = "";
          const chunk = 0x8000;
          for (let i = 0; i < buffer.length; i += chunk) {
            bin += String.fromCharCode(...buffer.subarray(i, i + chunk));
          }
          const base64 = btoa(bin);
          legibility = await checkLegibilityWithGemini(base64, mime);
        }

        return new Response(
          JSON.stringify({
            path,
            name: file.name ?? null,
            mime,
            size: file.size,
            legible: legibility.legible,
            reason: legibility.reason,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
