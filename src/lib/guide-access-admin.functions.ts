import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ListInput = z.object({
  propertyId: z.string().uuid(),
});

const SELECT_FIELDS =
  "id, guest_name, reservation_code, checkin_date, guest_phone, guest_phone_country, guest_arrival_time, guest_vehicles, guest_documents, user_agent, created_at";

export const listGuideAccessLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: prop, error: propErr } = await context.supabase
      .from("properties")
      .select("id, name, owner_id, portaria_email")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (propErr) throw propErr;
    if (!prop || prop.owner_id !== context.userId) {
      throw new Error("not_found");
    }

    const { data: logs, error } = await context.supabase
      .from("guide_access_logs")
      .select(SELECT_FIELDS)
      .eq("property_id", data.propertyId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    return {
      property: {
        id: prop.id,
        name: prop.name as string | null,
        portaria_email: (prop as { portaria_email: string | null }).portaria_email ?? null,
      },
      logs: logs ?? [],
    };
  });

// Lista todos os formulários de acesso preenchidos por hóspedes,
// agregando todas as propriedades do anfitrião (owner) atual.
export const listOwnerGuestForms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: props, error: propErr } = await context.supabase
      .from("properties")
      .select("id, name, portaria_email")
      .eq("owner_id", context.userId);
    if (propErr) throw propErr;
    const propList = props ?? [];
    if (propList.length === 0) return { logs: [], properties: [] };

    const propMap = new Map<string, { name: string | null; portaria_email: string | null }>();
    for (const p of propList) {
      propMap.set(p.id, {
        name: (p as { name: string | null }).name ?? null,
        portaria_email: (p as { portaria_email: string | null }).portaria_email ?? null,
      });
    }

    const { data: logs, error } = await context.supabase
      .from("guide_access_logs")
      .select(`${SELECT_FIELDS}, property_id`)
      .in("property_id", Array.from(propMap.keys()))
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) throw error;

    const enriched = (logs ?? []).map((l) => {
      const p = propMap.get((l as { property_id: string }).property_id);
      return {
        ...(l as Record<string, unknown>),
        property_name: p?.name ?? null,
        portaria_email: p?.portaria_email ?? null,
      };
    });

    return {
      logs: enriched,
      properties: propList.map((p) => ({
        id: p.id,
        name: (p as { name: string | null }).name ?? null,
        portaria_email: (p as { portaria_email: string | null }).portaria_email ?? null,
      })),
    };
  });

const SavePortariaEmail = z.object({
  propertyId: z.string().uuid(),
  email: z.string().trim().email().max(320).or(z.literal("")),
});

export const savePortariaEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SavePortariaEmail.parse(i))
  .handler(async ({ data, context }) => {
    const { data: prop, error: propErr } = await context.supabase
      .from("properties")
      .select("id, owner_id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (propErr) throw propErr;
    if (!prop || prop.owner_id !== context.userId) throw new Error("not_found");

    const { error } = await context.supabase
      .from("properties")
      .update({ portaria_email: data.email ? data.email : null } as never)
      .eq("id", data.propertyId);
    if (error) throw error;
    return { ok: true as const };
  });
