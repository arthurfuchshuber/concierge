import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireMemberPermission } from "@/lib/member-permissions.server";
import { z } from "zod";


const BehaviorInput = z.object({
  id: z.string().uuid().optional().nullable(),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  enabled: z.boolean().default(true),
  scope_property_id: z.string().uuid().nullable().optional(),
});

export const listHostBehavior = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("host_behavior")
      .select("id, title, body, enabled, source, source_property_id, scope_property_id, position, created_at, updated_at")
      .order("position", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveHostBehavior = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ items: z.array(BehaviorInput).max(50).default([]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Replace-all keeps editor simple while preserving non-manual entries' source meta via re-insert
    const { error: delErr } = await supabase.from("host_behavior").delete().eq("owner_id", userId);
    if (delErr) throw new Error(delErr.message);
    if (!data.items.length) return { saved: 0 };
    const rows = data.items.map((it, i) => ({
      owner_id: userId,
      title: it.title,
      body: it.body,
      enabled: it.enabled,
      source: "manual",
      position: i,
      scope_property_id: it.scope_property_id ?? null,
    }));
    const { error, data: inserted } = await supabase.from("host_behavior").insert(rows).select("id");
    if (error) throw new Error(error.message);
    return { saved: inserted?.length ?? 0 };
  });
