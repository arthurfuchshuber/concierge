import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Permission Center (FASE 4.2) — ponte frontend → backend.
 *
 * Somente leitura. Toda validação de acesso acontece no servidor, através do
 * Authorization Runtime existente (`permission.guard.server.ts`).
 */

const TargetInput = z.object({ targetUserId: z.string().uuid() });
const OptionalTargetInput = z.object({ targetUserId: z.string().uuid().nullish() });

/** Lista de usuários do contexto com resumo de acesso. */
export const getPermissionCenterOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadCenterOverview } = await import("@/lib/permissions/permission.center.server");
    return loadCenterOverview(context.supabase, context.userId);
  });

/** Detalhe de um usuário: roles → permissions → scopes → imóveis. */
export const getPermissionCenterUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetInput.parse(i))
  .handler(async ({ data, context }) => {
    const { loadCenterUserDetail } = await import("@/lib/permissions/permission.center.server");
    return loadCenterUserDetail(context.supabase, context.userId, data.targetUserId);
  });

/** Catálogo do Permission Registry (namespace, descrição, domínio, status). */
export const getPermissionCenterRegistry = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadCenterRegistry } = await import("@/lib/permissions/permission.center.server");
    return loadCenterRegistry(context.userId);
  });

/** Escopos disponíveis e imóveis vinculados. */
export const getPermissionCenterScopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => OptionalTargetInput.parse(i ?? {}))
  .handler(async ({ data, context }) => {
    const { loadCenterScopes } = await import("@/lib/permissions/permission.center.server");
    return loadCenterScopes(context.supabase, context.userId, data.targetUserId ?? null);
  });

/** Histórico de alterações de permissões do tenant. */
export const getPermissionCenterAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { loadCenterAudit } = await import("@/lib/permissions/permission.center.server");
    return loadCenterAudit(context.supabase, context.userId);
  });

/* ------------------------------------------------------------------------
 * FASE 4.3 — mutações (gestão de atribuições).
 * Toda validação administrativa acontece em permission.enforce.server.ts.
 * ---------------------------------------------------------------------- */

const RoleEnum = z.enum(["owner", "agent", "viewer"]);
const ScopeEnum = z.enum(["GLOBAL", "TENANT", "CLIENT", "PROPERTY", "RECORD"]);

/** Cria o acesso de um novo usuário (convite pendente). */
export const createPermissionCenterUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(200), role: RoleEnum }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.createCenterUser(context.userId, data);
  });

/** Atribui um papel ao usuário. */
export const assignPermissionCenterRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ targetUserId: z.string().uuid(), role: RoleEnum }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.updateCenterUserRole(context.userId, data);
  });

/** Remove o papel do usuário (rebaixa para Visualizador). */
export const removePermissionCenterRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetInput.parse(i))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.removeCenterUserRole(context.userId, data);
  });

/** Ativa ou inativa o usuário. */
export const setPermissionCenterUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ targetUserId: z.string().uuid(), status: z.enum(["active", "revoked"]) }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.setCenterUserStatus(context.userId, data);
  });

/** Remove por completo o acesso do usuário. */
export const removePermissionCenterUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => TargetInput.parse(i))
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.removeCenterUser(context.userId, data);
  });

/** Concede permissão direta. */
export const grantPermissionCenterPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        namespace: z.string().min(1).max(200),
        level: z.enum(["READ", "WRITE"]),
        scopeType: ScopeEnum.default("TENANT"),
        scopeId: z.string().nullish(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.grantCenterPermission(context.userId, data);
  });

/** Remove permissão direta. */
export const revokePermissionCenterPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z.object({ targetUserId: z.string().uuid(), assignmentId: z.string().uuid() }).parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.revokeCenterPermission(context.userId, data);
  });

/** Vincula/desvincula uma residência (escopo PROPERTY). */
export const setPermissionCenterPropertyScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        targetUserId: z.string().uuid(),
        propertyId: z.string().uuid(),
        assigned: z.boolean(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const m = await import("@/lib/permissions/permission.center.mutations.server");
    return m.setCenterPropertyScope(context.userId, data);
  });
