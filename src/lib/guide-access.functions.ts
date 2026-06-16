import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";

const AccessInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  guest_name: z.string().trim().min(2).max(200),
  reservation_code: z.string().trim().min(1).max(100),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const recordGuideAccess = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => AccessInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop, error: propErr } = await supabaseAdmin
      .from("properties")
      .select("id, checkin_time")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (propErr) throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", propErr);
    if (!prop) return { ok: false as const, reason: "not_found" };

    const userAgent = getRequestHeader("user-agent")?.slice(0, 500) ?? null;
    const { error } = await supabaseAdmin.from("guide_access_logs").insert({
      property_id: prop.id,
      guest_name: data.guest_name,
      reservation_code: data.reservation_code,
      checkin_date: data.checkin_date,
      user_agent: userAgent,
    });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", error);
    return { ok: true as const, checkin_time: prop.checkin_time as string | null };
  });
