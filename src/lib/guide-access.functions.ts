import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getRequestHeader } from "@tanstack/react-start/server";

const VehicleSchema = z.object({
  plate: z.string().trim().max(20).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
});

const DocumentSchema = z.object({
  guest_name: z.string().trim().max(200).optional().nullable(),
  file_url: z.string().trim().max(1000).optional().nullable(),
  file_path: z.string().trim().max(500).optional().nullable(),
  doc_type: z.string().trim().max(40).optional().nullable(),
  doc_number: z.string().trim().max(80).optional().nullable(),
  file_name: z.string().trim().max(200).optional().nullable(),
  legible: z.boolean().optional().nullable(),
});

const AccessInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  guest_name: z.string().trim().min(2).max(200),
  reservation_code: z.string().trim().max(100).optional().nullable(),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),

  guest_phone: z.string().trim().max(40).optional().nullable(),
  guest_phone_country: z.string().trim().max(4).optional().nullable(),
  guest_arrival_time: z.string().trim().max(10).optional().nullable(),
  guest_vehicles: z.array(VehicleSchema).max(10).optional().nullable(),
  guest_documents: z.array(DocumentSchema).max(20).optional().nullable(),
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
      checkout_date: data.checkout_date ?? null,
      guest_phone: data.guest_phone?.trim() || null,

      guest_phone_country: data.guest_phone_country?.trim() || null,
      guest_arrival_time: data.guest_arrival_time?.trim() || null,
      guest_vehicles: data.guest_vehicles && data.guest_vehicles.length > 0 ? data.guest_vehicles : null,
      guest_documents: data.guest_documents && data.guest_documents.length > 0 ? data.guest_documents : null,
      user_agent: userAgent,
    } as never);
    if (error) throw (await import("@/lib/db-errors.server")).safeDbError("guide_access_logs", error);

    try {
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

const CheckReservationInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  checkin_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkout_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Public reservation match check for the guest access gate.
 * Returns only booleans + a single hint date — never guest names or codes.
 */
export const checkReservationBySlug = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => CheckReservationInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, airbnb_ical_url")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (!prop) return { hasIcal: false as const, matched: false as const };
    const hasIcal = !!(prop.airbnb_ical_url as string | null);
    if (!hasIcal) return { hasIcal: false as const, matched: false as const };

    const { data: exact } = await supabaseAdmin
      .from("property_reservations")
      .select("id")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .eq("checkout_date", data.checkout_date)
      .limit(1);
    if ((exact ?? []).length > 0) {
      return { hasIcal: true as const, matched: true as const };
    }
    // Loose match: same check-in date, any check-out
    const { data: loose } = await supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date")
      .eq("property_id", prop.id)
      .eq("checkin_date", data.checkin_date)
      .limit(1);
    if ((loose ?? []).length > 0) {
      return {
        hasIcal: true as const,
        matched: false as const,
        looseMatch: true as const,
        suggestedCheckout: (loose![0] as { checkout_date: string }).checkout_date,
      };
    }
    return { hasIcal: true as const, matched: false as const };
  });

const ListReservationsInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
});

/**
 * Public list of upcoming reservation date ranges for a property (by slug).
 * Used by the guest access gate to restrict the calendar to reserved dates.
 * Returns only checkin/checkout dates — no guest names, codes, or URLs.
 */
export const listReservationDatesBySlug = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => ListReservationsInput.parse(i))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prop } = await supabaseAdmin
      .from("properties")
      .select("id, airbnb_ical_url")
      .eq("slug", data.slug)
      .eq("published", true)
      .maybeSingle();
    if (!prop) return { hasIcal: false as const, ranges: [] as Array<{ checkin: string; checkout: string }> };
    const hasIcal = !!(prop.airbnb_ical_url as string | null);
    if (!hasIcal) return { hasIcal: false as const, ranges: [] };

    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await supabaseAdmin
      .from("property_reservations")
      .select("checkin_date, checkout_date")
      .eq("property_id", prop.id)
      .gte("checkout_date", today)
      .order("checkin_date", { ascending: true })
      .limit(200);
    const ranges = (rows ?? []).map((r) => ({
      checkin: (r as { checkin_date: string }).checkin_date,
      checkout: (r as { checkout_date: string }).checkout_date,
    }));
    return { hasIcal: true as const, ranges };
  });


