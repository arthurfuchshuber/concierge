/**
 * Permission Admin (server) — orquestração da interface de gerenciamento
 * das novas permissões (FASE 3).
 *
 * IMPORTANTE: nada aqui autoriza requisições. O sistema atual de permissões
 * (`member-permissions` / `plan-guard`) continua sendo a única fonte de
 * autorização. Este módulo apenas LÊ o Permission Registry e GRAVA na nova
 * estrutura (`permission_assignments` + `permission_audit`) para validação.
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { featureAccess } from "./feature.access";
import { permissionRegistry } from "./permission.registry";
import { permissionRepository } from "./permission.repository.server";
import { syncRegistryToDatabase } from "./permission.service.server";
import {
  ACCESS_LEVEL_WEIGHT,
  type AccessLevel,
  type PermissionNodeType,
  type SystemRole,
} from "./permission.types";

/** Tenant sintético usado pelo contexto do Admin do SaaS. */
export const SAAS_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export type PermissionContextKind = "account" | "saas";

/** Nó serializável enviado para a árvore dinâmica da UI. */
export type PermissionNodeDTO = {
  id: string;
  slug: string;
  name: string;
  label: string;
  description: string | null;
  type: PermissionNodeType;
  route: string | null;
  icon: string | null;
  parentSlug: string | null;
  depth: number;
  hasChildren: boolean;
  feature: string | null;
  isSaasOnly: boolean;
};

export type PermissionSubjectDTO = {
  userId: string;
  name: string;
  email: string | null;
  role: string;
  roleLabel: string;
  systemRole: SystemRole | null;
  status: string;
  isOwner: boolean;
  userType: string;
};

export type PermissionWorkspace = {
  context: PermissionContextKind;
  tenantId: string;
  plan: string | null;
  planLabel: string;
  nodes: PermissionNodeDTO[];
  subjects: PermissionSubjectDTO[];
  blockedFeatures: string[];
};

let dbSynced = false;

/** Garante que o Registry esteja carregado e espelhado no banco (uma vez). */
async function ensureRegistry(): Promise<void> {
  bootstrapPermissionRegistry();
  if (dbSynced) return;
  try {
    await syncRegistryToDatabase();
    dbSynced = true;
  } catch (err) {
    console.error("[permissions] falha ao sincronizar registry", err);
  }
}

function isSaasSlug(slug: string): boolean {
  return slug === "admin" || slug.startsWith("admin.");
}

/**
 * Monta a árvore dinâmica já filtrada pelo plano contratado.
 * Módulos indisponíveis para o plano não são retornados — nem para OWNER.
 */
export async function buildNodeTree(args: {
  plan: string | null;
  context: PermissionContextKind;
}): Promise<{ nodes: PermissionNodeDTO[]; blockedFeatures: string[] }> {
  await ensureRegistry();
  const dbNodes = await permissionRepository.listNodes();
  const idBySlug: Record<string, string> = {};
  for (const n of dbNodes) idBySlug[n.slug] = n.id;

  const blocked = new Set<string>();
  const defs = permissionRegistry
    .list()
    .filter((d) => d.active !== false && !d.isHidden && !d.deprecated);

  const allowedBySlug = new Map<string, boolean>();
  for (const def of defs) {
    const feature = permissionRegistry.requiredFeature(def.slug);
    const decision = featureAccess.check(feature, args.plan);
    if (!decision.allowed && feature) blocked.add(feature);
    allowedBySlug.set(def.slug, decision.allowed);
  }

  const visible = defs.filter((def) => {
    if (!allowedBySlug.get(def.slug)) return false;
    if (args.context === "account" && isSaasSlug(def.slug)) return false;
    if (!idBySlug[def.slug]) return false;
    return true;
  });

  const childCount = new Map<string, number>();
  for (const def of visible) {
    const parent = def.parentSlug ?? null;
    if (parent) childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
  }

  const nodes: PermissionNodeDTO[] = visible.map((def) => ({
    id: idBySlug[def.slug]!,
    slug: def.slug,
    name: def.name,
    label: def.label ?? def.name,
    description: def.description ?? null,
    type: def.type,
    route: def.route ?? null,
    icon: def.icon ?? null,
    parentSlug: def.parentSlug ?? null,
    depth: def.slug.split(".").length - 1,
    hasChildren: (childCount.get(def.slug) ?? 0) > 0,
    feature: permissionRegistry.requiredFeature(def.slug),
    isSaasOnly: isSaasSlug(def.slug),
  }));

  nodes.sort(
    (a, b) =>
      a.depth - b.depth ||
      (permissionRegistry.get(a.slug)?.displayOrder ?? 0) -
        (permissionRegistry.get(b.slug)?.displayOrder ?? 0) ||
      a.slug.localeCompare(b.slug),
  );

  return { nodes, blockedFeatures: [...blocked] };
}

