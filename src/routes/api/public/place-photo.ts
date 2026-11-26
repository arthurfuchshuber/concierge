import { createFileRoute } from "@tanstack/react-router";
import { tooManyRequests, rateLimitedResponse } from "@/lib/public-rate-limit.server";

// Pixel transparente devolvido quando a foto não vem do Google.
const PIXEL_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

function placeholderResponse() {
  const bin = atob(PIXEL_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      // Cache curto: a foto pode voltar a funcionar logo.
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// Proxy público para fotos do Google Places.
// Mantém a chave do Google no servidor (necessário em domínios custom onde
// a browser key restrita a *.lovable.app não funciona).
export const Route = createFileRoute("/api/public/place-photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (tooManyRequests(request, "place-photo", 60, 60_000)) return rateLimitedResponse();
        const url = new URL(request.url);
        const name = url.searchParams.get("name") ?? "";
        // Largura arredondada para poucos tamanhos fixos: cada foto vira no
        // máximo 4 arquivos no cache, e o Google é chamado no máximo 4 vezes.
        const pedida = Math.max(64, Math.min(2400, Number(url.searchParams.get("w") ?? 1600) || 1600));
        const w = [400, 800, 1600, 2400].find((b) => b >= pedida) ?? 2400;

        // Valida o formato esperado: places/{PLACE_ID}/photos/{PHOTO_RESOURCE}
        if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
          return new Response("Bad photo name", { status: 400 });
        }

        /* Só fotos que o próprio app emitiu (URL assinada pelo servidor) ou que
           já estão salvas em algum guia/recomendação. Pedido arbitrário = pixel. */
        const { isValidPlacePhotoSig } = await import("@/lib/place-photo-sign");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (!isValidPlacePhotoSig(name, url.searchParams.get("sig"))) {
          const { data: known } = await supabaseAdmin.rpc("place_photo_known" as never, {
            _name: name,
          } as never);
          if (known !== true) return placeholderResponse();
        }

        /* CACHE PRÓPRIO (26/11/2026): a foto é baixada do Google uma única vez
           por tamanho e guardada no armazenamento privado do app. Visitantes
           recebem a cópia salva; a cota paga do Google não é gasta de novo. */
        const cacheKey = `${name.replace(/\//g, "_")}_${w}`;
        const cached = await supabaseAdmin.storage.from("place-photo-cache").download(cacheKey);
        if (cached.data && cached.data.size > 0) {
          return imageResponse(cached.data, cached.data.type || "image/jpeg");
        }

        /* TETO DE CONSUMO DO DIA (23/09/2026).
           A rota é aberta (o guia do hóspede não tem login) e cada foto gasta
           cota paga do Google. O limite por minuto segura rajada, mas não
           segurava uso constante o dia inteiro. Passando do teto, devolvemos
           o pixel transparente: a tela do hóspede continua inteira. */
        const { clientIpFrom, allowDailyBudget } = await import("@/lib/public-rate-limit.server");
        const ip = clientIpFrom(request);
        if (
          !allowDailyBudget(`place-photo:ip:${ip}`, 600) ||
          !allowDailyBudget("place-photo:global", 20_000)
        ) {
          return placeholderResponse();
        }


        const apiKey = process.env.LOVABLE_API_KEY;
        const mapsKey =
          process.env.GOOGLE_MAPS_API_KEY_1 ?? process.env.GOOGLE_MAPS_API_KEY_2 ?? process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey || !mapsKey) {
          return new Response("Maps connector not configured", { status: 500 });
        }

        // O Google às vezes devolve 429/5xx num pico de acessos. Em vez de
        // estourar um 502 (que vira erro de rota no app), tentamos de novo e,
        // se ainda assim falhar, devolvemos um pixel transparente: a tela
        // segue inteira, apenas sem a foto.
        let upstream: Response | null = null;
        for (let tentativa = 0; tentativa < 3; tentativa += 1) {
          if (tentativa > 0) await new Promise((r) => setTimeout(r, 250 * tentativa));
          try {
            upstream = await fetch(
              `https://connector-gateway.lovable.dev/google_maps/places/v1/${name}/media?maxWidthPx=${w}`,
              {
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  "X-Connection-Api-Key": mapsKey,
                },
              },
            );
          } catch {
            upstream = null;
          }
          if (upstream?.ok) break;
          if (upstream && upstream.status !== 429 && upstream.status < 500) break;
        }

        const ct = upstream?.headers.get("content-type") ?? "";
        if (!upstream?.ok || !ct.startsWith("image/")) {
          return placeholderResponse();
        }

        const bytes = await upstream.arrayBuffer();
        await supabaseAdmin.storage
          .from("place-photo-cache")
          .upload(cacheKey, bytes, { contentType: ct, upsert: true })
          .catch(() => null);
        return imageResponse(bytes, ct);
      },
    },
  },
});

function imageResponse(body: BodyInit, ct: string) {
        const headers = new Headers();
        headers.set("Content-Type", ct);
        // Aggressive cache: photo resource names are stable/immutable.
        // 24h browser cache, 7d CDN/edge cache.
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
        headers.set("Vary", "Accept-Encoding");
        // Security: prevent the image from being used as a script or iframe
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'");
        return new Response(body, { status: 200, headers });
}
