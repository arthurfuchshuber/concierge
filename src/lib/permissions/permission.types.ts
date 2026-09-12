/**
 * Permission Engine — contratos base (FASE 1: apenas estrutura).
 *
 * Esta camada é totalmente desacoplada das telas. Nenhuma página, rota ou
 * fluxo existente depende dela ainda. Toda validação futura de acesso do
 * ConciergeIA deverá passar por aqui.
 */

/** Tipo de nó na árvore de permissões. */
export type PermissionNodeType = "PAGE" | "SUBPAGE" | "TAB" | "SECTION" | "RESOURCE" | "FIELD";

export const PERMISSION_NODE_TYPES: PermissionNodeType[] = [
  "PAGE",
  "SUBPAGE",
  "TAB",
  "SECTION",
  "RESOURCE",
  "FIELD",
];

/** Ordem hierárquica esperada (do mais amplo para o mais específico). */
export const PERMISSION_NODE_DEPTH: Record<PermissionNodeType, number> = {
  PAGE: 0,
  SUBPAGE: 1,
  TAB: 2,
  SECTION: 3,
  RESOURCE: 4,
  FIELD: 5,
};

/** Níveis de acesso padrão. Ordenados do menor para o maior. */
export type AccessLevel = "NONE" | "READ" | "WRITE";

export const ACCESS_LEVELS: AccessLevel[] = ["NONE", "READ", "WRITE"];

/** Peso numérico usado para comparação/herança de níveis. */
export const ACCESS_LEVEL_WEIGHT: Record<AccessLevel, number> = {
  NONE: 0,
  READ: 1,
  WRITE: 2,
};

/** Escopos suportados por uma atribuição de permissão. */
export type ScopeType = "GLOBAL" | "TENANT" | "CLIENT" | "PROPERTY" | "RECORD";

export const SCOPE_TYPES: ScopeType[] = ["GLOBAL", "TENANT", "CLIENT", "PROPERTY", "RECORD"];

/**
 * Papéis internos do sistema.
 *
 * REGRA ESTRUTURAL DO OWNER (documentada aqui, ainda NÃO aplicada):
 *  - OWNER sempre possui acesso total ao que estiver disponível para o tenant.
 *  - As permissões do OWNER nunca podem ser editadas, removidas ou rebaixadas.
 *  - Qualquer tentativa de gravar assignment para um OWNER deve ser rejeitada
 *    pelo Permission Service nas fases seguintes.
 */
export type SystemRole = "OWNER" | "SYSTEM" | "ADMIN_SAAS" | "CRON" | "INTEGRATION";

export const SYSTEM_ROLES: SystemRole[] = ["OWNER", "SYSTEM", "ADMIN_SAAS", "CRON", "INTEGRATION"];

/** Papéis que ignoram checagem granular (bypass estrutural). */
export const BYPASS_SYSTEM_ROLES: SystemRole[] = ["OWNER", "SYSTEM", "ADMIN_SAAS", "CRON"];

/** Nó de permissão — espelha `public.permission_nodes`. */
export type PermissionNode = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  type: PermissionNodeType;
  description: string | null;
  order: number;
  active: boolean;
  label: string | null;
  route: string | null;
  icon: string | null;
  display_order: number;
  is_system: boolean;
  is_hidden: boolean;
  version: number;
  deprecated: boolean;
  created_at: string;
  updated_at: string;
};

/** Origem de um nó dentro do catálogo (usada pelo Guardian/auditoria). */
export type PermissionNodeSource = "catalog" | "scanner" | "auto-parent" | "manual";

/** Definição declarativa usada pelo Registry antes de existir no banco. */
export type PermissionNodeDefinition = {
  slug: string;
  name: string;
  type: PermissionNodeType;
  parentSlug?: string | null;
  description?: string | null;
  order?: number;
  active?: boolean;
  /** Rótulo exibido ao usuário (default: `name`). */
  label?: string | null;
  /** Rota associada, quando o nó for navegável. */
  route?: string | null;
  /** Nome do ícone (lucide-react), quando existir. */
  icon?: string | null;
  /** Ordem de exibição dentro do pai. */
  displayOrder?: number;
  /** Nó estrutural do próprio SaaS (não editável pelo tenant). */
  isSystem?: boolean;
  /** Nó existente porém não exibido na UI de permissões. */
  isHidden?: boolean;
  /** Versão do nó — permite evolução sem perda de histórico. */
  version?: number;
  /** Nó descontinuado (mantido para histórico). */
  deprecated?: boolean;
  /** De onde o nó veio (catálogo, scanner, criação automática de pai). */
  source?: PermissionNodeSource;
  /** Funcionalidade de plano exigida para o nó ficar disponível. */
  feature?: string | null;
  /** Nível máximo que um membro pode receber neste nó. */
  maxAccessLevel?: AccessLevel;
  /**
   * FASE 3.5 — quando `false`, o nó é catalogado apenas para diagnóstico e
   * NUNCA entra na árvore de permissões (rotas públicas, legais, marketing,
   * autenticação e landing pages).
   */
  isPermissionable?: boolean;
  /** Slugs anteriores deste nó (histórico de normalização). */
  legacySlugs?: string[];
};

/** Atribuição de permissão — espelha `public.permission_assignments`. */
export type PermissionAssignment = {
  id: string;
  tenant_id: string;
  user_id: string;
  permission_node_id: string;
  access_level: AccessLevel;
  scope_type: ScopeType;
  scope_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Vínculo operacional usuário ↔ residência — `public.property_assignments`. */
export type PropertyAssignment = {
  id: string;
  tenant_id: string;
  property_id: string;
  user_id: string;
  status: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Registro de auditoria — `public.permission_audit`. */
export type PermissionAuditEntry = {
  id: string;
  tenant_id: string;
  actor_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  permission_node_id: string | null;
  previous_access_level: AccessLevel | null;
  new_access_level: AccessLevel | null;
  scope_type: ScopeType | null;
  scope_id: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

/** Escopo concreto de uma checagem. */
export type PermissionScope = {
  type: ScopeType;
  id?: string | null;
};

/** Identidade avaliada pelo engine. */
export type PermissionSubject = {
  userId: string;
  tenantId: string;
  systemRoles?: SystemRole[];
  /** Plano ativo do tenant (usado pelo feature gating). */
  plan?: string | null;
  /**
   * O usuário é MEMBRO desta conta (não é o titular)? Nesse caso as
   * permissões da conta valem mesmo que ele seja administrador do SaaS —
   * o bypass de `ADMIN_SAAS` fica restrito aos recursos `admin.*`.
   */
  isTenantMember?: boolean;
};

/** Pedido de checagem. */
export type PermissionRequest = {
  subject: PermissionSubject;
  nodeSlug: string;
  required: AccessLevel;
  scope?: PermissionScope;
};

/** Resultado de qualquer checagem do engine. */
export type PermissionDecision = {
  allowed: boolean;
  /** Nível efetivo resolvido para o subject no nó. */
  effective: AccessLevel;
  reason: string;
  /** Origem da decisão — útil para auditoria futura. */
  source:
    | "owner"
    | "system_role"
    | "assignment"
    | "inherited"
    | "default"
    | "feature"
    | "unknown_node";
};
