/**
 * Permission Center (FASE 4.2) — camada de leitura do centro administrativo
 * "Equipe e Permissões".
 *
 * REGRAS DESTA FASE:
 *  - Nenhuma regra de autorização é criada, alterada ou reimplementada aqui.
 *  - Toda decisão vem de `permission.guard.server.ts` (via `checkAccess`, que
 *    respeita o modo de enforcement do tenant).
 *  - Somente leitura: nada é gravado, nenhum novo tipo de permissão é criado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { permissionRegistry } from "./permission.registry";
import { permissionRepository } from "./permission.repository.server";
import {
  effectivePermissionsFromSnapshot,
  resolveSubjectSnapshot,
  resolveTenantOf,
  type SubjectSnapshot,
} from "./permission.resolve.server";
import { SCOPE_TYPES, type AccessLevel, type ScopeType } from "./permission.types";

/* ------------------------------------------------------------------ tipos */

export type CenterDenial = { allowed: false; reason: string };

export type CenterUser = {
  userId: string;
  name: string;
  email: string | null;
  status: string;
  tenantId: string;
  tenantName: string;
  roles: string[];
  isOwner: boolean;
  effectiveCount: number;
  writeCount: number;
  propertyCount: number;
};

export type CenterOverview = {
  allowed: true;
  context: "account" | "saas";
  tenantId: string;
  tenantName: string;
  users: CenterUser[];
};

export type CenterPermissionRow = {
  namespace: string;
  label: string;
  description: string | null;
  domain: string;
  type: string;
  active: boolean;
  permissionable: boolean;
};

export type CenterUserDetail = {
  allowed: true;
  user: CenterUser;
  /** Papel atual dentro da conta (owner | agent | viewer). */
  role: string;
  direct: Array<{
    id: string;
    namespace: string;
    label: string;
    level: AccessLevel;
    scopeType: ScopeType;
    scopeId: string | null;
  }>;
  inherited: Array<{ namespace: string; label: string; level: AccessLevel }>;
  scopes: Array<{ type: ScopeType; description: string; count: number }>;
  properties: CenterProperty[];
};

export type CenterProperty = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  ownerId: string | null;
  ownerName: string | null;
  ownerPhone: string | null;
  ownerPhoneCountry: string | null;
  published: boolean;
  assigned: boolean;
};

export type CenterScopes = {
  allowed: true;
  scopes: Array<{ type: ScopeType; description: string; count: number }>;
  properties: CenterProperty[];
};


export type CenterAudit = {
  allowed: true;
  rows: Array<{
    id: string;
    createdAt: string;
    actorName: string | null;
    targetName: string | null;
    action: string;
    namespace: string | null;
    previous: string | null;
    next: string | null;
    scopeType: string | null;
  }>;
};

/** Nó do Registry que representa o próprio centro administrativo. */
export const PERMISSION_CENTER_SLUG = "tenant.administrativo.permissoes";

const SCOPE_DESCRIPTION: Record<ScopeType, string> = {
  GLOBAL: "Vale para todo o SaaS, independente de conta.",
  TENANT: "Vale para toda a conta do cliente (padrão).",
  CLIENT: "Restrito a um cliente específico dentro da conta.",
  PROPERTY: "Restrito às residências vinculadas ao usuário.",
  RECORD: "Restrito a um registro específico (reserva, conversa, documento).",
};

/* ---------------------------------------------------------------- guarda */

/**
 * Validação obrigatória — SEMPRE antes de qualquer leitura sensível.
 * Delegada integralmente ao Authorization Runtime existente.
 */
export async function assertCenterAccess(
  userId: string,
  required: AccessLevel = "READ",
): Promise<{ allowed: boolean; reason: string; snapshot: SubjectSnapshot }> {
  const { checkAccess } = await import("./permission.enforce.server");
  const snapshot = await resolveSubjectSnapshot(userId);
  const outcome = await checkAccess(userId, PERMISSION_CENTER_SLUG, {
    snapshot,
    required,
    operation: "ui:permission-center",
  });
  return {
    // Em modo não bloqueante o comportamento atual do produto é preservado.
    allowed: outcome.decision.allowed || !outcome.enforced,
    reason: outcome.decision.allowed ? "Acesso permitido." : outcome.decision.reason,
    snapshot,
  };
}

