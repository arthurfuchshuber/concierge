import { createFileRoute } from "@tanstack/react-router";
import { isAllowedIcalUrl } from "@/lib/airbnb-ical-url";

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length !== bb.length ? 1 : 0;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

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
  let skipped = 0;
  let imported = 0;
  let updated = 0;
  let removed = 0;
  const results: Array<{ id: string; ok: boolean; error?: string; skipped?: boolean }> = [];

  // Sequential to avoid hammering Airbnb from a single IP.
  for (const p of list) {
    if (!p.airbnb_ical_url) continue;
    // SSRF guard: refuse to re-fetch any stored URL that is not on the allowlist.
    if (!isAllowedIcalUrl(p.airbnb_ical_url)) {
      skipped++;
      results.push({ id: p.id, ok: false, skipped: true, error: "URL fora do allowlist" });
      continue;
    }
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
  return { total: list.length, ok, fail, skipped, imported, updated, removed, results };
}

export const Route = createFileRoute("/api/public/cron/sync-airbnb-ical")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-cron-secret") ?? "";
        const expected = process.env.CRON_SECRET ?? "";
        if (!expected || !timingSafeEqualStr(provided, expected)) {
          return new Response("Unauthorized", { status: 401 });
        }
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
    },
  },
});
