import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AI_MODELS } from "@/lib/ai/models";

const Input = z.object({
  propertyId: z.string().uuid(),
  lang: z.enum(["pt", "en", "es", "fr"]).default("pt"),
  /** Passe de identificação do hóspede (assinado pelo servidor). */
  pass: z.string().max(1000).optional().nullable(),
});

export type DailyTip = {
  greeting: string;
  title: string;
  body: string;
  weather?: { tempC: number; label: string; icon: string } | null;
};

async function fetchWeather(lat: number, lng: number): Promise<DailyTip["weather"]> {
  try {
    const r = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,weather_code&timezone=auto`,
      { signal: AbortSignal.timeout(3500) },
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
    const c = j.current;
    if (!c || typeof c.temperature_2m !== "number") return null;
    const code = c.weather_code ?? 0;
    const map: Record<number, { label: string; icon: string }> = {
      0: { label: "Céu limpo", icon: "☀️" },
      1: { label: "Predominantemente sol", icon: "🌤️" },
      2: { label: "Parcialmente nublado", icon: "⛅" },
      3: { label: "Nublado", icon: "☁️" },
      45: { label: "Neblina", icon: "🌫️" },
      48: { label: "Neblina", icon: "🌫️" },
      51: { label: "Garoa leve", icon: "🌦️" },
      61: { label: "Chuva", icon: "🌧️" },
      63: { label: "Chuva forte", icon: "🌧️" },
      65: { label: "Chuva intensa", icon: "⛈️" },
      71: { label: "Neve", icon: "🌨️" },
      80: { label: "Pancadas de chuva", icon: "🌦️" },
      95: { label: "Tempestade", icon: "⛈️" },
    };
    const m = map[code] ?? { label: "Tempo estável", icon: "🌤️" };
    return { tempC: Math.round(c.temperature_2m), label: m.label, icon: m.icon };
  } catch {
    return null;
  }
}

async function generateWithAi(params: {
  propertyName: string;
  city: string | null;
  country: string | null;
  weather: DailyTip["weather"];
  lang: string;
  date: string;
}): Promise<Omit<DailyTip, "weather">> {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY não configurada");
  const langNames = { pt: "português brasileiro", en: "English", es: "español", fr: "français" } as const;
  const langName = langNames[params.lang as keyof typeof langNames] ?? "português brasileiro";
  const dayOfWeek = new Date(params.date + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long" });
  const hourNow = new Date().getHours();
  const period = hourNow < 12 ? "manhã" : hourNow < 18 ? "tarde" : "noite";

  const weatherLine = params.weather
    ? `Clima agora: ${params.weather.tempC}°C, ${params.weather.label}.`
    : "Sem dados de clima.";

  const sys = `Você é o Concierge IA que escreve UMA dica curta e envolvente para o hóspede abrir o dia. Nunca ultrapasse 2 frases no corpo. Idioma: ${langName}. Tom acolhedor, direto, sem clichê turístico.`;
  const user = `Hospedagem "${params.propertyName}"${params.city ? ` em ${params.city}` : ""}${params.country ? `, ${params.country}` : ""}.
Hoje é ${dayOfWeek}, período: ${period}. ${weatherLine}
Retorne JSON estrito no formato: {"greeting":"...","title":"...","body":"..."}. 
- greeting: 2-4 palavras (ex: "Bom dia!", "Boa tarde por aí?").
- title: manchete curta com no máximo 8 palavras, sugerindo o clima do dia (não repita a temperatura).
- body: 1-2 frases sugerindo o que fazer HOJE dado o clima/período. Se chove: dica indoor/aconchego. Se sol: dica outdoor. Nada genérico como "aproveite sua estadia".`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
    body: JSON.stringify({
      model: AI_MODELS.content,
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
  const parsed = JSON.parse(raw) as { greeting?: string; title?: string; body?: string };
  return {
    greeting: (parsed.greeting ?? "Olá!").slice(0, 60),
    title: (parsed.title ?? "Um bom dia por aí").slice(0, 90),
    body: (parsed.body ?? "").slice(0, 260),
  };
}

export const getDailyTip = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => Input.parse(i))
  .handler(async ({ data }): Promise<DailyTip | null> => {
    /* Rota pública e paga (22/09/2026): só imóvel PUBLICADO gera dica, com
     * freio por IP e teto diário por imóvel — o cache já limita a uma geração
     * por imóvel/dia, e estes limites impedem varredura de ids. */
    const { allowPublicRate, clientIpFrom, allowPaidGuestUse } =
      await import("@/lib/public-rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    if (!allowPublicRate(`daily-tip:${clientIpFrom(getRequest())}`, 20, 60_000)) return null;
    // Só hóspede identificado no guia aciona a IA paga (25/09/2026).
    const { verifyGuestPassInfo } = await import("@/lib/guest-pass.server");
    const passInfo = verifyGuestPassInfo(data.pass, `guide:${data.propertyId}`);
    if (!passInfo) return null;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, name, city, country, lat, lng")
      .eq("id", data.propertyId)
      .eq("published", true)
      .maybeSingle();
    if (!prop) return null;
    if (!prop.city && (prop.lat == null || prop.lng == null)) return null;


    const { propertyTimeZone, todayInTZ } = await import("@/lib/property-timezone");
    const today = todayInTZ(propertyTimeZone(prop.city, prop.country));
    const { data: cached } = await supabaseAdmin
      .from("property_daily_tips")
      .select("content")
      .eq("property_id", data.propertyId)
      .eq("date", today)
      .maybeSingle();
    if (cached?.content) return cached.content as DailyTip;

    // Cache vazio = geração paga: só hóspede com reserva conferida por código
    // aciona a IA. Os demais veem a dica já gerada no dia (quando houver).
    if (!passInfo.verified) return null;
    // Teto diário por imóvel e global.
    if (!allowPaidGuestUse({ scope: "daily-tip", propertyId: prop.id, perProperty: 4, global: 500 })) {
      return null;
    }

    const weather = prop.lat != null && prop.lng != null ? await fetchWeather(Number(prop.lat), Number(prop.lng)) : null;


    let content: DailyTip;
    try {
      const ai = await generateWithAi({
        propertyName: prop.name,
        city: prop.city,
        country: prop.country,
        weather,
        lang: data.lang,
        date: today,
      });
      content = { ...ai, weather };
    } catch {
      return null;
    }

    await supabaseAdmin
      .from("property_daily_tips")
      .upsert({ property_id: data.propertyId, date: today, content }, { onConflict: "property_id,date" });

    return content;
  });
