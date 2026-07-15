import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Members of my account (I'm the owner)
export const listMyTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: members }, { data: invites }] = await Promise.all([
      supabase
        .from("account_members")
        .select("id, member_user_id, role, status, created_at")
        .eq("owner_id", userId)
        .order("created_at", { ascending: true }),
      supabase
        .from("account_member_invites")
        .select("id, email, role, status, expires_at, created_at")
        .eq("owner_id", userId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);
    // Enrich member emails via admin (RLS blocks reading auth.users)
    const ids = (members ?? []).map((m) => m.member_user_id as string);
    let emails: Record<string, { email: string | null; full_name: string | null }> = {};
    if (ids.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      for (const p of profs ?? []) emails[p.id as string] = { email: null, full_name: (p.full_name as string) ?? null };
      // Fetch emails
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      for (const u of users?.users ?? []) {
        if (ids.includes(u.id)) emails[u.id] = { email: u.email ?? null, full_name: emails[u.id]?.full_name ?? null };
      }
    }
    return { members: members ?? [], invites: invites ?? [], profiles: emails };
  });

const InviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  role: z.enum(["owner", "agent", "viewer"]).default("agent"),
});

export const inviteTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InviteInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Check plan limit
    const { resolveUserPlan } = await import("@/lib/plan-guard.server");
    const plan = await resolveUserPlan(supabase, userId);
    if (plan.plan !== "business" && plan.plan !== "enterprise") {
      throw new Error("Convidar atendentes requer plano Business ou Enterprise.");
    }
    if (plan.plan === "business") {
      const { count } = await supabase
        .from("account_members")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .eq("status", "active");
      if ((count ?? 0) >= 2) {
        throw new Error("O plano Business permite até 2 atendentes além do titular. Faça upgrade para o Enterprise.");
      }
    }
    const { data: inserted, error } = await supabase
      .from("account_member_invites")
      .insert({ owner_id: userId, email: data.email, role: data.role, invited_by: userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

const RevokeInput = z.object({ inviteId: z.string().uuid() });

export const revokeTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RevokeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("account_member_invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const MemberOpInput = z.object({ memberId: z.string().uuid() });

export const removeTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MemberOpInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("account_members")
      .update({ status: "revoked" })
      .eq("id", data.memberId)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const UpdateRoleInput = z.object({ memberId: z.string().uuid(), role: z.enum(["owner", "agent", "viewer"]) });

export const updateTeamMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateRoleInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("account_members")
      .update({ role: data.role })
      .eq("id", data.memberId)
      .eq("owner_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
