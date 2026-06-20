import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";

const AccessInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  guest_name: z.string().trim().min(2).max(200),
  reservation_code: z.string().trim().max(100).optional().nullable(),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  guest_phone: z.string().trim().max(40).optional().nullable(),
  guest_phone_country: z.string().trim().max(4).optional().nullable(),
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
      reservation_code: data.reservation_code?.trim() || null,
      checkin_date: data.checkin_date,
      guest_phone: data.guest_phone?.trim() || null,
      guest_phone_country: data.guest_phone_country?.trim() || null,
      user_agent: userAgent,
    });
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", error);
    return { ok: true as const, checkin_time: prop.checkin_time as string | null };
  });