/* --------------------------------------------------------------- assignments */

export type SubjectPermissions = {
  userId: string;
  tenantId: string;
  isOwner: boolean;
  levels: Record<string, AccessLevel>;
  updatedAt: Record<string, string>;
  counts: { read: number; write: number; none: number; configured: number };
  scopes: Array<{ type: string; id: string | null; count: number }>;
};

/** Lê as permissões efetivamente gravadas para um usuário. */
export async function readSubjectPermissions(args: {
  tenantId: string;
  userId: string;
  isOwner: boolean;
  totalNodes: number;
}): Promise<SubjectPermissions> {
  await ensureRegistry();
  const [assignments, dbNodes] = await Promise.all([
    permissionRepository.listAssignments(args.tenantId, args.userId),
    permissionRepository.listNodes(),
  ]);
  const slugById: Record<string, string> = {};
  for (const n of dbNodes) slugById[n.id] = n.slug;

  const levels: Record<string, AccessLevel> = {};
  const updatedAt: Record<string, string> = {};
  const scopeMap = new Map<string, { type: string; id: string | null; count: number }>();

  for (const a of assignments) {
    const slug = slugById[a.permission_node_id];
    if (!slug) continue;
    levels[slug] = a.access_level;
    updatedAt[slug] = a.updated_at;
    const key = `${a.scope_type}:${a.scope_id ?? ""}`;
    const current = scopeMap.get(key);
    if (current) current.count += 1;
    else scopeMap.set(key, { type: a.scope_type, id: a.scope_id ?? null, count: 1 });
  }

  const read = Object.values(levels).filter((l) => l === "READ").length;
  const write = Object.values(levels).filter((l) => l === "WRITE").length;
  const configured = read + write;

  return {
    userId: args.userId,
    tenantId: args.tenantId,
    isOwner: args.isOwner,
    levels,
    updatedAt,
    counts: {
      read,
      write,
      configured,
      none: Math.max(0, args.totalNodes - configured),
    },
    scopes: [...scopeMap.values()],
  };
}

/** Descendentes diretos e indiretos de um slug, segundo o Registry. */
export function descendantSlugs(slug: string): string[] {
  bootstrapPermissionRegistry();
  const prefix = `${slug}.`;
  return permissionRegistry
    .list()
    .filter((n) => n.slug.startsWith(prefix))
    .map((n) => n.slug);
}

/** Prévia da remoção em cascata ao rebaixar um nó para "Sem acesso". */
export async function previewCascade(args: {
  tenantId: string;
  userId: string;
  slug: string;
}): Promise<{ slugs: string[]; count: number }> {
  const perms = await readSubjectPermissions({
    tenantId: args.tenantId,
    userId: args.userId,
    isOwner: false,
    totalNodes: 0,
  });
  const affected = descendantSlugs(args.slug).filter((s) => !!perms.levels[s]);
  return { slugs: affected, count: affected.length };
}

export type SetPermissionResult = {
  ok: boolean;
  slug: string;
  level: AccessLevel;
  removed: string[];
  message: string;
};

/**
 * Grava um nível de acesso respeitando herança e cascata.
 * Toda alteração — inclusive a cascata — gera auditoria.
 */
