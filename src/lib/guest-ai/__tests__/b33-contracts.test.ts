/**
 * B3.3 · Entrega 2 — os vocabulários FECHADOS da migration são IGUAIS aos do TypeScript (nenhuma
 * divergência silenciosa entre a validação de valor e as CHECK do banco), e as chaves que a RPC de
 * registro exige são exatamente as colunas que o adaptador envia.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as C from "@/lib/guest-ai/shadow-exec/contracts";
import { LLM_ERROR_CODES } from "@/lib/guest-ai/llm/contracts";
import { recordToRow } from "@/lib/guest-ai/data/shadow-store.server";
import { SHADOW_RPC_FUNCTIONS } from "@/lib/guest-ai/data/client.server";
import { buildExecutionRecord, NO_GATEWAY } from "@/lib/guest-ai/shadow-exec/extract";
import { CONV, EXEC_ID, P_ID, T_ID } from "./helpers/b33-shadow";

const SQL = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20261104120000_guest_ai_shadow.sql"), "utf8");

/** Valores entre aspas simples do CHECK nomeado (até a próxima constraint ou fim da tabela). */
function checkValues(name: string): string[] {
  const start = SQL.indexOf(`constraint ${name} check`);
  if (start < 0) throw new Error(`constraint ausente: ${name}`);
  const rest = SQL.slice(start + name.length + 12);
  const end = rest.search(/\n\s*constraint |\n\);/);
  return [...new Set([...rest.slice(0, end).matchAll(/'([^']+)'/g)].map((m) => m[1]!))];
}
const same = (sql: string[], ts: readonly string[]) => expect([...sql].sort()).toEqual([...ts].sort());

describe("B3.3 · vocabulários SQL = TypeScript", () => {
  const pairs: Array<[string, readonly string[]]> = [
    ["gasc_state_ck", C.SHADOW_STATES],
    ["gast_from_ck", C.SHADOW_STATES],
    ["gast_to_ck", C.SHADOW_STATES],
    ["gasc_reason_ck", C.SHADOW_TRANSITION_REASONS],
    ["gast_reason_ck", C.SHADOW_TRANSITION_REASONS],
    ["gasc_model_ck", C.SHADOW_ALLOWED_MODELS],
    ["gase_model_ck", C.SHADOW_ALLOWED_MODELS],
    ["gasc_effort_ck", C.SHADOW_REASONING_EFFORTS],
    ["gasc_retention_scope_ck", C.RETENTION_SCOPES],
    ["gasm_reason_ck", C.MANIFEST_SELECTION_REASONS],
    ["gasm_twin_ck", C.MANIFEST_CHECK_STATUSES],
    ["gasm_history_ck", C.MANIFEST_CHECK_STATUSES],
    ["gase_channel_ck", C.SHADOW_CHANNELS],
    ["gase_decision_ck", C.SHADOW_DECISIONS],
    ["gase_strategy_ck", C.SHADOW_STRATEGIES],
    ["gase_intents_ck", C.SHADOW_INTENTS],
    ["gase_kinds_ck", C.SHADOW_COMMITMENT_KINDS],
    ["gase_urgency_ck", C.SHADOW_URGENCIES],
    ["gase_pause_ck", C.SHADOW_PAUSE_STATES],
    ["gase_context_ck", C.SHADOW_CONTEXT_CHECKS],
    ["gase_exec_state_ck", C.SHADOW_EXECUTION_STATES],
    ["gase_usage_ck", C.SHADOW_USAGE_SOURCES],
    ["gase_gateway_error_ck", LLM_ERROR_CODES],
    ["gase_budget_ck", C.BUDGET_LIMIT_IDS],
    ["gase_refusal_ck", C.CHAIN_REFUSAL_CODES],
    ["gase_technical_ck", C.SHADOW_TECHNICAL_CODES],
    ["gase_block_ck", C.SHADOW_BLOCK_CODES],
    ["gase_integrity_ck", C.INTEGRITY_CODES],
  ];
  for (const [name, ts] of pairs) it(`${name} = TS`, () => same(checkValues(name), ts));

  it("decisões fora do denominador (coluna gerada `evaluable`) = NON_EVALUABLE_DECISIONS", () => {
    const m = /evaluable\s+boolean generated always as \(decision not in \(([^)]*)\)\)/.exec(SQL)!;
    same([...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!), C.NON_EVALUABLE_DECISIONS);
  });
  it("teto diário no banco = teto aprovado (US$ 1,00); saída máxima = Gateway", () => {
    expect(SQL).toMatch(/daily_cost_limit_usd > 0 and daily_cost_limit_usd <= 1\.00/);
    expect(C.APPROVED_DAILY_COST_CEILING_USD).toBe(1);
    expect(SQL).toMatch(/max_output_tokens > 0 and max_output_tokens <= 4096/);
  });
  it("chaves exigidas por shadow_record_execution = colunas enviadas pelo adaptador", () => {
    const m = /v_expected constant text\[\] := array\[([\s\S]*?)\];/.exec(SQL)!;
    const sqlKeys = [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!);
    const rec = buildExecutionRecord(null, { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: null, startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z", totalMs: 0, leaseMs: 0, contextMs: 0, gatewayMs: 0, validationMs: 0, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "not_evaluated", executionState: "blocked", technicalCode: null, blockCode: "not_in_manifest", integrityCode: null, budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "blocked_not_authorized" }, "c");
    same(sqlKeys, Object.keys(recordToRow(rec)));
    expect(new Set(sqlKeys).size).toBe(sqlKeys.length);
  });
  it("a porta do worker só contém RPCs com EXECUTE para service_role na migration", () => {
    const grants = /RPCs da lista fechada[\s\S]*?foreach f in array array\[([\s\S]*?)\] loop/.exec(SQL)!;
    const granted = [...grants[1]!.matchAll(/public\.(\w+)\(/g)].map((x) => x[1]!);
    for (const fn of SHADOW_RPC_FUNCTIONS) expect(granted, fn).toContain(fn);
  });
  it("estado inicial da migration: disabled, sem manifesto, sem retenção, só o teto aprovado", () => {
    expect(SQL).toMatch(/insert into public\.guest_ai_shadow_control \(id, state, daily_cost_limit_usd\) values \(1, 'disabled', 1\.00\);/);
    // só o que a migration EXECUTA (fora dos corpos de função): nenhum manifesto, nenhum ready/running
    const topLevel = SQL.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(topLevel).not.toMatch(/insert into public\.guest_ai_shadow_manifest/i);
    expect(topLevel).not.toMatch(/insert into public\.guest_ai_shadow_(executions|budget|transitions|access_log)/i);
    expect(topLevel.match(/insert into /gi)).toHaveLength(1);
    expect(topLevel).not.toMatch(/'running'\)|'ready'\)|retention_scope\s*=\s*'/);
  });
  it("prazo aprovado: 15 s absolutos, 1,5 s de finalização, 13,5 s de processamento", () => {
    expect([C.SHADOW_DEADLINE_MS, C.SHADOW_FINALIZATION_RESERVE_MS, C.SHADOW_PROCESSING_BUDGET_MS]).toEqual([15_000, 1_500, 13_500]);
  });
  it("formatos fechados", () => {
    expect(C.UUID_RE.test(EXEC_ID)).toBe(true);
    expect(C.VERSION_RE.test("chain.2026-11-03.3")).toBe(true);
    expect(C.VERSION_RE.test("Chain v1")).toBe(false);
    expect(C.EVIDENCE_REF_RE.test("a".repeat(64))).toBe(true);
    expect(C.IANA_ZONE_RE.test("America/Sao_Paulo")).toBe(true);
    expect(C.IANA_ZONE_RE.test("UTC+3")).toBe(false);
  });
});
