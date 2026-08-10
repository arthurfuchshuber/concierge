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
  /** true = movimento relevante (Linha do Tempo); false = micro detalhe (Log). */
  macro: boolean;
};

const INPUT = z.object({
  kind: z.enum(["owner", "provider"]),
  id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).optional(),
});

const TABLE = { owner: "property_owners", provider: "service_providers" } as const;

const CATEGORY_PT: Record<string, string> = {
  ACTIVITY: "Atividade",
  AUTHENTICATION: "Acesso à conta",
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
  click: "Clicou em um botão",
  field_changed: "Preencheu um campo",
  form_submit: "Salvou um formulário",
  copy: "Copiou uma informação",
  scroll_depth: "Rolou a página",
  session_start: "Começou a usar o sistema",
  session_end: "Parou de usar o sistema",
  tab_hidden: "Saiu da tela",
  tab_visible: "Voltou para a tela",
  login_success: "Entrou no sistema",
  logout: "Saiu do sistema",
  client_error: "Ocorreu um erro na tela",
  unhandled_rejection: "Ocorreu um erro na tela",
};

/** Eventos que aparecem na Linha do Tempo (macro). O resto vai para o Log. */
const MACRO_TYPES = new Set([
  "form_submit",
  "note_added",
  "comment_added",
  "login_success",
  "logout",
  "card_moved",
  "status_changed",
  "invite_sent",
  "permission_changed",
  "document_signed",
]);

const PAGE_PT: Array<[RegExp, string]> = [
  [/^\/admin\/dashboard/, "Página Operação"],
  [/^\/admin\/guias?/, "Página Guias"],
  [/^\/admin\/atendimento/, "Central de Atendimento"],
  [/^\/admin\/hospedes/, "Página Hóspedes"],
  [/^\/admin\/engajamento/, "Página Engajamento"],
  [/^\/admin\/administrativo/, "Página Administrativo"],
  [/^\/admin\/permissoes/, "Página Permissões"],
  [/^\/admin\/clientes/, "Página Clientes"],
  [/^\/admin\/ia|^\/admin\/concierge/, "Página IA Concierge"],
  [/^\/admin\/proprietarios/, "Página Proprietários"],
  [/^\/admin\/prestadores/, "Página Prestadores"],
  [/^\/admin\/assinatura/, "Página Assinatura"],
  [/^\/admin\/biblioteca/, "Página Biblioteca"],
  [/^\/admin/, "Área administrativa"],
  [/^\/auth|^\/login/, "Tela de login"],
  [/^\/g\//, "Guia do hóspede"],
  [/^\/$/, "Página inicial"],
];

function friendlyPage(path: string | null, pageTitle: string | null): string | null {
  if (path) {
    const hit = PAGE_PT.find(([re]) => re.test(path));
    if (hit) return hit[1];
  }
  const clean = (pageTitle ?? "").replace(/\s*[—–|-]\s*ConciergeIA\s*$/i, "").trim();
  return clean ? `Página ${clean}` : null;
}

const ENTITY_PT: Record<string, string> = {
  property: "Imóvel",
  properties: "Imóvel",
  guest: "Hóspede",
  conversation: "Conversa",
  reservation: "Reserva",
  property_owner: "Proprietário",
  service_provider: "Prestador",
  account_member: "Membro da equipe",
  document: "Documento",
};

/** Nomes amigáveis para os dados que aparecem nos detalhes das ações. */
const ARG_LABELS: Record<string, string> = {
  id: "Registro",
  name: "Nome",
  title: "Título",
  email: "E-mail",
  slug: "Endereço do guia",
  stage: "Etapa",
  status: "Situação",
  level: "Nível",
  role: "Papel",
  guestName: "Hóspede",
  guest_name: "Hóspede",
  propertyId: "Imóvel",
  property_id: "Imóvel",
  conversationId: "Conversa",
  reservationCode: "Código da reserva",
  reservation_code: "Código da reserva",
  phone: "Telefone",
  date: "Data",
  checkin: "Check-in",
  checkout: "Check-out",
  time: "Horário",
  message: "Mensagem",
  reason: "Motivo",
  category: "Categoria",
  action: "Ação",
};

/** Transforma os argumentos da chamada em frases legíveis ("Hóspede: Ana"). */
function argDetails(meta: Record<string, unknown>): string[] {
  const args = meta["args"];
  if (!args || typeof args !== "object" || Array.isArray(args)) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "" || v === "***") continue;
    if (typeof v === "object") continue;
    const label = ARG_LABELS[k];
    if (!label) continue;
    out.push(`${label}: ${String(v).slice(0, 80)}`);
    if (out.length >= 6) break;
  }
  return out;
}




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
      const pageTitle = (meta["page_title"] ?? null) as string | null;
      const path = (meta["path"] ?? null) as string | null;
      const pageName = friendlyPage(path, pageTitle);
      const label = meta["element_label"] ? String(meta["element_label"]) : null;

      let title = String(r.description ?? "").trim();
      if (!title) {
        if (type === "page_view" && pageName) title = `Abriu a ${pageName.replace(/^Página /, "página ")}`;
        else if (type === "click" && label) title = `Clicou em “${label}”`;
        else title = TYPE_PT[type] || type.replace(/_/g, " ") || "Ação no sistema";
      }

      const details: string[] = [];
      if (pageName) details.push(pageName);
      if (label && !title.includes(label)) details.push(`Botão: ${label}`);
      if (Array.isArray(meta["fields"]) && (meta["fields"] as string[]).length > 0) {
        details.push(`Informações preenchidas: ${(meta["fields"] as string[]).slice(0, 12).join(", ")}`);
      }
      if (r.entity_type) {
        details.push(`Referente a: ${ENTITY_PT[String(r.entity_type)] ?? String(r.entity_type)}`);
      }
      if (r.result && r.result !== "success") details.push("Não foi concluído");

      return {
        id: String(r.id),
        at: (r.created_at as string) ?? null,
        title,
        badge: CATEGORY_PT[String(r.event_category)] ?? "Atividade",
        details,
        severity: String(r.severity ?? "info"),
        macro:
          MACRO_TYPES.has(type) ||
          String(r.event_category) === "PERMISSIONS" ||
          String(r.event_category) === "USER_MANAGEMENT",
      };
    });


    return { items, linked: true };
  });
