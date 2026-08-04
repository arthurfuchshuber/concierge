/**
 * Permission Sync — rotina OFICIAL de sincronização do Registry com o banco.
 *
 * FASE 3.5. Substitui o "lazy sync" implícito. Características:
 *  - executa em ondas por profundidade (pai sempre antes do filho);
 *  - registra cada execução em `permission_sync_runs`;
 *  - aplica SOFT DELETE (`active = false`, `deactivated_at`) — nada é apagado;
 *  - preserva permissões existentes ao renomear slugs, migrando o nó antigo
 *    e registrando a mudança em `permission_node_slug_history`;
 *  - nunca lança para o chamador: devolve um relatório com os erros.
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { permissionRegistry, runAutoDiscovery } from "./permission.registry";
import type { PermissionNodeDefinition } from "./permission.types";

export type SyncReport = {
  runId: string | null;
  status: "success" | "partial" | "failed";
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  renamed: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function rowFromDefinition(
  def: PermissionNodeDefinition,
  parentId: string | null,
  syncedAt: string,
) {
  return {
    slug: def.slug,
    name: def.name,
    type: def.type,
    description: def.description ?? null,
    order: def.order ?? 0,
    active: def.active ?? true,
    parent_id: parentId,
    label: def.label ?? def.name,
    route: def.route ?? null,
    icon: def.icon ?? null,
    display_order: def.displayOrder ?? def.order ?? 0,
    is_system: def.isSystem ?? true,
    is_hidden: def.isHidden ?? false,
    is_permissionable: def.isPermissionable ?? true,
    version: def.version ?? 1,
    deprecated: def.deprecated ?? false,
    source: def.source ?? "manual",
    feature: def.feature ?? null,
    max_access_level: def.maxAccessLevel ?? "WRITE",
    deactivated_at: null,
    last_synced_at: syncedAt,
  };
}

/**
 * Migra um nó legado para o slug canônico, sem perder as permissões já
 * atribuídas: o registro antigo é renomeado (mantendo o mesmo `id`).
 */
async function migrateLegacySlugs(
  defs: PermissionNodeDefinition[],
  existing: Map<string, { id: string }>,
  errors: string[],
): Promise<number> {
  const db = await admin();
  let renamed = 0;

  for (const def of defs) {
    const legacy = (def.legacySlugs ?? []).filter((s) => s && s !== def.slug);
    if (!legacy.length) continue;

    for (const oldSlug of legacy) {
      const oldRow = existing.get(oldSlug);
      if (!oldRow) continue;
      if (existing.has(def.slug)) continue; // canônico já existe: nada a migrar

      const { error } = await db
        .from("permission_nodes")
        .update({ slug: def.slug })
        .eq("id", oldRow.id);
      if (error) {
        errors.push(`Falha ao renomear "${oldSlug}" → "${def.slug}": ${error.message}`);
        continue;
      }

      existing.delete(oldSlug);
      existing.set(def.slug, oldRow);
      renamed += 1;

      const { error: histError } = await db
        .from("permission_node_slug_history")
        .insert({ old_slug: oldSlug, new_slug: def.slug, reason: "sync:canonical-namespace" });
      if (histError) {
        errors.push(`Histórico de slug não registrado (${oldSlug}): ${histError.message}`);
      }
    }
  }

  return renamed;
}

async function loadExisting(): Promise<Map<string, { id: string; active: boolean }>> {
  const db = await admin();
  const map = new Map<string, { id: string; active: boolean }>();
  const { data, error } = await db.from("permission_nodes").select("id, slug, active");
  if (error) throw new Error(error.message);
  for (const row of data ?? []) map.set(row.slug, { id: row.id, active: row.active });
  return map;
}

