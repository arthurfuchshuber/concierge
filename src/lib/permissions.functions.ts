import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AccessLevel } from "@/lib/permissions/permission.types";

const ContextInput = z.object({
  context: z.enum(["account", "saas"]).default("account"),
});

const SubjectInput = ContextInput.extend({
  targetUserId: z.string().uuid(),
});

const SetInput = SubjectInput.extend({
  slug: z.string().min(1).max(200),
  level: z.enum(["NONE", "READ", "WRITE"]),
});

const CompareInput = ContextInput.extend({
  userA: z.string().uuid(),
  userB: z.string().uuid(),
});

/** Workspace completo: árvore dinâmica + usuários gerenciáveis + plano. */
export const getPermissionWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ContextInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { resolvePermissionWorkspace } = await import("@/lib/permissions/permission.ui.server");
    return resolvePermissionWorkspace({
      kind: data.context,
      supabase: context.supabase,
      userId: context.userId,
    });
  });

/** Permissões gravadas para um usuário na nova estrutura. */
export const getSubjectPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SubjectInput.parse(i))
  .handler(async ({ data, context }) => {
    const { loadSubjectPermissions } = await import("@/lib/permissions/permission.ui.server");
    return loadSubjectPermissions({
      kind: data.context,
      supabase: context.supabase,
      userId: context.userId,
      targetUserId: data.targetUserId,
    });
  });

/** Prévia da remoção em cascata antes de rebaixar um nó para "Sem acesso". */
export const previewPermissionCascade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SubjectInput.extend({ slug: z.string().min(1) }).parse(i))
  .handler(async ({ data, context }) => {
    const { previewSubjectCascade } = await import("@/lib/permissions/permission.ui.server");
    return previewSubjectCascade({
      kind: data.context,
      supabase: context.supabase,
      userId: context.userId,
      targetUserId: data.targetUserId,
      slug: data.slug,
    });
  });

/** Grava um nível de acesso (com herança, cascata e auditoria). */
export const setSubjectPermissionLevel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => SetInput.parse(i))
  .handler(async ({ data, context }) => {
    const { writeSubjectPermission } = await import("@/lib/permissions/permission.ui.server");
    return writeSubjectPermission({
      kind: data.context,
      supabase: context.supabase,
      userId: context.userId,
      targetUserId: data.targetUserId,
      slug: data.slug,
      level: data.level as AccessLevel,
    });
  });

/** Comparação de permissões entre dois usuários (somente leitura). */
export const comparePermissionSubjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CompareInput.parse(i))
  .handler(async ({ data, context }) => {
    const { compareSubjects } = await import("@/lib/permissions/permission.ui.server");
    return compareSubjects({
      kind: data.context,
      supabase: context.supabase,
      userId: context.userId,
      userA: data.userA,
      userB: data.userB,
    });
  });

/** Auditoria das alterações realizadas na nova estrutura. */
export const listPermissionAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => ContextInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { loadAudit } = await import("@/lib/permissions/permission.ui.server");
    return loadAudit({ kind: data.context, supabase: context.supabase, userId: context.userId });
  });
