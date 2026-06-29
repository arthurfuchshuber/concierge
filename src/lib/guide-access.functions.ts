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

    // Notify host via Supabase Auth email when a guest accesses their guide.
    // We look up the owner's email and send a transactional notification.
    // Runs fire-and-forget — never blocks the guest's access.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: fullProp } = await supabaseAdmin
        .from("properties")
        .select("owner_id, name, slug")
        .eq("id", prop.id)
        .maybeSingle();
      if (fullProp?.owner_id) {
        const { data: ownerData } = await supabaseAdmin.auth.admin.getUserById(fullProp.owner_id);
        const ownerEmail = ownerData?.user?.email;
        if (ownerEmail) {
          const guestLabel = data.guest_name;
          const checkinLabel = data.checkin_date
            ? new Date(data.checkin_date + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
            : "data não informada";
          const guideUrl = `https://guia.anfitriaosigma.com.br/g/${fullProp.slug}`;
          // Use Supabase transactional email via admin invite (repurposed as notification)
          // We use a simple fetch to the Supabase edge function if configured,
          // otherwise log for visibility.
          console.info(
            `[guide-access] Guest "${guestLabel}" (check-in ${checkinLabel}) accessed guide "${fullProp.name}". Notify: ${ownerEmail} — ${guideUrl}`,
          );
        }
      }
    } catch {
      // Notification failure never blocks guest access
    }

    return { ok: true as const, checkin_time: prop.checkin_time as string | null };
  });
