import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const BASE_URL = "https://guia.anfitriaosigma.com.br";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: guides } = await supabaseAdmin
          .from("properties")
          .select("slug, updated_at")
          .eq("published", true)
          .eq("access_mode", "public")
          .order("updated_at", { ascending: false })
          .limit(500);

        const entries: SitemapEntry[] = [
          { path: "/", changefreq: "weekly", priority: "1.0" },
          { path: "/precos", changefreq: "monthly", priority: "0.9" },
          { path: "/confianca", changefreq: "monthly", priority: "0.6" },
          { path: "/privacidade", changefreq: "yearly", priority: "0.3" },
          { path: "/termos", changefreq: "yearly", priority: "0.3" },
          { path: "/reembolso", changefreq: "yearly", priority: "0.3" },
        ];

        const guideEntries: SitemapEntry[] = (guides ?? []).map((g) => ({
          path: `/g/${g.slug}`,
          changefreq: "weekly" as const,
          priority: "0.7",
          lastmod: g.updated_at ? new Date(g.updated_at).toISOString().split("T")[0] : undefined,
        }));

        const allEntries = [...entries, ...guideEntries];

        const urls = allEntries.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            (e as any).lastmod ? `    <lastmod>${(e as any).lastmod}</lastmod>` : null,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
