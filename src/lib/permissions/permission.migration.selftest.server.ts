/**
 * Self-tests da FASE 3.8 — Migration & Activation Control.
 *
 * Executam o núcleo determinístico (decisão do guard + desfecho do enforcement)
 * em cada modo, sem I/O e sem tocar em dados reais.
 */
import { bootstrapPermissionRegistry } from "./permission.bootstrap";
import { resolveOutcome } from "./permission.enforce.server";
import { evaluateWithSnapshot } from "./permission.guard.server";
import {
  canTransition,
  clearDivergences,
  enforcementModeFor,
  isNewEngineAuthoritative,
  readDivergences,
  recordDivergence,
  shouldRecordDivergence,
  type TenantPermissionMode,
} from "./permission.migration.server";
import { permissionRegistry } from "./permission.registry";
import type { SubjectSnapshot } from "./permission.resolve.server";

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NODE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

type Case = { name: string; ok: boolean; detail: string };

function slug(): string {
  bootstrapPermissionRegistry();
  return (
    permissionRegistry.listPermissionable().find((n) => n.slug.startsWith("tenant."))?.slug ??
    "tenant"
  );
}

function snapshot(s: string, over: Partial<SubjectSnapshot> = {}): SubjectSnapshot {
  return {
    subject: { userId: USER, tenantId: TENANT, systemRoles: [], plan: "enterprise" },
    status: "active",
    properties: [],
    assignments: [],
    nodeIdBySlug: { [s]: NODE_ID },
    activeSlugs: [s],
    ...over,
  };
}

/** Bateria completa da Fase 3.8 (não lança). */
export function runMigrationSelfTests(): { ok: boolean; cases: Case[] } {
  const s = slug();
  const cases: Case[] = [];
  clearDivergences();

  const outcomeFor = (mode: TenantPermissionMode, snap: SubjectSnapshot) => {
    const decision = evaluateWithSnapshot(snap, s, { required: "WRITE" });
    return { decision, outcome: resolveOutcome(decision, snap, enforcementModeFor(mode)) };
  };

  // 1) legacy — usuário sem permissão mantém acesso (apenas diagnóstico).
  {
    const { outcome, decision } = outcomeFor("legacy", snapshot(s));
    cases.push({
      name: "tenant legacy mantém acesso",
      ok: outcome.enforced === false,
      detail: `aplicado=${outcome.enforced} · ${decision.reason}`,
    });
  }

  // 2) monitoring — não bloqueia e registra divergência.
  {
    const snap = snapshot(s);
    const { outcome, decision } = outcomeFor("monitoring", snap);
    if (!outcome.enforced && shouldRecordDivergence("monitoring")) {
      recordDivergence({
        tenantId: TENANT,
        userId: USER,
        mode: "monitoring",
        operation: "selftest",
        permission: decision.permission,
        legacyAllowed: true,
        engineAllowed: false,
        reason: decision.reason,
      });
    }
    cases.push({
      name: "tenant monitoring registra divergência sem bloquear",
      ok: outcome.enforced === false && readDivergences(5).length === 1,
      detail: `divergências=${readDivergences(5).length}`,
    });
  }

  // 3) enforced — bloqueia de fato.
  {
    const { outcome, decision } = outcomeFor("enforced", snapshot(s));
    cases.push({
      name: "tenant enforced bloqueia corretamente",
      ok: outcome.allowed === false && outcome.enforced === true,
      detail: decision.reason,
    });
  }

  // 4) completed — somente o novo fluxo decide (bloqueia e não registra divergência).
  {
    const { outcome } = outcomeFor("completed", snapshot(s));
    cases.push({
      name: "tenant completed usa somente o novo fluxo",
      ok:
        outcome.enforced === true &&
        isNewEngineAuthoritative("completed") &&
        shouldRecordDivergence("completed") === false,
      detail: `aplicado=${outcome.enforced}`,
    });
  }

  // 5) Transições exigem avanço controlado (sem saltos automáticos).
  cases.push({
    name: "transições de modo são controladas",
    ok:
      canTransition("legacy", "monitoring") &&
      !canTransition("legacy", "enforced") &&
      !canTransition("monitoring", "completed") &&
      canTransition("enforced", "completed"),
    detail: "legacy→monitoring→enforced→completed",
  });

  clearDivergences();
  const ok = cases.every((c) => c.ok);
  if (!ok) console.error("[authz][migration][selftest] falhas", cases.filter((c) => !c.ok));
  return { ok, cases };
}

export const permissionMigrationSelfTest = { runMigrationSelfTests };
