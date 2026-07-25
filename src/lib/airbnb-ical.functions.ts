import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { isAllowedIcalUrl } from "@/lib/airbnb-ical-url";

const SyncInput = z.object({
  propertyId: z.string().uuid(),
  icalUrl: z
    .string()
    .trim()
    .url()
    .max(2048)
    .refine(isAllowedIcalUrl, "Use um link iCal oficial do Airbnb (https://...airbnb.*)")
    .optional(),
});

export const syncPropertyAirbnbIcal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SyncInput.parse(input))
  .handler(async ({ data, context }) => {
    // Access check: owner or account member
    const { data: prop, error } = await context.supabase
      .from("properties")
      .select("id, airbnb_ical_url")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (error || !prop) throw new Error("Guia não encontrado ou sem acesso.");

    // Persist the URL the user just pasted if it differs from what's stored,
    // so "Sincronizar" works without waiting for the auto-save round-trip.
    let effectiveUrl = (prop.airbnb_ical_url as string | null) ?? null;
    if (data.icalUrl && data.icalUrl !== effectiveUrl) {
      const { error: upErr } = await context.supabase
        .from("properties")
        .update({ airbnb_ical_url: data.icalUrl })
        .eq("id", data.propertyId);
      if (upErr) throw new Error("Não foi possível salvar o link iCal antes de sincronizar.");
      effectiveUrl = data.icalUrl;
    }

    if (!effectiveUrl) throw new Error("Nenhum link iCal cadastrado neste guia.");
    if (!isAllowedIcalUrl(effectiveUrl)) {
      throw new Error("Link iCal fora da lista permitida. Use um link oficial do Airbnb.");
    }

    const { syncPropertyIcal } = await import("@/lib/airbnb-ical.server");
    const out = await syncPropertyIcal(prop.id, effectiveUrl);
    if (!out.ok) throw new Error(out.error ?? "Falha ao sincronizar.");
    return out;
  });

const ListInput = z.object({ propertyId: z.string().uuid() });

export const listPropertyReservations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListInput.parse(input))
  .handler(async ({ data, context }) => {
    const today = new Date().toISOString().slice(0, 10);
    const { data: rows } = await context.supabase
      .from("property_reservations")
      .select("id, checkin_date, checkout_date, raw_summary, guest_hint, reservation_url, status, synced_at")
      .eq("property_id", data.propertyId)
      .gte("checkout_date", today)
      .order("checkin_date", { ascending: true })
      .limit(50);
    return { reservations: rows ?? [] };
  });
