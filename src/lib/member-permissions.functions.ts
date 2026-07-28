import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { PlanFeatures } from "@/lib/payments.shared";

export const MEMBER_PERMISSIONS = [
  "library_view",
  "library_edit",
  "ai_view",
  "ai_train",
  "chat_view",
  "chat_respond",
  "operation_view",
  "operation_edit",
  "guests_view",
  "guests_edit",
  "clients_manage",
  "trial_manage",
  "pricing_override",
] as const;
export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number];

// Defaults mirror the SQL function `has_member_permission`.
// New members entram com tudo em VIEW e nada em EDIT.
const DEFAULTS: Record<MemberPermission, boolean> = {
  library_view: true,
  library_edit: false,
  ai_view: true,
  ai_train: false,
  chat_view: true,
  chat_respond: false,
  operation_view: true,
  operation_edit: false,
  guests_view: true,
  guests_edit: false,
  clients_manage: false,
  trial_manage: false,
  pricing_override: false,
};

export type PermissionArea = "library" | "ai" | "chat" | "operation" | "guests";

export const PERMISSION_AREAS: {
  area: PermissionArea;
  label: string;
  description: string;
  view: MemberPermission;
  edit: MemberPermission;
  editLabel: string;
}[] = [
  {
    area: "library",
    label: "Biblioteca & Guias",
    description: "Imóveis, manual da casa, recomendações, FAQs e checkout.",
    view: "library_view",
    edit: "library_edit",
    editLabel: "Criar e editar",
  },
  {
    area: "ai",
    label: "IA",
    description: "Comportamento, base de conhecimento e feedback de mensagens.",
    view: "ai_view",
    edit: "ai_train",
    editLabel: "Treinar e editar",
  },
  {
    area: "chat",
    label: "Atendimento",
    description: "Conversas com hóspedes no atendimento humano.",
    view: "chat_view",
    edit: "chat_respond",
    editLabel: "Assumir e responder",
  },
  {
    area: "operation",
    label: "Operação (Kanban)",
    description: "Dashboard, KPIs e cards de check-in, check-out e limpeza.",
    view: "operation_view",
    edit: "operation_edit",
    editLabel: "Marcar checks e editar horários",
  },
  {
    area: "guests",
    label: "Hóspedes",
    description: "Lista de hóspedes e dados coletados no primeiro acesso.",
    view: "guests_view",
    edit: "guests_edit",
    editLabel: "Editar e exportar",
  },
];

export const PERMISSION_META: Record<
  MemberPermission,
  { label: string; description: string; group: "operational" | "admin" }
> = {
  library_view: {
    label: "Ver biblioteca",
    description: "Ver guias, manual, recomendações, FAQs.",
    group: "operational",
  },
  library_edit: { label: "Editar biblioteca", description: "Criar/editar guias e conteúdo.", group: "operational" },
  ai_view: { label: "Ver IA", description: "Consultar base de conhecimento e comportamento.", group: "operational" },
  ai_train: { label: "Treinar IA", description: "Editar base, FAQs e comportamento.", group: "operational" },
  chat_view: { label: "Ver chat", description: "Ver conversas e histórico.", group: "operational" },
  chat_respond: {
    label: "Responder no chat",
    description: "Assumir e responder no atendimento humano.",
    group: "operational",
  },
  operation_view: { label: "Ver operação", description: "Ver dashboard, KPIs e Kanban.", group: "operational" },
  operation_edit: {
    label: "Agir na operação",
    description: "Marcar check-in/out/limpeza e editar horários.",
    group: "operational",
  },
  guests_view: { label: "Ver hóspedes", description: "Ver lista de hóspedes e captação.", group: "operational" },
  guests_edit: { label: "Editar hóspedes", description: "Editar e exportar dados de captação.", group: "operational" },
  clients_manage: {
    label: "Gerenciar clientes",
    description: "Alterar planos e informações de clientes.",
    group: "admin",
  },
  trial_manage: {
    label: "Alterar trial",
    description: "Alterar o período de trial free dos clientes.",
    group: "admin",
  },
  pricing_override: {
    label: "Personalizar recorrência",
    description: "Personalizar o valor da recorrência.",
    group: "admin",
  },
};

/**
 * Mapa permissão → feature do plano. Quando a feature não está presente no
 * plano do dono, o toggle é ocultado/desabilitado e o servidor recusa gravar.
 * Permissões sem mapeamento (null) são liberadas em qualquer plano.
 */
