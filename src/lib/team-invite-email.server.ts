import { sendAppEmail } from "@/lib/email/send-app-email.server";

export function resolveSiteUrl() {
  const siteUrl =
    process.env["SITE_URL"] ||
    process.env["PUBLIC_SITE_URL"] ||
    "https://guia.anfitriaosigma.com.br";
  return siteUrl.replace(/\/$/, "");
}

/**
 * Envia o convite de equipe usando o e-mail branded do app.
 *
 * Não usamos mais o e-mail nativo de convite/magic link do Supabase (sujeito a
 * limites de taxa e sem identidade visual). Geramos apenas o link de ação com
 * a API admin (que NÃO dispara e-mail) e enviamos pela fila do app.
 */
export async function sendBrandedAccountInvite(params: {
  email: string;
  inviterName: string | null;
  accountName?: string | null;
  existingUser: boolean;
  expiresAt?: string | null;
  inviteId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const site = resolveSiteUrl();

  let actionUrl = `${site}/painel`;
  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: params.existingUser ? "magiclink" : "invite",
      email: params.email,
      options: {
        redirectTo: params.existingUser ? `${site}/painel` : `${site}/definir-senha`,
        ...(params.existingUser
          ? {}
          : {
              data: {
                invited_by_name: params.inviterName ?? undefined,
                invite_kind: "account_member",
              },
            }),
      },
    } as never);
    const link = (data as { properties?: { action_link?: string } } | null)?.properties
      ?.action_link;
    if (!error && link) actionUrl = link;
  } catch {
    // Se a geração do link falhar, mantemos o link do painel — a pessoa
    // consegue entrar/recuperar a senha normalmente e aceitar o convite.
  }

  return sendAppEmail({
    templateName: "account-invite",
    recipientEmail: params.email,
    idempotencyKey: params.inviteId
      ? `account-invite-${params.inviteId}-${Date.now()}`
      : undefined,
    templateData: {
      inviterName: params.inviterName,
      accountName: params.accountName ?? params.inviterName,
      recipientEmail: params.email,
      actionUrl,
      existingUser: params.existingUser,
      expiresAt: params.expiresAt ?? null,
      siteUrl: site,
    },
  });
}
