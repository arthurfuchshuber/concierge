/**
 * Permission Migration & Activation Control (FASE 3.8).
 *
 * Controla, por tenant, QUAL modelo de autorização vale em runtime.
 * A mudança de modo é SEMPRE explícita e exige um administrador do SaaS —
 * nenhum tenant migra sozinho, nem por efeito colateral de outro fluxo.
 *
 * Modos
 * -----
 *   legacy      → comportamento atual; o novo motor roda apenas para diagnóstico.
 *   monitoring  → novo motor roda e registra divergências; nada é bloqueado.
 *   enforced    → o guard passa a bloquear normalmente.
 *   completed   → migração encerrada; somente o novo fluxo decide.
 */
import type { EnforcementMode } from "./permission.enforce.server";

export type TenantPermissionMode = "legacy" | "monitoring" | "enforced" | "completed";

export type TenantMigrationStatus = {
  tenantId: string;
  status: TenantPermissionMode;
  activatedAt: string | null;
  activatedBy: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export const DEFAULT_MODE: TenantPermissionMode = "legacy";

/** Tradução do modo do tenant para o comportamento do enforcement. */
export function enforcementModeFor(mode: TenantPermissionMode): EnforcementMode {
  return mode === "enforced" || mode === "completed" ? "strict" : "progressive";
}

/** O tenant já decide exclusivamente pelo novo motor? */
export function isNewEngineAuthoritative(mode: TenantPermissionMode): boolean {
  return mode === "enforced" || mode === "completed";
}

/** O tenant deve registrar divergências entre legado e novo motor? */
export function shouldRecordDivergence(mode: TenantPermissionMode): boolean {
  return mode !== "completed";
}

/* ----------------------------------------------------------- cache em memória */

const TTL_MS = 30_000;
const cache = new Map<string, { value: TenantMigrationStatus; at: number }>();

export function invalidateTenantModeCache(tenantId?: string): void {
  if (tenantId) cache.delete(tenantId);
  else cache.clear();
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

type Row = {
  tenant_id: string;
  status: TenantPermissionMode;
  activated_at: string | null;
  activated_by: string | null;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function toStatus(row: Row): TenantMigrationStatus {
  return {
    tenantId: row.tenant_id,
    status: row.status ?? DEFAULT_MODE,
    activatedAt: row.activated_at,
    activatedBy: row.activated_by,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fallback(tenantId: string): TenantMigrationStatus {
  return {
    tenantId,
    status: DEFAULT_MODE,
    activatedAt: null,
    activatedBy: null,
    notes: null,
    createdAt: null,
    updatedAt: null,
  };
}

/* ------------------------------------------------------------------ leitura */

/** Modo vigente do tenant (default seguro: `legacy`). */
export async function getTenantPermissionMode(tenantId: string): Promise<TenantMigrationStatus> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value = fallback(tenantId);
  try {
    const db = await admin();
    const { data } = await db
      .from("permission_migration_status")
      .select("tenant_id,status,activated_at,activated_by,notes,created_at,updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (data) value = toStatus(data as unknown as Row);
  } catch {
    /* qualquer falha mantém o tenant no modo legado (nunca bloqueia) */
  }

  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** Lista completa de status registrados. */
export async function listTenantModes(): Promise<TenantMigrationStatus[]> {
  const db = await admin();
  const { data, error } = await db
    .from("permission_migration_status")
    .select("tenant_id,status,activated_at,activated_by,notes,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Row[]).map(toStatus);
}

/* ----------------------------------------------------- proteção da mudança */

export class MigrationControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationControlError";
  }
}

/** Nenhuma transição acontece sem um administrador do SaaS confirmado. */
export async function assertSaasAdmin(actorId: string | null | undefined): Promise<string> {
  if (!actorId) throw new MigrationControlError("Ação exige um administrador do SaaS autenticado.");
  const db = await admin();
  const { data } = await db
    .from("user_roles")
    .select("user_id")
    .eq("user_id", actorId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) {
    throw new MigrationControlError(
      "Somente administradores do SaaS podem alterar o modo de permissões de uma conta.",
    );
  }
  return actorId;
}

/** Transições válidas — impedem saltos acidentais de modo. */
const ALLOWED: Record<TenantPermissionMode, TenantPermissionMode[]> = {
  legacy: ["monitoring"],
  monitoring: ["legacy", "enforced"],
  enforced: ["monitoring", "completed"],
  completed: ["enforced"],
};

export function canTransition(from: TenantPermissionMode, to: TenantPermissionMode): boolean {
  if (from === to) return true;
  return (ALLOWED[from] ?? []).includes(to);
}

async function setMode(
  tenantId: string,
  actorId: string,
  next: TenantPermissionMode,
  notes?: string,
): Promise<TenantMigrationStatus> {
  await assertSaasAdmin(actorId);
  const current = await getTenantPermissionMode(tenantId);
  if (!canTransition(current.status, next)) {
    throw new MigrationControlError(
      `Transição não permitida: ${current.status} → ${next}. Avance um modo por vez.`,
    );
  }

  const db = await admin();
  const payload = {
    tenant_id: tenantId,
    status: next,
    activated_at: new Date().toISOString(),
    activated_by: actorId,
    notes: notes ?? null,
  };
  const { data, error } = await db
    .from("permission_migration_status")
    .upsert(payload, { onConflict: "tenant_id" })
    .select("tenant_id,status,activated_at,activated_by,notes,created_at,updated_at")
    .single();
  if (error) throw new MigrationControlError(error.message);

  invalidateTenantModeCache(tenantId);
  console.warn(
    `[authz][migration] tenant=${tenantId} ${current.status} → ${next} por admin=${actorId}`,
  );
  return toStatus(data as unknown as Row);
}

/* --------------------------------------------------------------- transições */

/** legacy → monitoring: novo motor observando, sem bloquear. */
export function enableMonitoringMode(tenantId: string, actorId: string, notes?: string) {
  return setMode(tenantId, actorId, "monitoring", notes);
}

/** monitoring → enforced: o guard passa a bloquear. */
export function enableEnforcedMode(tenantId: string, actorId: string, notes?: string) {
  return setMode(tenantId, actorId, "enforced", notes);
}

/** enforced → completed: dependência do fluxo legado encerrada. */
export function completeMigration(tenantId: string, actorId: string, notes?: string) {
  return setMode(tenantId, actorId, "completed", notes);
}

/** Rollback controlado (também exige administrador do SaaS). */
export function rollbackMigration(
  tenantId: string,
  actorId: string,
  to: TenantPermissionMode,
  notes?: string,
) {
  return setMode(tenantId, actorId, to, notes);
}

/* --------------------------------------------------- log de divergências */

export type DivergenceEntry = {
  at: string;
  tenantId: string;
  userId: string;
  mode: TenantPermissionMode;
  operation: string;
  permission: string;
  legacyAllowed: boolean;
  engineAllowed: boolean;
  reason: string;
};

const DIVERGENCE_LIMIT = 300;
const divergences: DivergenceEntry[] = [];

export function recordDivergence(entry: Omit<DivergenceEntry, "at">): void {
  const full: DivergenceEntry = { ...entry, at: new Date().toISOString() };
  divergences.push(full);
  if (divergences.length > DIVERGENCE_LIMIT) divergences.shift();
  console.warn(
    `[authz][migration][divergência] tenant=${entry.tenantId} modo=${entry.mode} ` +
      `usuário=${entry.userId} operação=${entry.operation} permissão=${entry.permission} ` +
      `legado=${entry.legacyAllowed ? "permitido" : "negado"} ` +
      `novo=${entry.engineAllowed ? "permitido" : "negado"} · ${entry.reason}`,
  );
}

export function readDivergences(limit = 50): DivergenceEntry[] {
  return divergences.slice(-limit).reverse();
}

export function clearDivergences(): void {
  divergences.length = 0;
}

export const permissionMigration = {
  getTenantPermissionMode,
  listTenantModes,
  enableMonitoringMode,
  enableEnforcedMode,
  completeMigration,
  rollbackMigration,
  canTransition,
  enforcementModeFor,
  isNewEngineAuthoritative,
  recordDivergence,
  readDivergences,
  clearDivergences,
  invalidateTenantModeCache,
};
