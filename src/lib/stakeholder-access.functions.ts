import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Acesso ao sistema para stakeholders (proprietários e prestadores).
 *
 * Reaproveita exatamente o fluxo de "membros da equipe": convite pendente,
 * aceite no primeiro acesso e o mesmo painel de permissões por área.
 */

const EmailInput = z.object({ email: z.string().trim().toLowerCase().email().max(200) });

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
  if (error) return null;
  return data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
}

/** Situação de acesso do e-mail dentro da conta atual. */
export const getStakeholderAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EmailInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: invite } = await supabase
      .from("account_member_invites")
      .select("id, status")
      .eq("owner_id", userId)
      .eq("email", data.email)
      .eq("status", "pending")
      .maybeSingle();

    const memberUserId = await findUserIdByEmail(data.email);
    let member: { id: string; status: string } | null = null;
    if (memberUserId) {
      const { data: m } = await supabase
        .from("account_members")
        .select("id, status")
        .eq("owner_id", userId)
        .eq("member_user_id", memberUserId)
        .maybeSingle();
      if (m && (m.status as string) !== "revoked") {
        member = { id: m.id as string, status: m.status as string };
      }
    }

    return {
      status: member ? ("active" as const) : invite ? ("pending" as const) : ("none" as const),
      userId: member ? memberUserId : null,
      memberId: member?.id ?? null,
      inviteId: (invite?.id as string) ?? null,
    };
  });
