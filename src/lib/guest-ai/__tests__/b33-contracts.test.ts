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

const SQL_SHADOW = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20261104120000_guest_ai_shadow.sql"), "utf8");
// E4 global: o escopo, a elegibilidade e os interruptores vivem na migration global
const SQL_GLOBAL = readFileSync(path.resolve(__dirname, "../../../../supabase/migrations/20261105120000_guest_ai_shadow_global.sql"), "utf8");
const SQL = SQL_SHADOW;

/** Valores entre aspas simples do CHECK nomeado (até a próxima constraint ou fim da tabela). */
function checkValues(name: string): string[] {
  const src = SQL_SHADOW.includes(`constraint ${name} check`) ? SQL_SHADOW : SQL_GLOBAL;
  const start = src.indexOf(`constraint ${name} check`);
  if (start < 0) throw new Error(`constraint ausente: ${name}`);
  const rest = src.slice(start + name.length + 12);
  const end = rest.search(/\n\s*(add )?constraint |\n\);|;\n/);
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
    // E4 global: escopo e motivos de inelegibilidade (sem manifesto)
    ["gaspe_reason_ck", C.ELIGIBILITY_REASONS],
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
    const rec = buildExecutionRecord(null, { executionId: EXEC_ID, tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: null, startedAt: "2026-11-03T10:00:00.000Z", finishedAt: "2026-11-03T10:00:00.000Z", totalMs: 0, leaseMs: 0, contextMs: 0, gatewayMs: 0, validationMs: 0, gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "not_evaluated", executionState: "blocked", technicalCode: null, blockCode: "property_ineligible", integrityCode: null, budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "blocked_not_authorized" }, "c");
    same(sqlKeys, Object.keys(recordToRow(rec)));
    expect(new Set(sqlKeys).size).toBe(sqlKeys.length);
  });
  it("escopo global: vocabulário do controle = PROPERTY_SCOPES; motivos da porta = PROPERTY_GATE_REASONS", () => {
    same(checkValues("gasc_scope_ck"), C.PROPERTY_SCOPES);
    const gate = /function public\.guest_ai_shadow_property_gate[\s\S]*?\$function\$;/.exec(SQL_GLOBAL)![0];
    const elig = /function public\.guest_ai_shadow_eligibility_reason[\s\S]*?\$function\$;/.exec(SQL_GLOBAL)![0];
    const returned = [...`${gate}\n${elig}`.matchAll(/return '([a-z_]+)'/g)].map((m) => m[1]!);
    same([...new Set(returned)], C.PROPERTY_GATE_REASONS);
  });
  it("a porta do worker só contém RPCs com EXECUTE para service_role nas migrations", () => {
    const grants = /RPCs do WORKER \(lista fechada\)[\s\S]*?foreach f in array array\[([\s\S]*?)\] loop/.exec(SQL_SHADOW)!;
    const grantsGlobal = /RPCs do WORKER \(novas ou redefinidas\)[\s\S]*?foreach f in array array\[([\s\S]*?)\] loop/.exec(SQL_GLOBAL)!;
    const granted = [...`${grants[1]!}${grantsGlobal[1]!}`.matchAll(/public\.(\w+)\(/g)].map((x) => x[1]!);
    for (const fn of SHADOW_RPC_FUNCTIONS) expect(granted, fn).toContain(fn);
  });
  it("estado inicial da migration: disabled, nenhum imóvel ativo, sem retenção, só o teto aprovado", () => {
    expect(SQL).toMatch(/insert into public\.guest_ai_shadow_control \(id, state, daily_cost_limit_usd\) values \(1, 'disabled', 1\.00\);/);
    // só o que a migration EXECUTA (fora dos corpos de função): nenhum ready/running, nenhum escopo aberto
    const topLevel = SQL.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(SQL).not.toMatch(/guest_ai_shadow_manifest/);
    const globalTop = SQL_GLOBAL.replace(/\$function\$[\s\S]*?\$function\$/g, "");
    expect(globalTop.match(/insert into /gi)).toBeNull();
    expect(globalTop).toMatch(/add column property_scope\s+text not null default 'none'/);
    expect(globalTop).not.toMatch(/'all_eligible'\s*[,)]\s*;|property_scope\s*=\s*'all_eligible'/);
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
