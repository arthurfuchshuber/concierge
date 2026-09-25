import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

// Idiomas suportados pela UI. Restringir o alvo evita que o endpoint seja
// usado como proxy genérico de LLM com instruções arbitrárias.
const SUPPORTED_LANGS = [
  "pt", "en", "es", "fr", "it", "de", "ru", "ar", "ja", "ko", "zh", "nl", "pl", "tr", "he", "hi",
] as const;

const InputSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  targetLang: z
    .string()
    .min(2)
    .max(10)
    .transform((v) => v.toLowerCase().split(/[-_]/)[0])
    .refine((v): v is (typeof SUPPORTED_LANGS)[number] => (SUPPORTED_LANGS as readonly string[]).includes(v), {
      message: "Idioma não suportado.",
    }),
  /**
   * Contexto do hóspede (sem login): o par slug + sessionId de uma conversa
   * REAL do guia. Sem ele — e sem sessão de usuário — a tradução não roda.
   */
  guest: z
    .object({
      slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
      sessionId: z.string().min(8).max(120),
      /** Passe assinado emitido quando o hóspede se identificou no guia. */
      pass: z.string().max(1000).optional().nullable(),
    })
    .nullable()
    .optional(),
});

/** Sessão autenticada do painel (quem atende), quando houver. */
async function hasStaffSession(): Promise<boolean> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const header = getRequest()?.headers.get("authorization") ?? "";
    if (!header.startsWith("Bearer ")) return false;
    const token = header.slice(7);
    if (!token) return false;
    const { createClient } = await import("@supabase/supabase-js");
    const url = process.env["SUPABASE_URL"];
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
    if (!url || !key) return false;
    const sb = createClient(url, key, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.auth.getClaims(token);
    return !error && !!data?.claims?.sub;
  } catch {
    return false;
  }
}

/** O hóspede precisa ter uma conversa de verdade naquele guia publicado. */
async function isKnownGuest(guest: {
  slug: string;
  sessionId: string;
  pass?: string | null;
}): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("id")
    .eq("slug", guest.slug)
    .eq("published", true)
    .maybeSingle();
  if (!prop) return false;
  // Só hóspede identificado no guia (passe assinado pelo servidor) usa a IA paga.
  const { verifyGuestPassInfo } = await import("@/lib/guest-pass.server");
  const info = verifyGuestPassInfo(guest.pass, `guide:${(prop as { id: string }).id}`);
  if (!info || !info.verified) return false;
  const { data: conv } = await supabaseAdmin
    .from("property_chat_conversations")
    .select("id")
    .eq("property_id", (prop as { id: string }).id)
    .eq("guest_session_id", guest.sessionId)
    .limit(1)
    .maybeSingle();
  return !!conv;
}

/**
 * Tradução de mensagens do chat. Continua acessível ao hóspede anônimo, mas
 * só dentro de uma conversa existente do guia dele — antes qualquer pessoa na
 * internet usava a rota como tradutor de IA de graça (22/09/2026).
 */
export const translateMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    // Endpoint público: sem freio por IP viraria proxy gratuito de LLM.
    const { getRequestIP } = await import("@tanstack/react-start/server");
    const { allowPublicRate, allowPaidGuestUse } = await import("@/lib/public-rate-limit.server");
    let ip = "anon";
    try {
      ip = getRequestIP({ xForwardedFor: true }) ?? "anon";
    } catch {
      ip = "anon";
    }
    if (!allowPublicRate(`translate:${ip}`, 40, 60_000)) {
      throw new Error("Muitas traduções em pouco tempo. Tente novamente em instantes.");
    }

    const staff = await hasStaffSession();
    if (!staff) {
      const guest = data.guest ?? null;
      if (!guest || !(await isKnownGuest(guest))) {
        throw new Error("Tradução indisponível para esta sessão.");
      }
      // Teto do dia também por origem da chamada: sem isto, alguém que copie
      // uma sessão válida do guia usaria a tradução paga o dia inteiro.
      const { allowDailyBudget } = await import("@/lib/public-rate-limit.server");
      if (!allowDailyBudget(`translate:day:${ip}`, 400)) {
        throw new Error("Limite de traduções do dia atingido.");
      }
      if (
        !allowPaidGuestUse({
          scope: "translate",
          propertyId: guest.slug,
          sessionId: guest.sessionId,
          perSession: 120,
          perProperty: 1500,
          global: 8000,
        })
      ) {
        throw new Error("Limite de traduções do dia atingido.");
      }
    }


    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Tradução indisponível no momento.");


    const target = data.targetLang;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: AI_MODELS.translate,
        messages: [
          {
            role: "system",
            content:
              `Você é um tradutor. Traduza a mensagem do usuário para o idioma de código "${target}". ` +
              `Responda APENAS com a tradução, sem aspas, sem explicações, sem comentários. ` +
              `Preserve emojis, links, quebras de linha e formatação markdown. ` +
              `Se o texto já estiver nesse idioma, devolva-o inalterado.`,
          },
          { role: "user", content: data.text },
        ],
      }),
    });

    if (res.status === 429) throw new Error("Muitas traduções em pouco tempo. Tente novamente em instantes.");
    if (res.status === 402) throw new Error("Créditos de IA esgotados.");
    if (!res.ok) {
      console.error("translateMessage gateway error", res.status);
      throw new Error("Não consegui traduzir agora.");
    }

    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const translated = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { translated: translated || data.text, targetLang: target };
  });
