import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ListInput = z.object({
  propertyId: z.string().uuid(),
});

export const listGuideAccessLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    const { data: prop, error: propErr } = await context.supabase
      .from("properties")
      .select("id, name, owner_id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (propErr) throw propErr;
    if (!prop || prop.owner_id !== context.userId) {
      throw new Error("not_found");
    }

    const { data: logs, error } = await context.supabase
      .from("guide_access_logs")
      .select("id, guest_name, reservation_code, checkin_date, guest_phone, guest_phone_country, user_agent, created_at")
      .eq("property_id", data.propertyId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    return {
      property: { id: prop.id, name: prop.name as string | null },
      logs: logs ?? [],
    };
  });
