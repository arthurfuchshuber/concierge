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

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // getUserByEmail via listUsers filter (admin API doesn't expose direct lookup)
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (error) return null;
  const found = data.users.find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  return found?.id ?? null;
}

async function sendAccountInviteEmail(email: string, inviterName: string | null) {
  // Sends via Supabase's built-in invite email (routes through our auth webhook
  // and the branded invite.tsx template). Only works for NEW users.
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const siteUrl =
    process.env.SITE_URL ||
    process.env.PUBLIC_SITE_URL ||
    "https://sigmaconcierge.lovable.app";
  const redirectTo = `${siteUrl.replace(/\/$/, "")}/admin/atendimento`;
  const meta = { invited_by_name: inviterName ?? undefined, invite_kind: "account_member" };
  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: meta,
  });
  if (error) throw new Error(error.message);
  return { sent: true, via: "invite" as const };
}


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

    // Look up inviter's name for a nicer email
    const { data: inviter } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();

    // Invites always stay pending until the recipient explicitly accepts via
    // the PendingInviteDialog — even when the e-mail already belongs to a
    // Sigma user. Previously we auto-accepted for existing users, which
    // silently added them to the account without their consent.
    const existingUserId = await findUserIdByEmail(data.email);
    if (existingUserId) {
      return { ok: true, id: inserted.id, emailSent: false, autoAccepted: false, existingUser: true };
    }


    try {
      await sendAccountInviteEmail(data.email, (inviter?.full_name as string) ?? null);
      return { ok: true, id: inserted.id, emailSent: true, autoAccepted: false };
    } catch (e) {
      // Convite ficou registrado mesmo se o envio falhar — o titular pode
      // usar o botão "Reenviar" na lista de convites pendentes.
      return { ok: true, id: inserted.id, emailSent: false, autoAccepted: false, emailError: (e as Error).message };
    }
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

export const resendTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => RevokeInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: inv, error } = await supabase
      .from("account_member_invites")
      .select("id, email, status, expires_at")
      .eq("id", data.inviteId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Convite não encontrado.");
    if (inv.status !== "pending") throw new Error("Este convite não está mais pendente.");
    // Refresh expiration to give the recipient another 7 days
    const newExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("account_member_invites")
      .update({ expires_at: newExpiry })
      .eq("id", inv.id)
      .eq("owner_id", userId);
    const { data: inviter } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    // If the recipient already exists, auto-accept instead of sending email again.
    const existingUserId = await findUserIdByEmail(inv.email as string);
    if (existingUserId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("account_members")
        .upsert(
          { owner_id: userId, member_user_id: existingUserId, role: "agent", status: "active", invited_by: userId },
          { onConflict: "owner_id,member_user_id" },
        );
      await supabaseAdmin
        .from("account_member_invites")
        .update({ status: "accepted", accepted_user_id: existingUserId, accepted_at: new Date().toISOString() })
        .eq("id", inv.id);
      return { ok: true, autoAccepted: true };
    }
    await sendAccountInviteEmail(inv.email as string, (inviter?.full_name as string) ?? null);
    return { ok: true, autoAccepted: false };

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
