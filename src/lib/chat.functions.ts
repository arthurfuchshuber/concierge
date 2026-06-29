import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(4000),
});

const InputSchema = z.object({
  messages: z.array(MessageSchema).min(1).max(40),
  propertyId: z.string().uuid().optional(),
});

const BASE_PROMPT = `Você é o Concierge IA do SigmaConcierge, assistente para hóspedes de hospedagens.
Estilo: caloroso, conciso (máx 4 frases), português brasileiro por padrão (responda no idioma do hóspede).
Quando indicar lugares, mencione distância e por que vale a pena.
Não invente informações que não foram fornecidas — se não souber, sugira contatar o anfitrião.`;

async function buildPropertyContext(propertyId: string, userId: string): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: prop } = await supabaseAdmin
    .from("properties")
    .select("id, name, owner_id, address, checkin_time, checkout_time, wifi_ssid, host_name, tagline")
    .eq("id", propertyId)
    .maybeSingle();
  if (!prop || prop.owner_id !== userId) return "";

  const [recs, emerg] = await Promise.all([
    supabaseAdmin.from("property_recommendations").select("name, category, distance_text, scope").eq("property_id", propertyId).limit(20),
    supabaseAdmin.from("property_emergency_contacts").select("label, number").eq("property_id", propertyId).limit(10),
  ]);

  const lines: string[] = [`Hospedagem: ${prop.name}`];
  if (prop.tagline) lines.push(prop.tagline);
  if (prop.address) lines.push(`Endereço: ${prop.address}`);
  if (prop.checkin_time) lines.push(`Check-in: ${prop.checkin_time}`);
  if (prop.checkout_time) lines.push(`Check-out: ${prop.checkout_time}`);
  if (prop.wifi_ssid) lines.push(`Wi-Fi (rede): ${prop.wifi_ssid}`);
  if (prop.host_name) lines.push(`Anfitrião: ${prop.host_name}`);
  if (recs.data?.length) {
    lines.push("Recomendações: " + recs.data.map((r) => `${r.name} (${r.category ?? ""}${r.distance_text ? `, ${r.distance_text}` : ""})`).join("; "));
  }
  if (emerg.data?.length) {
    lines.push("Emergência: " + emerg.data.map((e) => `${e.label} ${e.number}`).join(", "));
  }
  return lines.join("\n");
}

export const askConcierge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { assertFeature } = await import("@/lib/plan-guard.server");
    await assertFeature(context.supabase, context.userId, "ai");
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error("LOVABLE_API_KEY não configurada.");
    }


    let systemPrompt = BASE_PROMPT;
    if (data.propertyId) {
      const ctx = await buildPropertyContext(data.propertyId, context.userId);
      if (ctx) systemPrompt = `${BASE_PROMPT}\n\nDados da hospedagem:\n${ctx}`;
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
          { role: "system", content: systemPrompt },
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
