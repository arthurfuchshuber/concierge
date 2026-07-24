import { createFileRoute } from "@tanstack/react-router";

async function runSync() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { syncPropertyIcal } = await import("@/lib/airbnb-ical.server");
  const { data: props } = await supabaseAdmin
    .from("properties")
    .select("id, airbnb_ical_url")
    .not("airbnb_ical_url", "is", null);
  const list = (props ?? []) as Array<{ id: string; airbnb_ical_url: string }>;

  let ok = 0;
  let fail = 0;
  let imported = 0;
  let updated = 0;
  let removed = 0;
  const results: Array<{ id: string; ok: boolean; error?: string }> = [];

  // Sequential to avoid hammering Airbnb from a single IP.
  for (const p of list) {
    if (!p.airbnb_ical_url) continue;
    const out = await syncPropertyIcal(p.id, p.airbnb_ical_url);
    if (out.ok) {
      ok++;
      imported += out.imported;
      updated += out.updated;
      removed += out.removed;
    } else {
      fail++;
    }
    results.push({ id: p.id, ok: out.ok, error: out.error });
  }
  return { total: list.length, ok, fail, imported, updated, removed, results };
}

export const Route = createFileRoute("/api/public/cron/sync-airbnb-ical")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const out = await runSync();
          return Response.json({ success: true, ...out });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          console.error("cron.sync-airbnb-ical failed:", msg);
          return new Response(JSON.stringify({ success: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
      GET: async () => {
        // Allow manual trigger from browser for testing.
        try {
          const out = await runSync();
          return Response.json({ success: true, ...out });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "unknown";
          return new Response(JSON.stringify({ success: false, error: msg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
