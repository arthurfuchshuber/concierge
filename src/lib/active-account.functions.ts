import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Returns the accounts the current user has access to as a team member
// (via account_members), plus whether they own any property themselves.
// Used by AdminLayout to auto-select the active company for pure team members.
export const listMyAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [{ data: ownedProps }, { data: memberships }] = await Promise.all([
      supabase.from("properties").select("id").eq("owner_id", userId).limit(1),
      supabase
        .from("account_members")
        .select("owner_id, role, status")
        .eq("member_user_id", userId)
        .eq("status", "active"),
    ]);

    const ownerIds = Array.from(new Set((memberships ?? []).map((m) => m.owner_id as string)));
    let accounts: Array<{ ownerId: string; name: string | null; email: string | null; role: string }> = [];

    if (ownerIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: profs }, { data: users }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, full_name").in("id", ownerIds),
        // fetch emails via admin auth listUsers isn't ideal; use profiles only for name; email optional
        Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> }),
      ]);
      const nameById = new Map<string, string | null>();
      for (const p of profs ?? []) nameById.set(p.id as string, (p.full_name as string) ?? null);
      const emailById = new Map<string, string | null>();
      for (const u of users) emailById.set(u.id, u.email);
      const roleById = new Map<string, string>();
      for (const m of memberships ?? []) roleById.set(m.owner_id as string, (m.role as string) ?? "collaborator");
      accounts = ownerIds.map((id) => ({
        ownerId: id,
        name: nameById.get(id) ?? null,
        email: emailById.get(id) ?? null,
        role: roleById.get(id) ?? "collaborator",
      }));
    }

    return {
      hasOwnProperties: (ownedProps ?? []).length > 0,
      accounts,
    };
  });
