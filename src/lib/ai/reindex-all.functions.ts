import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const reindexAllKnowledge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        onlyPublished: z.boolean().default(true),
        limit: z.number().int().min(1).max(60).default(30),
        offset: z.number().int().min(0).default(0),
      })
      .parse(i ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Apenas administradores podem reindexar a base.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reindexAllProperties } = await import("./reindex-all.server");
    return await reindexAllProperties({
      supabase: supabaseAdmin as never,
      onlyPublished: data.onlyPublished,
      limit: data.limit,
      offset: data.offset,
    });
  });
