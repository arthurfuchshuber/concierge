/**
 * Testes internos do Authorization Runtime Engine (FASE 3.6).
 *
 * Não dependem de banco: usam snapshots fabricados e o núcleo determinístico
 * `evaluateWithSnapshot`. Servem como verificação de sanidade antes de
 * qualquer ativação do guard em produção (Fase 4).
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { evaluateWithSnapshot, clearDeniedDecisions, readDeniedDecisions } from "./permission.guard.server";
import { permissionRegistry } from "./permission.registry";
import type { SubjectSnapshot } from "./permission.resolve.server";
import type { AccessLevel, PermissionAssignment, ScopeType } from "./permission.types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PROPERTY = "33333333-3333-4333-8333-333333333333";
const NODE_ID = "44444444-4444-4444-8444-444444444444";

type Case = { name: string; ok: boolean; detail: string };

function pickSlug(): string {
  bootstrapPermissionRegistry();
  const node = permissionRegistry
    .listPermissionable()
    .find((n) => n.slug.startsWith("tenant.") && n.slug.split(".").length >= 2);
  return node?.slug ?? "tenant";
}

function assignment(
  slug: string,
  level: AccessLevel,
  scopeType: ScopeType = "TENANT",
  scopeId: string | null = null,
): PermissionAssignment {
  void slug;
  return {
    id: "assignment-1",
    tenant_id: TENANT,
    user_id: USER,
    permission_node_id: NODE_ID,
    access_level: level,
    scope_type: scopeType,
    scope_id: scopeId,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function snapshot(over: Partial<SubjectSnapshot> = {}, slug = pickSlug()): SubjectSnapshot {
  return {
    subject: { userId: USER, tenantId: TENANT, systemRoles: [], plan: "enterprise" },
    status: "active",
    properties: [PROPERTY],
    assignments: [],
    nodeIdBySlug: { [slug]: NODE_ID },
    activeSlugs: [slug],
    ...over,
  };
}

/** Executa a bateria e devolve o resultado (não lança). */
export function runAuthorizationSelfTests(): { ok: boolean; cases: Case[] } {
  const slug = pickSlug();
  const cases: Case[] = [];
  clearDeniedDecisions();

  const check = (name: string, expected: boolean, decision: ReturnType<typeof evaluateWithSnapshot>) => {
    cases.push({
      name,
      ok: decision.allowed === expected,
      detail: `${decision.permission} · ${decision.scope.type} · efetivo=${decision.effective} · ${decision.reason}`,
    });
  };

  // 1) Usuário com permissão válida.
  check(
    "usuário com permissão válida",
    true,
    evaluateWithSnapshot(snapshot({ assignments: [assignment(slug, "WRITE")] }, slug), slug, {
      required: "WRITE",
    }),
  );

  // 2) Usuário sem permissão.
  check("usuário sem permissão", false, evaluateWithSnapshot(snapshot({}, slug), slug));

  // 3) Permissão existe, porém fora do escopo (grant em outra residência).
  check(
    "permissão fora do escopo",
    false,
    evaluateWithSnapshot(
      snapshot({ assignments: [assignment(slug, "WRITE", "PROPERTY", PROPERTY)] }, slug),
      slug,
      { propertyId: "55555555-5555-4555-8555-555555555555", required: "READ" },
    ),
  );

  // 4) Usuário inativo (acesso revogado).
  check(
    "usuário inativo",
    false,
    evaluateWithSnapshot(
      snapshot({ status: "revoked", assignments: [assignment(slug, "WRITE")] }, slug),
      slug,
    ),
  );

  // 5) Vínculo de residência removido.
  check(
    "property assignment removido",
    false,
    evaluateWithSnapshot(
      snapshot({ properties: [], assignments: [assignment(slug, "WRITE", "PROPERTY", PROPERTY)] }, slug),
      slug,
      { propertyId: PROPERTY },
    ),
  );

  // 6) OWNER sempre autorizado (regra estrutural imutável).
  check(
    "owner com acesso total",
    true,
    evaluateWithSnapshot(
      snapshot({ subject: { userId: TENANT, tenantId: TENANT, systemRoles: ["OWNER"], plan: null } }, slug),
      slug,
      { required: "WRITE" },
    ),
  );

  // 7) Escopo inválido (PROPERTY sem identificador).
  check(
    "escopo inválido",
    false,
    evaluateWithSnapshot(snapshot({}, slug), slug, { scope: { type: "PROPERTY", id: null } }),
  );

  const ok = cases.every((c) => c.ok);
  if (!ok) {
    console.error("[authz][selftest] falhas detectadas", cases.filter((c) => !c.ok));
  }
  return { ok, cases };
}

/** Diagnóstico completo: testes + últimas negativas registradas. */
export function authorizationDiagnostics() {
  const tests = runAuthorizationSelfTests();
  return { tests, deniedSample: readDeniedDecisions(20) };
}
