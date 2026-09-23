/**
 * Manifesto por guia — o atalho do hóspede abre o guia DELE.
 *
 * O manifesto geral do site (`/manifest.webmanifest`) manda o atalho abrir
 * "/", que é a página inicial do produto. Para quem é hóspede isso está
 * errado: ao reabrir o atalho a pessoa via a página de vendas (com a amostra
 * de um imóvel que não é o dela) em vez do próprio guia. Aqui o endereço de
 * abertura é o guia, e o escopo é limitado a ele.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/g/$slug/app.webmanifest")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slug = String(params.slug ?? "").toLowerCase();
        if (!/^[a-z0-9-]{1,64}$/.test(slug)) {
          return new Response("Not found", { status: 404 });
        }
        const manifest = {
          name: "ConciergeIA",
          short_name: "ConciergeIA",
          description: "Seu guia do hóspede.",
          lang: "pt-BR",
          start_url: `/g/${slug}?app=1`,
          scope: `/g/${slug}`,
          display: "browser",
          background_color: "#0a0908",
          theme_color: "#0a0908",
          icons: [
            { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
            {
              src: "/icon-maskable-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        };
        return new Response(JSON.stringify(manifest), {
          headers: {
            "Content-Type": "application/manifest+json; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });
      },
    },
  },
});
