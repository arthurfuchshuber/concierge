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

/**
 * Cria o acesso do stakeholder com SENHA PROVISÓRIA.
 *
 * Em vez de depender da entrega do e-mail de convite, o titular define uma
 * senha provisória na hora. O usuário entra com ela e, no primeiro acesso,
 * o sistema obriga a criação de uma nova senha (flag `must_change_password`).
 */
const ProvisionalInput = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(8).max(72),
  name: z.string().trim().max(200).optional(),
  cpf: z.string().trim().regex(/^\d{11}$/).optional(),
  birth_date: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phone: z.string().trim().max(20).optional(),
});


export const createStakeholderProvisionalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ProvisionalInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { enforce } = await import("@/lib/permissions/permission.enforce.server");
    await enforce(userId, "equipe.write", {});

    const { resolveUserPlan } = await import("@/lib/plan-guard.server");
    const plan = await resolveUserPlan(supabase, userId);
    if (plan.plan !== "business" && plan.plan !== "enterprise") {
      throw new Error("Liberar acesso ao sistema requer plano Business ou Enterprise.");
    }
    if (plan.plan === "business") {
      const { count } = await supabase
        .from("account_members")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", userId)
        .eq("status", "active");
      if ((count ?? 0) >= 2) {
        throw new Error(
          "O plano Business permite até 2 pessoas com acesso além do titular. Faça upgrade para o Enterprise.",
        );
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let memberUserId = await findUserIdByEmail(data.email);
    if (memberUserId) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(memberUserId, {
        password: data.password,
        user_metadata: { must_change_password: true },
      });
      if (error) throw new Error(`Não foi possível definir a senha provisória: ${error.message}`);
    } else {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { must_change_password: true, full_name: data.name ?? null },
      });
      if (error || !created.user) {
        throw new Error(`Não foi possível criar o acesso: ${error?.message ?? "erro desconhecido"}`);
      }
      memberUserId = created.user.id;
    }

    // Perfil já nasce com os dados informados no cadastro do stakeholder —
    // assim o popup "Complete seu cadastro" não pede o que já foi preenchido.
    const profilePatch: Record<string, unknown> = { id: memberUserId };
    if (data.name) profilePatch.full_name = data.name;
    if (data.cpf) profilePatch.cpf = data.cpf;
    if (data.birth_date) profilePatch.birth_date = data.birth_date;
    if (data.phone) profilePatch.phone = data.phone;
    if (Object.keys(profilePatch).length > 1) {
      await supabaseAdmin.from("profiles").upsert(profilePatch as never, { onConflict: "id" });
    }


    const { error: memberError } = await supabaseAdmin
      .from("account_members")
      .upsert(
        {
          owner_id: userId,
          member_user_id: memberUserId,
          role: "agent" as const,
          status: "active" as const,
          invited_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,member_user_id" },
      );
    if (memberError) throw new Error(`Acesso criado, mas o vínculo falhou: ${memberError.message}`);

    // Remove convite pendente antigo para o mesmo e-mail, se existir.
    await supabaseAdmin
      .from("account_member_invites")
      .delete()
      .eq("owner_id", userId)
      .eq("email", data.email)
      .eq("status", "pending");

    return { ok: true, userId: memberUserId };
  });
