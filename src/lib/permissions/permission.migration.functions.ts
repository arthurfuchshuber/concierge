/**
 * Endpoints para o SaaS admin operar, na prática, a máquina de estados já
 * existente em permission.migration.server.ts (FASE 3.8).
 *
 * O motor novo de permissões (permission.engine.ts + permission.enforce.server.ts)
 * já roda em paralelo ao legado, mas nenhuma tela jamais chamava
 * enableMonitoringMode/enableEnforcedMode/completeMigration — toda conta
 * ficava parada para sempre em "legacy" (modo padrão, sem bloqueio real),
 * tornando o motor novo puramente decorativo. Este arquivo expõe, como
 * createServerFn, exatamente as transições que já existiam prontas e
 * protegidas (um passo por vez, admin do SaaS obrigatório, nunca automático)
 * — sem alterar nenhuma regra de negócio da máquina de estados em si.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getTenantMigrationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => z.object({ tenantId: z.string().uuid() }).parse(i))
  .handler(async ({ data, context }) => {
    const { assertSaasAdmin, getTenantPermissionMode, readDivergences } = await import(
      "./permission.migration.server"
    );
    await assertSaasAdmin(context.userId);
    const status = await getTenantPermissionMode(data.tenantId);
    const divergenceCount = readDivergences(300).filter((d) => d.tenantId === data.tenantId).length;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("permission_assignments")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", data.tenantId);
    return { status, divergenceCount, assignmentsCount: count ?? 0 };
  });

const TargetMode = z.enum(["legacy", "monitoring", "enforced", "completed"]);

export const setTenantMigrationMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) =>
    z
      .object({
        tenantId: z.string().uuid(),
        mode: TargetMode,
        notes: z.string().max(500).optional().nullable(),
      })
      .parse(i),
  )
  .handler(async ({ data, context }) => {
    const {
      enableMonitoringMode,
      enableEnforcedMode,
      completeMigration,
      rollbackMigration,
      getTenantPermissionMode,
      MigrationControlError,
    } = await import("./permission.migration.server");
    const notes = data.notes ?? undefined;
    try {
      const current = await getTenantPermissionMode(data.tenantId);
      if (data.mode === "enforced") {
        return await enableEnforcedMode(data.tenantId, context.userId, notes);
      }
      if (data.mode === "completed") {
        return await completeMigration(data.tenantId, context.userId, notes);
      }
      if (data.mode === "monitoring" && current.status === "legacy") {
        return await enableMonitoringMode(data.tenantId, context.userId, notes);
      }
      // legacy, ou monitoring vindo de um modo mais avançado (rollback).
      return await rollbackMigration(data.tenantId, context.userId, data.mode, notes);
    } catch (e) {
      if (e instanceof MigrationControlError) throw new Error(e.message);
      throw e;
    }
  });
