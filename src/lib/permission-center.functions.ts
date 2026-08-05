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