/* --------------------------------------------------------------- helpers */

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function isSaasAdmin(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  return !!data;
}

async function profilesFor(ids: string[]) {
  const out: Record<string, { name: string | null; email: string | null }> = {};
  if (!ids.length) return out;
  const client = await db();
  const { data: profs } = await client
    .from("profiles")
    .select("id, full_name, trade_name")
    .in("id", ids);
  for (const p of profs ?? []) {
    out[p.id as string] = {
      name: ((p.trade_name as string) || (p.full_name as string)) ?? null,
      email: null,
    };
  }
  try {
    const { data: users } = await client.auth.admin.listUsers({ perPage: 200 });
    for (const u of users?.users ?? []) {
      if (!ids.includes(u.id)) continue;
      out[u.id] = { name: out[u.id]?.name ?? null, email: u.email ?? null };
    }
  } catch {
    /* e-mail é complementar: nunca bloqueia a listagem */
  }
  return out;
}

const ROLE_LABEL: Record<string, string> = {
  owner: "Titular da conta",
  agent: "Atendente",
  viewer: "Visualizador",
  admin: "Administrador do SaaS",
};

function labelOf(namespace: string): string {
  return permissionRegistry.get(namespace)?.label ?? permissionRegistry.get(namespace)?.name ?? namespace;
}

function domainOf(namespace: string): string {
  const parts = namespace.split(".");
  if (parts.length <= 1) return parts[0] ?? namespace;
  const root = parts[0] === "admin" ? "Admin do SaaS" : "Conta do cliente";
  const page = parts[1];
  return `${root} · ${labelOf(`${parts[0]}.${page}`)}`;
}

async function buildUser(
  targetId: string,
  tenantId: string,
  tenantName: string,
  meta: { name: string | null; email: string | null } | undefined,
  role: string,
  status: string,
  extraRoles: string[] = [],
): Promise<CenterUser> {
  const snapshot = await resolveSubjectSnapshot(targetId, { tenantId });
  const effective = effectivePermissionsFromSnapshot(snapshot);
  const values = Object.values(effective);
  return {
    userId: targetId,
    name: meta?.name || meta?.email || targetId,
    email: meta?.email ?? null,
    status,
    tenantId,
    tenantName,
    roles: [ROLE_LABEL[role] ?? role, ...extraRoles],
    isOwner: targetId === tenantId || role === "owner",
    effectiveCount: values.length,
    writeCount: values.filter((v) => v === "WRITE").length,
    propertyCount: snapshot.properties.length,
  };
}

async function resolveContext(supabase: SupabaseClient, userId: string) {
  const saas = await isSaasAdmin(supabase, userId);
  const { tenantId } = await resolveTenantOf(userId);
  const profiles = await profilesFor([tenantId]);
  return {
    kind: (saas ? "saas" : "account") as "saas" | "account",
    tenantId,
    tenantName: profiles[tenantId]?.name || profiles[tenantId]?.email || "Minha conta",
  };
}

/* ------------------------------------------------------------- consultas */

export async function loadCenterOverview(
  supabase: SupabaseClient,
  userId: string,
): Promise<CenterOverview | CenterDenial> {
  const guard = await assertCenterAccess(userId);
  if (!guard.allowed) return { allowed: false, reason: guard.reason };

  const { kind, tenantId, tenantName } = await resolveContext(supabase, userId);
  const client = await db();

  const { data: members } = await client
    .from("account_members")
    .select("member_user_id, role, status")
    .eq("owner_id", tenantId)
    .order("created_at", { ascending: true });

  const ids = [...new Set([tenantId, ...(members ?? []).map((m) => m.member_user_id as string)])];
  const profiles = await profilesFor(ids);

  const users: CenterUser[] = [];
  users.push(
    await buildUser(tenantId, tenantId, tenantName, profiles[tenantId], "owner", "active", kind === "saas" ? ["Administrador do SaaS"] : []),
  );
  for (const m of members ?? []) {
    const id = m.member_user_id as string;
    if (id === tenantId) continue;
    users.push(
      await buildUser(
        id,
        tenantId,
        tenantName,
        profiles[id],
        (m.role as string) ?? "agent",
        (m.status as string) ?? "active",
      ),
    );
  }

  return { allowed: true, context: kind, tenantId, tenantName, users };
}

