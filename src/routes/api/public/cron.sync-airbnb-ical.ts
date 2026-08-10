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
    .select("id, airbnb_ical_url, airbnb_ical_url_2")
    .not("airbnb_ical_url", "is", null);
  const list = (props ?? []) as Array<{ id: string; airbnb_ical_url: string; airbnb_ical_url_2: string | null }>;

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
    const out = await syncPropertyIcal(p.id, p.airbnb_ical_url, 0);
    const url2 = p.airbnb_ical_url_2?.trim();
    if (url2 && isAllowedIcalUrl(url2)) {
      const out2 = await syncPropertyIcal(p.id, url2, 1);
      if (out2.ok) {
        imported += out2.imported;
        updated += out2.updated;
        removed += out2.removed;
      }
    }
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
  const summary = { total: list.length, ok, fail, skipped, imported, updated, removed };
  const { auditCron } = await import("@/lib/ai/audit/platform.server");
  await auditCron("cron_completed", {
    job: "sync-airbnb-ical",
    description: `Sincronização iCal: ${ok} ok, ${fail} falha(s), ${skipped} ignorada(s).`,
    metadata: summary,
    severity: fail > 0 ? "warning" : "info",
    result: fail > 0 ? "failure" : "success",
  });
  return { ...summary, results };
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
