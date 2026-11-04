/**
 * B3.1 · o gate é DERIVADO da evidência da suíte Postgres real e só vale para a migration e o
 * adaptador EXATOS que foram testados. Mudou um dos dois ⇒ este teste falha até a suíte real
 * (`GUEST_AI_LEASE_EVIDENCE=write npx vitest run …/b31-lease-pg.test.ts`) rodar de novo.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { B31_LEASE_GATE, LEASE_RUNTIME_CRITERIA } from "@/lib/guest-ai/batch/lease";
import { LEASE_GATE_EVIDENCE } from "@/lib/guest-ai/batch/lease-gate-evidence";

const ROOT = path.resolve(__dirname, "..");
const REPO = path.resolve(ROOT, "..", "..", "..");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

describe("B3.1 · gate derivado da evidência", () => {
  it("gateComplete ⇔ todos os critérios de execução real aprovados na evidência", () => {
    const all = LEASE_RUNTIME_CRITERIA.every((c) => LEASE_GATE_EVIDENCE.criteria[c] === true);
    expect(B31_LEASE_GATE.gateComplete).toBe(all && LEASE_GATE_EVIDENCE.migrationSha256.length === 64 && LEASE_GATE_EVIDENCE.storeSha256.length === 64);
    for (const c of LEASE_RUNTIME_CRITERIA) expect(B31_LEASE_GATE.runtimeCriteria[c]).toBe(LEASE_GATE_EVIDENCE.criteria[c] === true);
  });
  it("a evidência amarra a migration e o adaptador atuais (hash SHA-256)", () => {
    if (!B31_LEASE_GATE.gateComplete) return; // sem evidência completa o gate já está bloqueado
    expect(LEASE_GATE_EVIDENCE.migrationSha256).toBe(sha(path.join(REPO, "supabase/migrations/20261104000000_guest_ai_conversation_leases.sql")));
    expect(LEASE_GATE_EVIDENCE.storeSha256).toBe(sha(path.join(ROOT, "data/lease-store.server.ts")));
    expect(LEASE_GATE_EVIDENCE.postgres).toMatch(/^\d+\.\d+/);
    expect(Number.isFinite(Date.parse(LEASE_GATE_EVIDENCE.generatedAt))).toBe(true);
  });
  it("a evidência é gerada pela suíte real (cabeçalho e formato do gerador)", () => {
    const src = readFileSync(path.join(ROOT, "batch/lease-gate-evidence.ts"), "utf8");
    expect(src).toMatch(/arquivo GERADO pela suíte Postgres real/);
    expect(Object.keys(LEASE_GATE_EVIDENCE.criteria).every((k) => (LEASE_RUNTIME_CRITERIA as readonly string[]).includes(k))).toBe(true);
  });
});
