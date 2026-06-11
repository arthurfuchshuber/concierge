import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(4000),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
});

const SYSTEM_PROMPT = `Você é o Concierge IA do SigmaGuide, assistente da hospedagem "Casa da Falésia" em Fernando de Noronha (Praia do Sancho).

Dados úteis:
- Check-in: 15:00 / Check-out: 11:00
- Wi-Fi: rede "CasaDaFalesia_Guest", senha "falesia-2026-vista"
- Senha da fechadura: 1289 — Código do portão: 9931
- Endereço: Rua das Orquídeas, 450 — Praia do Sancho
- Anfitrião: Carlos (+55 11 99999-0000)
- Recomendações: restaurante "Pé de Areia" (frutos do mar, 0.4km), café "Grão & Café" (1.2km), "Mercado da Vila" (0.9km), "Praia do Sancho" (5 min a pé)
- Emergência: Polícia 190, Bombeiros 193, SAMU 192

Estilo: caloroso, conciso (máx 4 frases), português brasileiro por padrão (responda no idioma do hóspede). Quando indicar lugares, mencione distância e por que vale a pena. Não invente informações que não foram fornecidas — se não souber, sugira contatar o anfitrião.`;

export const askConcierge = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY não configurada.");
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...data.messages,
        ],
      }),
    });

    if (res.status === 429) {
      throw new Error("Muitas perguntas em pouco tempo. Tente novamente em instantes.");
    }
    if (res.status === 402) {
      throw new Error("Créditos de IA esgotados. Avise o anfitrião.");
    }
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("AI Gateway error", res.status, errText);
      throw new Error("Não consegui responder agora. Tente de novo.");
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const reply = json.choices?.[0]?.message?.content?.trim() ?? "";
    return { reply };
  });