async function propertiesOf(tenantId: string, assigned: string[]) {
  const client = await db();
  const { data } = await client
    .from("properties")
    .select("id, name, address, city, state, owner_contact_id")
    .eq("owner_id", tenantId)
    .order("name", { ascending: true });

  const rows = (data ?? []) as Array<{
    id: string;
    name: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    owner_contact_id: string | null;
  }>;

  const ownerIds = [...new Set(rows.map((r) => r.owner_contact_id).filter((v): v is string => !!v))];
  const ownerById = new Map<
    string,
    { name: string | null; phone: string | null; country: string | null }
  >();
  if (ownerIds.length > 0) {
    const { data: owners } = await client
      .from("property_owners")
      .select("id, name, trade_name, phone, phone_country")
      .in("id", ownerIds);
    for (const o of (owners ?? []) as Array<{
      id: string;
      name: string | null;
      trade_name: string | null;
      phone: string | null;
      phone_country: string | null;
    }>) {
      ownerById.set(o.id, {
        name: (o.trade_name || o.name || "").trim() || null,
        phone: o.phone ?? null,
        country: o.phone_country ?? null,
      });
    }
  }

  return rows.map((p) => {
    const owner = p.owner_contact_id ? ownerById.get(p.owner_contact_id) : undefined;
    return {
      id: p.id,
      name: p.name ?? "Residência",
      address: p.address ?? null,
      city: p.city ?? null,
      state: p.state ?? null,
      ownerId: p.owner_contact_id,
      ownerName: owner?.name ?? null,
      ownerPhone: owner?.phone ?? null,
      ownerPhoneCountry: owner?.country ?? null,
      assigned: assigned.includes(p.id),
    };
  });
}


function scopeSummary(snapshot: SubjectSnapshot) {
  const byType = new Map<ScopeType, number>();
  for (const a of snapshot.assignments) {
    byType.set(a.scope_type, (byType.get(a.scope_type) ?? 0) + 1);
  }
  return SCOPE_TYPES.map((type) => ({
    type,
    description: SCOPE_DESCRIPTION[type],
    count: type === "PROPERTY" ? snapshot.properties.length : (byType.get(type) ?? 0),
  }));
}

export async function loadCenterUserDetail(
  supabase: SupabaseClient,
  userId: string,
  targetUserId: string,
): Promise<CenterUserDetail | CenterDenial> {
  const guard = await assertCenterAccess(userId);
  if (!guard.allowed) return { allowed: false, reason: guard.reason };

  const { kind, tenantId, tenantName } = await resolveContext(supabase, userId);
  const client = await db();

  let role = "owner";
  let status = "active";
  if (targetUserId !== tenantId) {
    const { data: member } = await client
      .from("account_members")
      .select("role, status")
      .eq("owner_id", tenantId)
      .eq("member_user_id", targetUserId)
      .maybeSingle();
    if (!member) return { allowed: false, reason: "Usuário não pertence a este contexto de permissões." };
    role = (member.role as string) ?? "agent";
    status = (member.status as string) ?? "active";
  }

  const profiles = await profilesFor([targetUserId]);
  const user = await buildUser(
    targetUserId,
    tenantId,
    tenantName,
    profiles[targetUserId],
    role,
    status,
    kind === "saas" && targetUserId === userId ? ["Administrador do SaaS"] : [],
  );

  const snapshot = await resolveSubjectSnapshot(targetUserId, { tenantId });
  const slugByNodeId: Record<string, string> = {};
  for (const [slug, id] of Object.entries(snapshot.nodeIdBySlug)) slugByNodeId[id] = slug;

  const direct = snapshot.assignments
    .map((a) => {
      const namespace = slugByNodeId[a.permission_node_id] ?? a.permission_node_id;
      return {
        id: a.id,
        namespace,
        label: labelOf(namespace),
        level: a.access_level,
        scopeType: a.scope_type,
        scopeId: a.scope_id,
      };
    })
    .sort((a, b) => a.namespace.localeCompare(b.namespace));

  const directSlugs = new Set(direct.map((d) => d.namespace));
  const effective = effectivePermissionsFromSnapshot(snapshot);
  const inherited = Object.entries(effective)
    .filter(([slug]) => !directSlugs.has(slug))
    .map(([namespace, level]) => ({ namespace, label: labelOf(namespace), level }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));

  return {
    allowed: true,
    user,
    role,
    direct,
    inherited,
    scopes: scopeSummary(snapshot),
    properties: await propertiesOf(tenantId, snapshot.properties),
  };
}

