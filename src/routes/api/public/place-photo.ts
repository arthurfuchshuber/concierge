import { createFileRoute } from "@tanstack/react-router";
import { tooManyRequests, rateLimitedResponse } from "@/lib/public-rate-limit.server";

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
        const w = Math.max(64, Math.min(2400, Number(url.searchParams.get("w") ?? 1600)));

        // Valida o formato esperado: places/{PLACE_ID}/photos/{PHOTO_RESOURCE}
        if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(name)) {
          return new Response("Bad photo name", { status: 400 });
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        const mapsKey =
          process.env.GOOGLE_MAPS_API_KEY_2 ?? process.env.GOOGLE_MAPS_API_KEY;
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
        if (!upstream?.ok || !upstream.body || !ct.startsWith("image/")) {
          return placeholderResponse();
        }

        const headers = new Headers();
        headers.set("Content-Type", ct);
        // Aggressive cache: photo resource names are stable/immutable.
        // 24h browser cache, 7d CDN/edge cache.
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
        headers.set("Vary", "Accept-Encoding");
        // Security: prevent the image from being used as a script or iframe
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
