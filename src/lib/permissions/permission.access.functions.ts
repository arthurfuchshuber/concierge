import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Ponte frontend → Authorization Runtime (FASE 4.1).
 *
 * As decisões vêm EXCLUSIVAMENTE de `permission.guard.server.ts` /
 * `permission.enforce.server.ts`. Nenhuma regra de permissão é reimplementada
 * no cliente: aqui só trafega a decisão já tomada pelo backend.
 */

const ScopeInput = z.object({
  propertyId: z.string().uuid().nullish(),
  clientId: z.string().uuid().nullish(),
  recordId: z.string().nullish(),
});

const CheckInput = ScopeInput.extend({
  permissions: z.array(z.string().min(1).max(200)).min(1).max(80),
  required: z.enum(["NONE", "READ", "WRITE"]).default("READ"),
});

export type ClientAccessDecision = {
  permission: string;
  allowed: boolean;
  reason: string;
  scope: { type: string; id: string | null };
  effective: string;
  required: string;
};

/** Decisões de acesso do usuário autenticado para uma lista de permissões. */
export const getMyAccessDecisions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => CheckInput.parse(i))
  .handler(async ({ data, context }) => {
    const { checkAccess } = await import("@/lib/permissions/permission.enforce.server");
    const { resolveSubjectSnapshot } = await import(
      "@/lib/permissions/permission.resolve.server"
    );

    const snapshot = await resolveSubjectSnapshot(context.userId);
    const scopeCtx = {
      snapshot,
      propertyId: data.propertyId ?? null,
      clientId: data.clientId ?? null,
      recordId: data.recordId ?? null,
      required: data.required,
    };

    const entries = await Promise.all(
      data.permissions.map(async (permission) => {
        const outcome = await checkAccess(context.userId, permission, {
          ...scopeCtx,
          operation: `ui:${permission}`,
        });
        const d = outcome.decision;
        const decision: ClientAccessDecision = {
          permission: d.permission,
          // Enquanto o tenant não estiver em modo bloqueante, a UI segue o
          // comportamento atual (não esconde nada indevidamente).
          allowed: d.allowed || !outcome.enforced,
          reason: d.allowed ? "Acesso permitido." : d.reason,
          scope: { type: d.scope.type, id: d.scope.id ?? null },
          effective: d.effective,
          required: d.required,
        };
        return [permission, decision] as const;
      }),
    );

    return {
      tenantId: snapshot.subject.tenantId,
      decisions: Object.fromEntries(entries) as Record<string, ClientAccessDecision>,
    };
  });
