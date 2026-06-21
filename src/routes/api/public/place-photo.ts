import { createFileRoute } from "@tanstack/react-router";

// Proxy público para fotos do Google Places.
// Mantém a chave do Google no servidor (necessário em domínios custom onde
// a browser key restrita a *.lovable.app não funciona).
export const Route = createFileRoute("/api/public/place-photo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
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

        const upstream = await fetch(
          `https://connector-gateway.lovable.dev/google_maps/places/v1/${name}/media?maxWidthPx=${w}`,
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "X-Connection-Api-Key": mapsKey,
            },
          },
        );

        if (!upstream.ok || !upstream.body) {
          return new Response("Photo unavailable", { status: 502 });
        }

        const headers = new Headers();
        const ct = upstream.headers.get("content-type") ?? "image/jpeg";
        headers.set("Content-Type", ct);
        // Cache agressivo: a foto referenciada por photoName é imutável.
        headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, immutable");
        return new Response(upstream.body, { status: 200, headers });
      },
    },
  },
});
