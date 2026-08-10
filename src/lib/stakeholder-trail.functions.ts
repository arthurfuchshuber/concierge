import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Rastro completo do stakeholder (proprietário ou prestador) dentro do sistema.
 *
 * Lê o Enterprise Audit Trail (`ai_system_events`) do usuário vinculado a este
 * cadastro e devolve, em linguagem clara, EXATAMENTE o que a pessoa fez:
 * páginas abertas, cliques, campos preenchidos, envios de formulário,
 * movimentações de cards, comentários, login/logout e erros.
 */

export type StakeholderTrailItem = {
  id: string;
  at: string | null;
  /** Frase pronta, legível, do que aconteceu. */
  title: string;
  /** Categoria legível (Atividade, Autenticação...). */
  badge: string;
  /** Detalhes complementares (página, elemento, resultado). */
  details: string[];
  severity: string;
};

const INPUT = z.object({
  kind: z.enum(["owner", "provider"]),
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
});

const TABLE = { owner: "property_owners", provider: "service_providers" } as const;

const CATEGORY_PT: Record<string, string> = {
  ACTIVITY: "Atividade",
  AUTHENTICATION: "Autenticação",
  PERMISSIONS: "Permissões",
  USER_MANAGEMENT: "Usuários",
  CONVERSATION: "Conversas",
  INTEGRATIONS: "Integrações",
  SECURITY: "Segurança",
  SERVER_CALL: "Ação no sistema",
  ERROR: "Erro",
};

const TYPE_PT: Record<string, string> = {
  page_view: "Abriu uma página",
  click: "Clicou em um elemento",
  field_changed: "Preencheu um campo",
  form_submit: "Enviou um formulário",
  copy: "Copiou conteúdo",
  scroll_depth: "Rolou a página",
  session_start: "Iniciou uma sessão",
  session_end: "Encerrou a sessão",
  tab_hidden: "Saiu da aba",
  tab_visible: "Voltou para a aba",
  login_success: "Entrou no sistema",
  logout: "Saiu do sistema",
  client_error: "Erro no navegador",
  unhandled_rejection: "Erro no navegador",
};

export const getStakeholderSystemTrail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => INPUT.parse(i))
  .handler(async ({ data, context }): Promise<{ items: StakeholderTrailItem[]; linked: boolean }> => {
    const { supabase, userId } = context;

    const { data: row } = await supabase
      .from(TABLE[data.kind])
      .select("email")
      .eq("id", data.id)
      .maybeSingle();

    const email = String((row as { email?: string } | null)?.email ?? "").toLowerCase();
    if (!email) return { items: [], linked: false };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    const personId = users?.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    if (!personId) return { items: [], linked: false };

    // Só devolvemos o rastro de quem é membro desta conta.
    const { data: member } = await supabase
      .from("account_members")
      .select("id")
      .eq("owner_id", userId)
      .eq("member_user_id", personId)
      .maybeSingle();
    if (!member) return { items: [], linked: false };

    const { data: rows } = await supabaseAdmin
      .from("ai_system_events")
      .select(
        "id, created_at, event_type, event_category, description, entity_type, entity_id, metadata, severity, result",
      )
      .or(`user_id.eq.${personId},actor_id.eq.${personId}`)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 300);

    const items: StakeholderTrailItem[] = (rows ?? []).map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const type = String(r.event_type ?? "");
      const title =
        String(r.description ?? "").trim() || TYPE_PT[type] || type.replace(/_/g, " ") || "Ação no sistema";

      const details: string[] = [];
      const page = (meta["page_title"] ?? null) as string | null;
      const path = (meta["path"] ?? null) as string | null;
      if (page) details.push(`Página: ${page}`);
      if (path) details.push(`Rota: ${path}`);
      if (meta["element_label"]) details.push(`Elemento: ${String(meta["element_label"])}`);
      if (Array.isArray(meta["fields"]) && (meta["fields"] as string[]).length > 0) {
        details.push(`Campos: ${(meta["fields"] as string[]).slice(0, 12).join(", ")}`);
      }
      if (r.entity_type && r.entity_id) details.push(`Alvo: ${r.entity_type} · ${r.entity_id}`);
      if (r.result && r.result !== "success") details.push(`Resultado: ${String(r.result)}`);

      return {
        id: String(r.id),
        at: (r.created_at as string) ?? null,
        title,
        badge: CATEGORY_PT[String(r.event_category)] ?? "Atividade",
        details,
        severity: String(r.severity ?? "info"),
      };
    });

    return { items, linked: true };
  });