export const PERMISSION_FEATURE: Record<MemberPermission, keyof PlanFeatures | null> = {
  library_view: null,
  library_edit: null,
  ai_view: "ai",
  ai_train: "ai",
  chat_view: "humanHandoff",
  chat_respond: "humanHandoff",
  operation_view: null,
  operation_edit: null,
  guests_view: null,
  guests_edit: null,
  clients_manage: null,
  trial_manage: null,
  pricing_override: null,
};

// Owner lists team members + full permission matrix
export const listMemberPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: members } = await supabase
      .from("account_members")
      .select("id, member_user_id, role, status, created_at")
      .eq("owner_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    const { data: rows } = await supabase
      .from("account_member_permissions")
      .select("member_user_id, permission, granted")
      .eq("owner_id", userId);

    const ids = (members ?? []).map((m) => m.member_user_id as string);
    let profiles: Record<string, { email: string | null; full_name: string | null }> = {};
    if (ids.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", ids);
      for (const p of profs ?? [])
        profiles[p.id as string] = { email: null, full_name: (p.full_name as string) ?? null };
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      for (const u of users?.users ?? []) {
        if (ids.includes(u.id))
          profiles[u.id] = { email: u.email ?? null, full_name: profiles[u.id]?.full_name ?? null };
      }
    }

    // Build matrix keyed by member -> permission -> boolean
    const matrix: Record<string, Record<MemberPermission, boolean>> = {};
    for (const id of ids) {
      matrix[id] = { ...DEFAULTS };
    }
    for (const r of rows ?? []) {
      const mid = r.member_user_id as string;
      const perm = r.permission as MemberPermission;
      if (!matrix[mid]) matrix[mid] = { ...DEFAULTS };
      matrix[mid][perm] = !!r.granted;
    }

    return { members: members ?? [], profiles, matrix, defaults: DEFAULTS };
  });

const UpdateInput = z.object({
  memberUserId: z.string().uuid(),
  permission: z.enum(MEMBER_PERMISSIONS),
  granted: z.boolean(),
});

export const updateMemberPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Ensure the target is actually a member of this account
    const { data: m } = await supabase
      .from("account_members")
      .select("id")
      .eq("owner_id", userId)
      .eq("member_user_id", data.memberUserId)
      .eq("status", "active")
      .maybeSingle();
    if (!m) throw new Error("Membro não encontrado nesta conta.");

    // Trava por plano: só permite ligar a permissão se a feature correspondente
    // estiver liberada no plano do dono. Desligar é sempre permitido.
    const requiredFeature = PERMISSION_FEATURE[data.permission];
    if (data.granted && requiredFeature) {
      const { resolveUserPlan } = await import("@/lib/plan-guard.server");
      const plan = await resolveUserPlan(supabase, userId);
      if (!plan.features[requiredFeature]) {
        throw new Error("Esta permissão não está disponível no seu plano atual.");
      }
    }

    // Cascata view↔edit: ligar EDIT liga o VIEW correspondente;
    // desligar VIEW desliga o EDIT correspondente. Mantém coerência.
    const area = PERMISSION_AREAS.find((a) => a.view === data.permission || a.edit === data.permission);
    const rowsToUpsert: {
      owner_id: string;
      member_user_id: string;
      permission: MemberPermission;
      granted: boolean;
      updated_by: string;
      updated_at: string;
    }[] = [
      {
        owner_id: userId,
        member_user_id: data.memberUserId,
        permission: data.permission,
        granted: data.granted,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
    ];
    if (area) {
      if (data.permission === area.edit && data.granted) {
        rowsToUpsert.push({
          owner_id: userId,
          member_user_id: data.memberUserId,
          permission: area.view,
          granted: true,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
      } else if (data.permission === area.view && !data.granted) {
        rowsToUpsert.push({
          owner_id: userId,
          member_user_id: data.memberUserId,
          permission: area.edit,
          granted: false,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        });
      }
    }

    const { error } = await supabase
      .from("account_member_permissions")
      .upsert(rowsToUpsert, { onConflict: "owner_id,member_user_id,permission" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Any signed-in user: what can I do inside a given account?
const MyPermsInput = z.object({ ownerId: z.string().uuid() });

export const getMyPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => MyPermsInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.ownerId === userId) {
      const all: Record<MemberPermission, boolean> = { ...DEFAULTS };
      for (const p of MEMBER_PERMISSIONS) all[p] = true;
      return { isOwner: true, permissions: all };
    }
    const { data: rows } = await supabase
      .from("account_member_permissions")
      .select("permission, granted")
      .eq("owner_id", data.ownerId)
      .eq("member_user_id", userId);
    const perms: Record<MemberPermission, boolean> = { ...DEFAULTS };
    for (const r of rows ?? []) perms[r.permission as MemberPermission] = !!r.granted;
    return { isOwner: false, permissions: perms };
  });
