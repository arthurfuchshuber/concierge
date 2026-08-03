import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

const Input = z.object({
  cityKey: z.string().min(1),
  cityLabel: z.string().optional(),
  country: z.string().optional(),
  lang: z.enum(["pt", "en", "es", "fr"]).default("pt"),
});

export type PulseItem = {
  title: string;
  category: string;
  detail?: string | null;
  emoji?: string | null;
};

export type CityPulse = {
  items: PulseItem[];
};

async function generateWithAi(params: {
  cityLabel: string;
  country: string | null;
  date: string;
  lang: string;
}): Promise<CityPulse> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY não configurada");
  const langNames = { pt: "português brasileiro", en: "English", es: "español", fr: "français" } as const;
  const langName = langNames[params.lang as keyof typeof langNames] ?? "português brasileiro";
  const dow = new Date(params.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long" });

  const sys = `Você monta um "pulso do dia" para hóspedes de temporada. Idioma: ${langName}. Tom breve, útil, prático. Nunca invente eventos específicos com data, hora ou lugar — fale de padrões típicos, hábitos locais e o que costuma acontecer.`;
  const user = `Cidade: ${params.cityLabel}${params.country ? `, ${params.country}` : ""}. Hoje é ${dow}.
Gere 3 itens curtos que um hóspede pode fazer/saber hoje. Cada item deve ser realista para essa cidade e dia da semana.
Retorne JSON estrito: {"items":[{"title":"...","category":"...","detail":"...","emoji":"..."}]}
- title: máx 8 palavras, direto.
- category: uma palavra (ex: "gastronomia", "cultura", "praia", "vida noturna", "mercado", "natureza").
- detail: 1 frase de 12-20 palavras explicando por que vale hoje.
- emoji: 1 emoji temático.`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: AI_MODELS.cityPulse,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}`);
  const j = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = j.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { items?: PulseItem[] };
  const items = (parsed.items ?? []).slice(0, 4).map((it) => ({
    title: (it.title ?? "").slice(0, 80),
    category: (it.category ?? "dica").slice(0, 30),
    detail: it.detail ? String(it.detail).slice(0, 200) : null,
    emoji: it.emoji ? String(it.emoji).slice(0, 4) : null,
  }));
  return { items };
}

export const getCityPulse = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<CityPulse | null> => {
    if (!data.cityLabel) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date().toISOString().slice(0, 10);

    const { data: cached } = await supabaseAdmin
      .from("city_daily_pulse")
      .select("items")
      .eq("city_key", data.cityKey)
      .eq("date", today)
      .maybeSingle();
    if (cached?.items) return { items: cached.items as PulseItem[] };

    let content: CityPulse;
    try {
      content = await generateWithAi({
        cityLabel: data.cityLabel,
        country: data.country ?? null,
        date: today,
        lang: data.lang,
      });
    } catch {
      return null;
    }
    if (content.items.length === 0) return null;

    await supabaseAdmin
      .from("city_daily_pulse")
      .upsert(
        { city_key: data.cityKey, date: today, items: content.items },
        { onConflict: "city_key,date" },
      );
    return content;
  });
