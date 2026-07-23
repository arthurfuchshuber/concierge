import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Lists pending team invites addressed to the caller's e-mail.
export const listMyPendingInvites = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const email = ((claims as { email?: string } | null)?.email ?? "").toLowerCase();
    if (!email) return [] as Array<{
      id: string;
      owner_id: string;
      owner_name: string | null;
      owner_email: string | null;
      role: string;
      expires_at: string;
      created_at: string;
    }>;

    const { data, error } = await supabase
      .from("account_member_invites")
      .select("id, owner_id, role, status, expires_at, created_at")
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString());
    if (error) return [];

    const rows = (data ?? []).filter(() => true);
    if (rows.length === 0) return [];

    // Enrich with owner name/email so the popup can show "You were invited by X".
    const ownerIds = Array.from(new Set(rows.map((r) => r.owner_id as string)));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: profs }, { data: users }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, full_name, trade_name").in("id", ownerIds),
      supabaseAdmin.auth.admin.listUsers({ perPage: 200 }),
    ]);
    const nameById = new Map<string, string | null>();
    const emailById = new Map<string, string | null>();
    for (const p of profs ?? []) {
      const label = (p.trade_name as string) || (p.full_name as string) || null;
      nameById.set(p.id as string, label);
    }
    for (const u of users?.users ?? []) {
      if (ownerIds.includes(u.id)) emailById.set(u.id, u.email ?? null);
    }
    void userId;
    return rows.map((r) => ({
      id: r.id as string,
      owner_id: r.owner_id as string,
      owner_name: nameById.get(r.owner_id as string) ?? null,
      owner_email: emailById.get(r.owner_id as string) ?? null,
      role: r.role as string,
      expires_at: r.expires_at as string,
      created_at: r.created_at as string,
    }));
  });

const InviteIdInput = z.object({ inviteId: z.string().uuid() });

export const acceptMyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InviteIdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("accept_my_account_invite", {
      _invite_id: data.inviteId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const declineMyInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => InviteIdInput.parse(i))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("decline_my_account_invite", {
      _invite_id: data.inviteId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
