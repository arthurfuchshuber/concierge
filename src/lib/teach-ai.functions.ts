import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const TeachInput = z.object({
  propertyId: z.string().uuid(),
  content: z.string().min(3).max(4000),
  title: z.string().max(160).optional().nullable(),
  scope: z.enum(["current", "global", "select"]),
  propertyIds: z.array(z.string().uuid()).max(200).optional(),
  sourceMessageId: z.string().uuid().optional().nullable(),
});

function deriveTitle(content: string) {
  const t = content.replace(/\s+/g, " ").trim();
  return (t.length > 80 ? t.slice(0, 77) + "…" : t) || "Aprendizado do atendimento";
}

export const teachAiFromMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TeachInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // 1) Verify the caller can access the source property (owner OR active team member).
    const { data: canAccess, error: accessErr } = await supabase.rpc("user_can_access_property", {
      _user_id: userId,
      _property_id: data.propertyId,
    });
    if (accessErr) throw new Error(accessErr.message);
    if (!canAccess) throw new Error("Você não tem acesso a esta propriedade.");

    // 2) Load owner_id of the source property.
    const { data: prop, error: pErr } = await supabase
      .from("properties")
      .select("id, owner_id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prop) throw new Error("Propriedade não encontrada.");
    const ownerId = prop.owner_id as string;

    // 3) Resolve target scope_property_ids
    let targets: Array<string | null> = [];
    if (data.scope === "global") {
      targets = [null];
    } else if (data.scope === "current") {
      targets = [data.propertyId];
    } else {
      const ids = Array.from(new Set((data.propertyIds ?? []).filter(Boolean)));
      if (ids.length === 0) throw new Error("Selecione ao menos um guia.");
      // Verify all requested ids belong to the same owner (via admin, since team member RLS may hide siblings by owner_id filter — but properties RLS grants access to members too).
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: check, error: cErr } = await supabaseAdmin
        .from("properties")
        .select("id")
        .eq("owner_id", ownerId)
        .in("id", ids);
      if (cErr) throw new Error(cErr.message);
      const okIds = new Set((check ?? []).map((r) => r.id as string));
      const bad = ids.filter((id) => !okIds.has(id));
      if (bad.length) throw new Error("Algumas propriedades selecionadas não pertencem à mesma conta.");
      targets = ids;
    }

    // 4) Insert rows via admin (RLS on host_knowledge restricts to owner=auth.uid;
    //    team members are allowed to teach on behalf of the owner after checks above).
    const title = (data.title?.trim() || deriveTitle(data.content)).slice(0, 160);
    const body = data.content.trim();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = targets.map((scope_property_id) => ({
      owner_id: ownerId,
      title,
      body,
      scope_property_id,
      enabled: true,
    }));
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("host_knowledge")
      .insert(rows)
      .select("id");
    if (insErr) throw new Error(insErr.message);

    return { ok: true, inserted: inserted?.length ?? 0 };
  });

// -------- Listar propriedades do dono desta conversa (para seleção múltipla) --------

const ListInput = z.object({ propertyId: z.string().uuid() });

export const listOwnerPropertiesForTeaching = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ListInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: canAccess, error: accessErr } = await supabase.rpc("user_can_access_property", {
      _user_id: userId,
      _property_id: data.propertyId,
    });
    if (accessErr) throw new Error(accessErr.message);
    if (!canAccess) throw new Error("Sem acesso.");

    const { data: prop } = await supabase
      .from("properties")
      .select("owner_id")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (!prop) return { properties: [] };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list, error } = await supabaseAdmin
      .from("properties")
      .select("id, name, city")
      .eq("owner_id", prop.owner_id as string)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { properties: (list ?? []) as Array<{ id: string; name: string; city: string | null }> };
  });
