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
    let accounts: Array<{
      ownerId: string;
      name: string | null;
      email: string | null;
      role: string;
      status: string | null;
    }> = [];

    if (ownerIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: profs }, { data: users }, { data: subs }] = await Promise.all([
        supabaseAdmin.from("profiles").select("id, full_name, trade_name").in("id", ownerIds),
        // fetch emails via admin auth listUsers isn't ideal; use profiles only for name; email optional
        Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> }),
        supabaseAdmin.from("subscriptions").select("user_id, status").in("user_id", ownerIds),
      ]);
      const statusById = new Map<string, string>();
      for (const s of subs ?? []) {
        const current = statusById.get(s.user_id as string);
        const next = (s.status as string) ?? null;
        if (!next) continue;
        // Assinatura ativa/trial sempre prevalece sobre estados encerrados.
        if (!current || next === "active" || next === "trialing") statusById.set(s.user_id as string, next);
      }
      const nameById = new Map<string, string | null>();
      for (const p of profs ?? []) nameById.set(p.id as string, ((p.trade_name as string) || (p.full_name as string)) ?? null);
      const emailById = new Map<string, string | null>();
      for (const u of users) emailById.set(u.id, u.email);
      const roleById = new Map<string, string>();
      for (const m of memberships ?? []) roleById.set(m.owner_id as string, (m.role as string) ?? "collaborator");
      accounts = ownerIds.map((id) => ({
        ownerId: id,
        name: nameById.get(id) ?? null,
        email: emailById.get(id) ?? null,
        role: roleById.get(id) ?? "collaborator",
        status: statusById.get(id) ?? null,
      }));

      // Ordem obrigatória do primeiro acesso: STATUS (ativas primeiro) e,
      // dentro do mesmo status, ordem ALFABÉTICA do nome da conta.
      const rank = (st: string | null) => (st === "active" || st === "trialing" ? 0 : st ? 1 : 2);
      accounts.sort((a, b) => {
        const byStatus = rank(a.status) - rank(b.status);
        if (byStatus !== 0) return byStatus;
        return (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "", "pt-BR");
      });
    }

    return {
      hasOwnProperties: (ownedProps ?? []).length > 0,
      accounts,
    };
  });
