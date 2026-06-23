import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const EventInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,64}$/),
  section: z.string().min(1).max(40),
  sessionId: z.string().min(8).max(80),
});

export const trackGuideEvent = createServerFn({ method: "POST" })
  .inputValidator((i: unknown) => EventInput.parse(i))
  .handler(async ({ data }) => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select("id")
        .eq("slug", data.slug)
        .eq("published", true)
        .maybeSingle();
      if (!prop) return { ok: false };
      await supabaseAdmin.from("guide_section_events").insert({
        property_id: prop.id,
        section: data.section,
        guest_session_id: data.sessionId,
      }).throwOnError();
    } catch {
      // Analytics failure never surfaces to user
    }
    return { ok: true };
  });
