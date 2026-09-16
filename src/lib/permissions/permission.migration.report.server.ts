/**
 * Relatório de migração de permissões (FASE 3.8).
 *
 * Consolida o estado da ativação por tenant: quem já migrou, quem está
 * pendente, divergências observadas, últimas negativas e riscos.
 * Somente leitura — não altera nenhum modo.
 */
import { readDeniedDecisions } from "./permission.guard.server";
import { readEnforcementLog } from "./permission.enforce.server";
import {
  listTenantModes,
  readDivergences,
  type DivergenceEntry,
  type TenantMigrationStatus,
  type TenantPermissionMode,
} from "./permission.migration.server";

export type MigrationRisk = {
  level: "info" | "warning" | "critical";
  tenantId: string | null;
  message: string;
};

export type MigrationReport = {
  generatedAt: string;
  totals: Record<TenantPermissionMode, number> & { registered: number; pending: number };
  migrated: TenantMigrationStatus[];
  pending: TenantMigrationStatus[];
  modes: Array<{ tenantId: string; mode: TenantPermissionMode; activatedAt: string | null }>;
  divergences: DivergenceEntry[];
  divergenceByTenant: Array<{ tenantId: string; count: number }>;
  lastDenied: ReturnType<typeof readDeniedDecisions>;
  lastBlocked: ReturnType<typeof readEnforcementLog>;
  risks: MigrationRisk[];
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Tenants com atribuições na nova árvore (indício de migração em andamento). */
async function tenantsWithAssignments(): Promise<Set<string>> {
  try {
    const db = await admin();
    const { data } = await db.from("permission_assignments").select("tenant_id").limit(5000);
    return new Set(((data ?? []) as Array<{ tenant_id: string }>).map((r) => r.tenant_id));
  } catch {
    return new Set<string>();
  }
}

export async function buildMigrationReport(): Promise<MigrationReport> {
  const [statuses, withAssignments] = await Promise.all([
    listTenantModes().catch(() => [] as TenantMigrationStatus[]),
    tenantsWithAssignments(),
  ]);

  const totals = {
    legacy: 0,
    monitoring: 0,
    enforced: 0,
    completed: 0,
    registered: statuses.length,
    pending: 0,
  } as MigrationReport["totals"];
  for (const s of statuses) totals[s.status] += 1;

  const migrated = statuses.filter((s) => s.status === "enforced" || s.status === "completed");
  const pending = statuses.filter((s) => s.status === "legacy" || s.status === "monitoring");
  totals.pending = pending.length;

  const divergences = readDivergences(200);
  const counter = new Map<string, number>();
  for (const d of divergences) counter.set(d.tenantId, (counter.get(d.tenantId) ?? 0) + 1);
  const divergenceByTenant = [...counter.entries()]
    .map(([tenantId, count]) => ({ tenantId, count }))
    .sort((a, b) => b.count - a.count);

  /* ------------------------------------------------------------- riscos */
  const risks: MigrationRisk[] = [];
  const registered = new Set(statuses.map((s) => s.tenantId));

  for (const tenantId of withAssignments) {
    if (!registered.has(tenantId)) {
      risks.push({
        level: "warning",
        tenantId,
        message:
          "Conta possui permissões atribuídas na nova árvore, mas não tem modo de migração registrado (permanece em legado).",
      });
    }
  }

  for (const s of migrated) {
    if (!withAssignments.has(s.tenantId)) {
      risks.push({
        level: "critical",
        tenantId: s.tenantId,
        message:
          "Conta em modo bloqueante sem nenhuma permissão atribuída — risco de perda total de acesso para a equipe.",
      });
    }
  }

  for (const { tenantId, count } of divergenceByTenant) {
    const mode = statuses.find((s) => s.tenantId === tenantId)?.status ?? "legacy";
    if (mode === "monitoring" && count > 0) {
      risks.push({
        level: "warning",
        tenantId,
        message: `Conta em monitoramento com ${count} divergência(s): ativar bloqueio agora removeria acessos hoje disponíveis.`,
      });
    }
  }

  if (!statuses.length) {
    risks.push({
      level: "info",
      tenantId: null,
      message: "Nenhuma conta registrada: todo o SaaS segue no comportamento legado.",
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    totals,
    migrated,
    pending,
    modes: statuses.map((s) => ({
      tenantId: s.tenantId,
      mode: s.status,
      activatedAt: s.activatedAt,
    })),
    divergences,
    divergenceByTenant,
    lastDenied: readDeniedDecisions(30),
    lastBlocked: readEnforcementLog(30),
    risks,
  };
}

export const permissionMigrationReport = { buildMigrationReport };