export async function loadCenterRegistry(
  userId: string,
): Promise<{ allowed: true; permissions: CenterPermissionRow[] } | CenterDenial> {
  const guard = await assertCenterAccess(userId);
  if (!guard.allowed) return { allowed: false, reason: guard.reason };

  const permissions: CenterPermissionRow[] = permissionRegistry.list().map((n) => ({
    namespace: n.slug,
    label: n.label ?? n.name,
    description: n.description ?? null,
    domain: domainOf(n.slug),
    type: n.type,
    active: n.active !== false && n.deprecated !== true,
    permissionable: n.isPermissionable !== false,
  }));

  return { allowed: true, permissions };
}

export async function loadCenterScopes(
  supabase: SupabaseClient,
  userId: string,
  targetUserId?: string | null,
): Promise<CenterScopes | CenterDenial> {
  const guard = await assertCenterAccess(userId);
  if (!guard.allowed) return { allowed: false, reason: guard.reason };

  const { tenantId } = await resolveContext(supabase, userId);
  const snapshot = targetUserId
    ? await resolveSubjectSnapshot(targetUserId, { tenantId })
    : guard.snapshot;

  return {
    allowed: true,
    scopes: scopeSummary(snapshot),
    properties: await propertiesOf(tenantId, snapshot.properties),
  };
}

export async function loadCenterAudit(
  supabase: SupabaseClient,
  userId: string,
): Promise<CenterAudit | CenterDenial> {
  const guard = await assertCenterAccess(userId);
  if (!guard.allowed) return { allowed: false, reason: guard.reason };

  const { tenantId } = await resolveContext(supabase, userId);
  const rows = await permissionRepository.listAudit(tenantId, 150).catch(() => []);
  const ids = [
    ...new Set(rows.flatMap((r) => [r.actor_id, r.target_user_id]).filter((v): v is string => !!v)),
  ];
  const profiles = await profilesFor(ids);

  const nodeIdBySlug = await permissionRepository.nodeIdBySlug().catch(() => ({}) as Record<string, string>);
  const slugByNodeId: Record<string, string> = {};
  for (const [slug, id] of Object.entries(nodeIdBySlug)) slugByNodeId[id] = slug;

  return {
    allowed: true,
    rows: rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      actorName: r.actor_name ?? (r.actor_id ? (profiles[r.actor_id]?.name ?? profiles[r.actor_id]?.email ?? null) : null),
      targetName: r.target_user_id
        ? (profiles[r.target_user_id]?.name ?? profiles[r.target_user_id]?.email ?? r.target_user_id)
        : null,
      action: r.action,
      namespace: r.permission_node_id ? (slugByNodeId[r.permission_node_id] ?? null) : null,
      previous: r.previous_access_level,
      next: r.new_access_level,
      scopeType: r.scope_type,
    })),
  };
}
