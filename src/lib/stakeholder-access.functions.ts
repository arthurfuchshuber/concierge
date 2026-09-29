import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Acesso ao sistema para stakeholders (proprietários e prestadores).
 *
 * Reaproveita exatamente o fluxo de "membros da equipe": convite pendente,
 * aceite no primeiro acesso e o mesmo painel de permissões por área.
 */

const EmailInput = z.object({
  accountOwnerId: z.string().uuid().nullish(),
  email: z.string().trim().toLowerCase().email().max(200),
});

/** Traduz a recusa de senha fraca/vazada (checagem de senhas conhecidas). */
function friendlyPasswordError(msg: string | undefined): string | null {
  if (msg && /weak|easy to guess|pwned|leaked|compromised/i.test(msg)) {
    return "Essa senha provisória é muito fraca ou já apareceu em vazamentos de senhas. Use o botão \"Gerar\" ou crie uma com letras maiúsculas, minúsculas, números e símbolo.";
  }
  return null;
}

async function findUserIdByEmail(email: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const found = await (await import("@/lib/admin-users.server")).findAuthUserByEmail(email);
  return found?.id ?? null;
}

/** Situação de acesso do e-mail dentro da conta atual. */
export const getStakeholderAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => EmailInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.accountOwnerId);

    const { data: invite } = await supabase
      .from("account_member_invites")
      .select("id, status")
      .eq("owner_id", ownerId)
      .eq("email", data.email)
      .eq("status", "pending")
      .maybeSingle();

    const memberUserId = await findUserIdByEmail(data.email);
    let member: { id: string; status: string } | null = null;
    if (memberUserId) {
      const { data: m } = await supabase
        .from("account_members")
        .select("id, status")
        .eq("owner_id", ownerId)
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
  accountOwnerId: z.string().uuid().nullish(),
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
    const { resolveAuthorizedAccountOwnerId } = await import("@/lib/account-scope.server");
    const ownerId = await resolveAuthorizedAccountOwnerId(supabase, userId, data.accountOwnerId);
    const { enforce } = await import("@/lib/permissions/permission.enforce.server");
    await enforce(userId, "equipe.write", { tenantId: ownerId });

    const { resolveUserPlan } = await import("@/lib/plan-guard.server");
    const plan = await resolveUserPlan(supabase, ownerId);
    if (plan.plan !== "business" && plan.plan !== "enterprise") {
      throw new Error("Liberar acesso ao sistema requer plano Business ou Enterprise.");
    }
    // Business e Enterprise: pessoas com acesso ilimitadas (pedido 28/09/2026).

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let memberUserId = await findUserIdByEmail(data.email);
    let mode: "created" | "password_changed" | "linked_existing" = "created";
    if (memberUserId) {
      // SEGURANÇA: só é permitido redefinir a senha de quem JÁ pertence a esta
      // conta (membro ou convite pendente). Sem esta trava, informar o e-mail
      // de um usuário de outra empresa sobrescreveria a senha dele — sequestro
      // de conta a partir de um cadastro de stakeholder.
      const [{ data: existingMember }, { data: pendingInvite }] = await Promise.all([
        supabaseAdmin
          .from("account_members")
          .select("id")
          .eq("owner_id", ownerId)
          .eq("member_user_id", memberUserId)
          .maybeSingle(),
        supabaseAdmin
          .from("account_member_invites")
          .select("id")
          .eq("owner_id", ownerId)
          .eq("email", data.email)
          .eq("status", "pending")
          .maybeSingle(),
      ]);
      let belongsElsewhere = false;
      if (!existingMember && !pendingInvite && memberUserId !== userId) {
        // Quem já usa o ConciergeIA em outra empresa (imóveis, assinatura ou
        // equipe) é VINCULADO a esta conta sem trocar a senha pessoal dele.
        const [props, subs, otherTeams] = await Promise.all([
          supabaseAdmin.from("properties").select("id", { count: "exact", head: true }).eq("owner_id", memberUserId),
          supabaseAdmin.from("subscriptions").select("id", { count: "exact", head: true }).eq("user_id", memberUserId),
          supabaseAdmin
            .from("account_members")
            .select("id", { count: "exact", head: true })
            .eq("member_user_id", memberUserId)
            .neq("status", "revoked"),
        ]);
        belongsElsewhere =
          (props.count ?? 0) > 0 || (subs.count ?? 0) > 0 || (otherTeams.count ?? 0) > 0 || !!props.error || !!otherTeams.error;
      }
      if (belongsElsewhere) {
        mode = "linked_existing";
      } else {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(memberUserId, {
          password: data.password,
          email_confirm: true,
          user_metadata: { must_change_password: true },
        });
        if (error) throw new Error(friendlyPasswordError(error.message) ?? `Não foi possível definir a senha provisória: ${error.message}`);
        mode = existingMember ? "password_changed" : "created";
      }
    } else {
      const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
        email: data.email,
        password: data.password,
        email_confirm: true,
        user_metadata: { must_change_password: true, full_name: data.name ?? null },
      });
      if (error || !created.user) {
        throw new Error(friendlyPasswordError(error?.message) ?? `Não foi possível criar o acesso: ${error?.message ?? "erro desconhecido"}`);
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
    if (mode !== "linked_existing" && Object.keys(profilePatch).length > 1) {
      await supabaseAdmin.from("profiles").upsert(profilePatch as never, { onConflict: "id" });
    }


    const { error: memberError } = await supabaseAdmin
      .from("account_members")
      .upsert(
        {
          owner_id: ownerId,
          member_user_id: memberUserId,
          role: "agent" as const,
          status: "active" as const,
          invited_by: userId,
          all_properties: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,member_user_id" },
      );
    if (memberError) throw new Error(`Acesso criado, mas o vínculo falhou: ${memberError.message}`);

    // Primeiro acesso útil: libera visualização das áreas operacionais. O
    // titular ainda pode restringir ou ampliar cada área no painel.
    const now = new Date().toISOString();
    const viewPermissions = ["library_view", "ai_view", "chat_view", "operation_view", "guests_view"] as const;
    const { error: legacyPermissionError } = await supabaseAdmin
      .from("account_member_permissions")
      .upsert(
        viewPermissions.map((permission) => ({
          owner_id: ownerId,
          member_user_id: memberUserId,
          permission,
          granted: true,
          updated_by: userId,
          updated_at: now,
        })),
        { onConflict: "owner_id,member_user_id,permission" },
      );
    if (legacyPermissionError) throw new Error(`Acesso criado, mas as áreas básicas não foram liberadas: ${legacyPermissionError.message}`);

    const { data: nodes, error: nodesError } = await supabaseAdmin
      .from("permission_nodes")
      .select("id, slug")
      .in("slug", ["tenant.dashboard", "tenant.guias", "tenant.stakeholders", "tenant.ia", "tenant.atendimento"]);
    if (nodesError) throw new Error(`Acesso criado, mas as áreas do painel não foram localizadas: ${nodesError.message}`);
    for (const node of nodes ?? []) {
      const { error: assignmentError } = await supabaseAdmin.rpc("replace_permission_assignment", {
        _tenant_id: ownerId,
        _user_id: memberUserId,
        _permission_node_id: node.id,
        _access_level: "READ",
        _scope_type: "TENANT",
        _scope_id: null,
        _created_by: userId,
      });
      if (assignmentError) throw new Error(`Acesso criado, mas uma área do painel não foi liberada: ${assignmentError.message}`);
    }

    // Remove convite pendente antigo para o mesmo e-mail, se existir.
    await supabaseAdmin
      .from("account_member_invites")
      .delete()
      .eq("owner_id", ownerId)
      .eq("email", data.email)
      .eq("status", "pending");

    // REGRA: todo acesso criado/alterado/vinculado é avisado por e-mail.
    let emailSent = false;
    try {
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("full_name, trade_name")
        .eq("id", ownerId)
        .maybeSingle();
      const accountName = ((prof?.trade_name as string) || (prof?.full_name as string)) ?? null;
      const { sendAppEmail } = await import("@/lib/email/send-app-email.server");
      const r = await sendAppEmail({
        templateName: "access-notice",
        recipientEmail: data.email,
        idempotencyKey: `access-${mode}-${memberUserId}-${ownerId}-${Date.now()}`,
        templateData: {
          kind: mode,
          accountName,
          recipientEmail: data.email,
          provisionalPassword: mode === "linked_existing" ? null : data.password,
          actionUrl: "https://conciergeia.app/auth",
        },
      });
      emailSent = r.ok;
    } catch (e) {
      console.error("[access-notice] falha no envio", e instanceof Error ? e.message : e);
    }

    return { ok: true, userId: memberUserId, mode, emailSent };
  });
