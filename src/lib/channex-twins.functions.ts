import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function requireAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
  if (!data) throw new Error("Apenas administradores podem unir anúncios.");
}

export const listTwinCandidates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context as never);
    const { listAirbnbListings } = await import("@/lib/channex-twins.server");
    const { listTwinLinks } = await import("@/lib/channex-twins.server");
    const [listings, links] = await Promise.all([listAirbnbListings(), listTwinLinks((context as any).userId)]);
    return { listings, links };
  });

export const linkTwin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ channelId: z.string().uuid(), primaryListingId: z.string().min(1), twinListingId: z.string().min(1) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context as never);
    const { linkTwinListing } = await import("@/lib/channex-twins.server");
    return linkTwinListing({ ...data, userId: (context as any).userId });
  });
