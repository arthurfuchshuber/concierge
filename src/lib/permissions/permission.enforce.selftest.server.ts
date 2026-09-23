/**
 * Self-tests do Enforcement Layer (FASE 3.7).
 *
 * Validam que a camada realmente bloqueia operações protegidas, usando o
 * núcleo determinístico (`evaluateWithSnapshot` + `resolveOutcome`) — sem I/O
 * e sem tocar em dados reais.
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { clearEnforcementLog, readEnforcementLog, resolveOutcome } from "./permission.enforce.server";
import { evaluateWithSnapshot } from "./permission.guard.server";
import { permissionRegistry } from "./permission.registry";
import type { SubjectSnapshot } from "./permission.resolve.server";
import type { AccessLevel, PermissionAssignment, ScopeType } from "./permission.types";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PROPERTY_A = "33333333-3333-4333-8333-333333333333";
const PROPERTY_B = "55555555-5555-4555-8555-555555555555";
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
  level: AccessLevel,
  scopeType: ScopeType = "TENANT",
  scopeId: string | null = null,
): PermissionAssignment {
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

function snapshot(over: Partial<SubjectSnapshot>, slug: string): SubjectSnapshot {
  return {
    subject: { userId: USER, tenantId: TENANT, systemRoles: [], plan: "enterprise" },
    status: "active",
    properties: [PROPERTY_A],
    assignments: [],
    nodeIdBySlug: { [slug]: NODE_ID },
    activeSlugs: [slug],
    ...over,
  };
}

/** Executa a bateria de enforcement (não lança). */
export function runEnforcementSelfTests(): { ok: boolean; cases: Case[] } {
  const slug = pickSlug();
  const cases: Case[] = [];
  clearEnforcementLog();

  const run = (
    name: string,
    expectAllowed: boolean,
    snap: SubjectSnapshot,
    ctx: Parameters<typeof evaluateWithSnapshot>[2],
  ) => {
    const decision = evaluateWithSnapshot(snap, slug, ctx);
    // Modo estrito: é o comportamento alvo da Fase 4.
    const outcome = resolveOutcome(decision, snap, "strict");
    cases.push({
      name,
      ok: outcome.allowed === expectAllowed,
      detail: `permitido=${outcome.allowed} · aplicado=${outcome.enforced} · ${decision.reason}`,
    });
  };

  // 1) Endpoint protegido: usuário SEM permissão deve falhar.
  run("endpoint protegido bloqueia usuário sem permissão", false, snapshot({}, slug), {
    required: "WRITE",
  });

  // 2) Usuário COM permissão, porém FORA do escopo (outra residência).
  run(
    "endpoint protegido bloqueia escopo incorreto",
    false,
    snapshot({ assignments: [assignment("WRITE", "PROPERTY", PROPERTY_A)], properties: [PROPERTY_A] }, slug),
    { propertyId: PROPERTY_B, required: "READ" },
  );

  // 3) Usuário com permissão E escopo corretos deve passar.
  run(
    "endpoint protegido libera escopo correto",
    true,
    snapshot({ assignments: [assignment("WRITE", "PROPERTY", PROPERTY_A)], properties: [PROPERTY_A] }, slug),
    { propertyId: PROPERTY_A, required: "WRITE" },
  );

  // 4) Modo progressivo: tenant ainda não migrado não é bloqueado (legado).
  {
    const snap = snapshot({}, slug);
    const decision = evaluateWithSnapshot(snap, slug, { required: "WRITE" });
    const outcome = resolveOutcome(decision, snap, "progressive");
    cases.push({
      name: "modo progressivo preserva tenant não migrado",
      ok: outcome.allowed === false && outcome.enforced === false,
      detail: `aplicado=${outcome.enforced} · ${decision.reason}`,
    });
  }

  // 5) Sujeito revogado é bloqueado mesmo no modo progressivo.
  {
    const snap = snapshot({ status: "revoked" }, slug);
    const decision = evaluateWithSnapshot(snap, slug, { required: "READ" });
    const outcome = resolveOutcome(decision, snap, "progressive");
    cases.push({
      name: "sujeito revogado é sempre bloqueado",
      ok: outcome.allowed === false && outcome.enforced === true,
      detail: decision.reason,
    });
  }

  const ok = cases.every((c) => c.ok);
  if (!ok) console.error("[authz][enforce][selftest] falhas", cases.filter((c) => !c.ok));
  return { ok, cases };
}

/** Diagnóstico do enforcement: testes + operações bloqueadas recentes. */
export function enforcementDiagnostics() {
  return { tests: runEnforcementSelfTests(), blockedSample: readEnforcementLog(20) };
}