export async function setSubjectPermission(args: {
  tenantId: string;
  userId: string;
  slug: string;
  level: AccessLevel;
  actorId: string;
  actorName?: string | null;
  isOwnerTarget: boolean;
}): Promise<SetPermissionResult> {
  await ensureRegistry();

  if (args.isOwnerTarget) {
    throw new Error(
      "Usuários OWNER possuem acesso total aos recursos disponíveis no plano contratado. Suas permissões são gerenciadas automaticamente pelo sistema.",
    );
  }

  const def = permissionRegistry.get(args.slug);
  if (!def) throw new Error(`Recurso "${args.slug}" não existe na árvore de permissões.`);

  const dbNodes = await permissionRepository.listNodes();
  const idBySlug: Record<string, string> = {};
  const slugById: Record<string, string> = {};
  for (const n of dbNodes) {
    idBySlug[n.slug] = n.id;
    slugById[n.id] = n.slug;
  }
  const nodeId = idBySlug[args.slug];
  if (!nodeId) throw new Error("Recurso ainda não sincronizado com a base de permissões.");

  const current = await permissionRepository.listAssignments(args.tenantId, args.userId);
  const levels: Record<string, AccessLevel> = {};
  for (const a of current) {
    const s = slugById[a.permission_node_id];
    if (s) levels[s] = a.access_level;
  }

  // HERANÇA — o pai precisa estar liberado (READ ou WRITE).
  if (args.level !== "NONE" && def.parentSlug) {
    const parentLevel = levels[def.parentSlug] ?? "NONE";
    if (ACCESS_LEVEL_WEIGHT[parentLevel] === 0) {
      const parent = permissionRegistry.get(def.parentSlug);
      throw new Error(
        `Para liberar "${def.label ?? def.name}" é necessário primeiro conceder acesso ao nível superior "${parent?.label ?? def.parentSlug}".`,
      );
    }
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const removed: string[] = [];

  if (args.level === "NONE") {
    // REMOÇÃO EM CASCATA — descendentes configurados também são removidos.
    const targets = [args.slug, ...descendantSlugs(args.slug).filter((s) => !!levels[s])];
    const ids = targets.map((s) => idBySlug[s]).filter(Boolean) as string[];
    if (ids.length) {
      const { error } = await supabaseAdmin
        .from("permission_assignments")
        .delete()
        .eq("tenant_id", args.tenantId)
        .eq("user_id", args.userId)
        .in("permission_node_id", ids);
      if (error) throw new Error(error.message);
    }
    for (const slug of targets) {
      if (!levels[slug]) continue;
      if (slug !== args.slug) removed.push(slug);
      await permissionRepository.recordAudit({
        tenantId: args.tenantId,
        actorId: args.actorId,
        actorName: args.actorName ?? null,
        targetUserId: args.userId,
        permissionNodeId: idBySlug[slug] ?? null,
        previousAccessLevel: levels[slug] ?? null,
        newAccessLevel: "NONE",
        scopeType: "TENANT",
        action: slug === args.slug ? "revoke" : "cascade_revoke",
        metadata: { slug, origin: args.slug },
      });
    }
    return {
      ok: true,
      slug: args.slug,
      level: "NONE",
      removed,
      message: removed.length
        ? `Acesso removido. ${removed.length} permissão(ões) inferior(es) também foram removidas.`
        : "Acesso removido.",
    };
  }

  const previous = levels[args.slug] ?? null;
  await permissionRepository.upsertAssignment({
    tenantId: args.tenantId,
    userId: args.userId,
    permissionNodeId: nodeId,
    accessLevel: args.level,
    scopeType: "TENANT",
    scopeId: null,
    createdBy: args.actorId,
  });
  await permissionRepository.recordAudit({
    tenantId: args.tenantId,
    actorId: args.actorId,
    actorName: args.actorName ?? null,
    targetUserId: args.userId,
    permissionNodeId: nodeId,
    previousAccessLevel: previous,
    newAccessLevel: args.level,
    scopeType: "TENANT",
    action: previous ? "update" : "create",
    metadata: { slug: args.slug },
  });

  return {
    ok: true,
    slug: args.slug,
    level: args.level,
    removed,
    message: args.level === "READ" ? "Acesso de visualização concedido." : "Acesso de edição concedido.",
  };
}

/* ------------------------------------------------------------------ auditoria */

export type AuditRow = {
  id: string;
  createdAt: string;
  actorName: string | null;
  targetUserId: string | null;
  slug: string | null;
  previous: AccessLevel | null;
  next: AccessLevel | null;
  action: string;
};

export async function readAudit(tenantId: string, limit = 120): Promise<AuditRow[]> {
  const [entries, dbNodes] = await Promise.all([
    permissionRepository.listAudit(tenantId, limit),
    permissionRepository.listNodes(),
  ]);
  const slugById: Record<string, string> = {};
  for (const n of dbNodes) slugById[n.id] = n.slug;
  return entries.map((e) => ({
    id: e.id,
    createdAt: e.created_at,
    actorName: e.actor_name,
    targetUserId: e.target_user_id,
    slug: e.permission_node_id ? (slugById[e.permission_node_id] ?? null) : null,
    previous: e.previous_access_level,
    next: e.new_access_level,
    action: e.action,
  }));
}
