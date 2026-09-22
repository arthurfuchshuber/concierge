import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Transcrição do áudio do hóspede (pedido explícito, 07/09/2026).
 *
 * Antes disso o hóspede só conseguia gravar áudio depois de cair no atendimento
 * humano, e mesmo aí o áudio virava um anexo que a IA nunca ouvia — ela recebia
 * uma mensagem de conteúdo vazio. Falar com a IA simplesmente não funcionava.
 *
 * Aqui o áudio vira texto e o guia manda esse texto pelo fluxo normal de
 * mensagem. A IA responde com o mesmo contexto de sempre (reserva, imóvel,
 * fase da estadia) sem saber que veio de voz — que é justamente o ponto: falar
 * passa a valer o mesmo que digitar.
 *
 * Rota pública, como o resto do guia: a porta de entrada é o par slug +
 * sessionId, e o tamanho é limitado para o endpoint não virar um conversor de
 * áudio de graça para quem descobrir a URL.
 */
const Body = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  sessionId: z.string().min(8).max(80),
  audioBase64: z.string().min(100).max(8_000_000),
  mimeType: z.string().max(120).default("audio/webm"),
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/guide-transcribe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Transcrição é paga e a rota é pública (o slug está no sitemap): sem
        // limite, virava um conversor de áudio de graça (16/09/2026).
        const { tooManyRequests, rateLimitedResponse } =
          await import("@/lib/public-rate-limit.server");
        if (tooManyRequests(request, "guide-transcribe", 10, 60_000)) return rateLimitedResponse();
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return json({ error: "Entrada inválida." }, 400);
        }

        // O slug precisa existir e estar publicado — mesma porta do chat.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: prop } = await supabaseAdmin
          .from("properties")
          .select("id, access_mode, pin_code")
          .eq("slug", body.slug)
          .eq("published", true)
          .maybeSingle();
        if (!prop) return json({ error: "Guia não encontrado." }, 404);

        // Guia protegido por PIN: só transcreve quem já provou o PIN (cookie
        // assinado), exatamente como o chat faz.
        const p = prop as { id: string; access_mode?: string | null; pin_code?: string | null };
        if (p.access_mode === "pin") {
          const { getCookie } = await import("@tanstack/react-start/server");
          const guestAccess = await import("@/lib/guest-access.server");
          const ok = await guestAccess.verifyPinCookie(
            "pin",
            p.id,
            p.pin_code ?? null,
            getCookie(guestAccess.pinCookieName("pin", p.id)) ?? null,
          );
          if (!ok) return json({ error: "Acesso bloqueado." }, 403);
        }

        // Teto de custo do dia: por sessão do hóspede, por imóvel e global.
        const { allowPaidGuestUse } = await import("@/lib/public-rate-limit.server");
        if (
          !allowPaidGuestUse({
            scope: "guide-transcribe",
            propertyId: p.id,
            sessionId: body.sessionId,
            perSession: 40,
            perProperty: 300,
            global: 2000,
          })
        ) {
          return json({ error: "Limite de transcrições atingido por hoje." }, 429);
        }


        try {
          const { transcribeAudioBase64 } = await import("@/lib/ai/transcribe.server");
          const text = await transcribeAudioBase64(body.audioBase64, body.mimeType);
          return json({ text });
        } catch (err) {
          console.error("[guide-transcribe]", err);
          return json(
            { error: err instanceof Error ? err.message : "Não consegui transcrever o áudio." },
            502,
          );
        }
      },
    },
  },
});
