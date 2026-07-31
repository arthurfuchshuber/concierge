import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  text: z.string().min(1).max(4000),
  targetLang: z.string().min(2).max(10),
});

/**
 * Tradução de mensagens do chat. Pública de propósito: o hóspede (sem login)
 * também precisa ver as mensagens do atendente no idioma dele.
 */
export const translateMessage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Tradução indisponível no momento.");

    const target = data.targetLang.toLowerCase().split(/[-_]/)[0];

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
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
