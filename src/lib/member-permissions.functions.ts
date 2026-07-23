import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const MEMBER_PERMISSIONS = [
  "chat_respond",
  "ai_train",
  "library_edit",
  "clients_manage",
  "trial_manage",
  "pricing_override",
] as const;
export type MemberPermission = (typeof MEMBER_PERMISSIONS)[number];

// Defaults mirror the SQL function
const DEFAULTS: Record<MemberPermission, boolean> = {
  chat_respond: true,
  ai_train: true,
  library_edit: true,
  clients_manage: false,
  trial_manage: false,
  pricing_override: false,
};

export const PERMISSION_META: Record<
  MemberPermission,
  { label: string; description: string; group: "operational" | "admin" }
> = {
  chat_respond: {
    label: "Conversar no chat",
    description: "Responder mensagens no chat de atendimento humano.",
    group: "operational",
  },
  ai_train: {
    label: "Ensinar a IA",
    description: "Editar base de conhecimento, FAQs e comportamento da IA.",
    group: "operational",
  },
  library_edit: {
    label: "Alterar biblioteca",
    description: "Editar abas da biblioteca (manual da casa, recomendações etc.).",
    group: "operational",
  },
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
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      for (const p of profs ?? []) profiles[p.id as string] = { email: null, full_name: (p.full_name as string) ?? null };
      const { data: users } = await supabaseAdmin.auth.admin.listUsers({ perPage: 200 });
      for (const u of users?.users ?? []) {
        if (ids.includes(u.id)) profiles[u.id] = { email: u.email ?? null, full_name: profiles[u.id]?.full_name ?? null };
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

    const { error } = await supabase
      .from("account_member_permissions")
      .upsert(
        {
          owner_id: userId,
          member_user_id: data.memberUserId,
          permission: data.permission,
          granted: data.granted,
          updated_by: userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id,member_user_id,permission" },
      );
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