/** Sincroniza o Registry completo com `permission_nodes`. */
export async function syncPermissionRegistry(
  options: { triggeredBy?: string | null; dryRun?: boolean } = {},
): Promise<SyncReport> {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  let runId: string | null = null;
  let created = 0;
  let updated = 0;
  let deactivated = 0;
  let renamed = 0;

  bootstrapPermissionRegistry(true);
  runAutoDiscovery();

  const validation = permissionRegistry.validate();
  if (!validation.ok) errors.push(...validation.errors);

  const defs = permissionRegistry.list();

  try {
    const db = await admin();

    if (!options.dryRun) {
      const { data: run, error: runError } = await db
        .from("permission_sync_runs")
        .insert({
          status: "running",
          triggered_by: options.triggeredBy ?? null,
          started_at: startedAt,
          total_nodes: defs.length,
        })
        .select("id")
        .single();
      if (runError) errors.push(`Não foi possível registrar a execução: ${runError.message}`);
      runId = run?.id ?? null;
    }

    if (validation.ok && !options.dryRun) {
      const existing = await loadExisting();
      renamed = await migrateLegacySlugs(defs, existing, errors);

      const byDepth = new Map<number, PermissionNodeDefinition[]>();
      for (const def of defs) {
        const depth = def.slug.split(".").length;
        byDepth.set(depth, [...(byDepth.get(depth) ?? []), def]);
      }

      const idBySlug = new Map<string, string>(
        [...existing.entries()].map(([slug, row]) => [slug, row.id]),
      );
      const syncedAt = new Date().toISOString();

      for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
        const wave = byDepth.get(depth) ?? [];
        const rows = wave.map((def) =>
          rowFromDefinition(
            def,
            def.parentSlug ? (idBySlug.get(def.parentSlug) ?? null) : null,
            syncedAt,
          ),
        );
        if (!rows.length) continue;

        const { data, error } = await db
          .from("permission_nodes")
          .upsert(rows as never, { onConflict: "slug" })
          .select("id, slug");
        if (error) {
          errors.push(`Falha ao sincronizar nível ${depth}: ${error.message}`);
          continue;
        }
        for (const row of data ?? []) {
          if (existing.has(row.slug)) updated += 1;
          else created += 1;
          idBySlug.set(row.slug, row.id);
        }
      }

      // SOFT DELETE — nós que sumiram do Registry.
      const currentSlugs = new Set(defs.map((d) => d.slug));
      const orphans = [...existing.keys()].filter((slug) => !currentSlugs.has(slug));
      if (orphans.length) {
        const { data, error } = await db
          .from("permission_nodes")
          .update({ active: false, deactivated_at: syncedAt })
          .in("slug", orphans)
          .eq("active", true)
          .select("id");
        if (error) errors.push(`Falha ao desativar nós obsoletos: ${error.message}`);
        else deactivated = data?.length ?? 0;
      }
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  const finishedAt = new Date().toISOString();
  const status: SyncReport["status"] = !validation.ok
    ? "failed"
    : errors.length
      ? "partial"
      : "success";

  if (runId) {
    try {
      const db = await admin();
      await db
        .from("permission_sync_runs")
        .update({
          status,
          finished_at: finishedAt,
          total_nodes: defs.length,
          created_count: created,
          updated_count: updated,
          deactivated_count: deactivated,
          errors: errors as never,
        })
        .eq("id", runId);
    } catch (err) {
      console.error("[permissions] falha ao finalizar o log de sync", err);
    }
  }

  return {
    runId,
    status,
    total: defs.length,
    created,
    updated,
    deactivated,
    renamed,
    errors,
    startedAt,
    finishedAt,
  };
}

/** Últimas execuções do sync, para diagnóstico na interface. */
export async function listSyncRuns(limit = 10) {
  const db = await admin();
  const { data, error } = await db
    .from("permission_sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/**
 * Garante que a árvore exista antes de qualquer leitura administrativa.
 * Só dispara o sync quando a tabela está vazia — evita "árvore vazia no boot".
 */
export async function ensureRegistrySynced(
  triggeredBy?: string | null,
): Promise<SyncReport | null> {
  const db = await admin();
  const { count, error } = await db
    .from("permission_nodes")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return null;
  return syncPermissionRegistry({ triggeredBy: triggeredBy ?? "auto:empty-tree" });
}
