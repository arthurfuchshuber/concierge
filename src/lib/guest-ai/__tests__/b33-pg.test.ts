/**
 * B3.3 · Entrega 2 — migration `20261104120000_guest_ai_shadow.sql` contra POSTGRES REAL (cluster local
 * temporário; cada consulta = conexão independente). Nada toca a produção. Cobre: RLS/privilégios,
 * vocabulários fechados (texto livre impossível), RPC de registro com canários, CAS e matriz de
 * transições, reserva atômica concorrente sob o teto de US$ 1,00, reserva órfã, liquidação, disjuntores
 * (5 % exato × acima, consecutivas, integridade, medição), paridade TS × SQL, manifesto, relatório
 * auditado, expurgo e o adaptador `createShadowStore` contra o banco.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PG_AVAILABLE, SHADOW_MIGRATION_PATH, startCluster, type PgCluster } from "./pg/pg-cluster";
import { buildExecutionRecord, NO_GATEWAY, validateExecutionRecord, type ExecutionMeta } from "@/lib/guest-ai/shadow-exec/extract";
import { createShadowStore, recordToRow } from "@/lib/guest-ai/data/shadow-store.server";
import { evaluateErrorBreaker, isEvaluable, isTechnicalError } from "@/lib/guest-ai/shadow-exec/breakers";
import type { ShadowDecision, ShadowExecutionRecord } from "@/lib/guest-ai/shadow-exec/contracts";
import { CANARY, CONV, P_ID, T_ID, OTHER_T } from "./helpers/b33-shadow";

let pg: PgCluster;
let seq = 0;
const uid = (p = "e0000000") => `${p}-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const SR = { role: "service_role" };
const ACTOR = "ac000000-0000-4000-8000-000000000001";
const EVID = "a".repeat(64);
type J = Record<string, unknown> & { result?: string };
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const rpc = async (fn: string, args: Record<string, unknown> = {}, role = SR): Promise<J> => {
  const a = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  return JSON.parse(await pg.sql(`select public.${fn}(${a})`, role)) as J;
};
const one = async (q: string) => pg.sql(q);
const control = () => rpc("shadow_get_control");

const meta = (over: Partial<ExecutionMeta> = {}): ExecutionMeta => ({
  executionId: uid(), tenantId: T_ID, propertyId: P_ID, conversationId: CONV, channel: "web", batchId: null, leaseVersion: null, modelId: "openai/gpt-5.6-sol",
  startedAt: "2026-11-03T10:00:00.000Z", finishedAt: new Date().toISOString(), totalMs: 10, leaseMs: 1, contextMs: 2, gatewayMs: 3, validationMs: 4,
  gateway: NO_GATEWAY, estimatedInputTokens: null, pauseState: "inactive", executionState: "completed", technicalCode: null, blockCode: null, integrityCode: null,
  budgetExceeded: null, tokenLimitViolation: false, concurrencyDetected: false, forcedDecision: "operational_restriction", ...over,
});
const recordOf = (decision: ShadowDecision, over: Partial<ExecutionMeta> = {}): ShadowExecutionRecord => {
  const extra: Partial<ExecutionMeta> =
    decision === "technical_failure" ? { technicalCode: "read_failed", executionState: "failed" }
    : decision === "integrity_violation" ? { integrityCode: "cross_tenant", executionState: "blocked" }
    : {};
  const r = validateExecutionRecord(buildExecutionRecord(null, meta({ forcedDecision: decision, ...extra, ...over }), "chain.2026-11-03.3"));
  if (!r) throw new Error("fixture inválida");
  return r;
};
const record = (r: ShadowExecutionRecord | Record<string, unknown>) => rpc("shadow_record_execution", { p_record: "executionId" in r ? recordToRow(r as ShadowExecutionRecord) : r });

/** Volta ao estado inicial da migration (só o dono, no teste). */
async function reset() {
  await pg.sql(`truncate public.guest_ai_shadow_executions, public.guest_ai_shadow_budget_reservations, public.guest_ai_shadow_budget_days, public.guest_ai_shadow_transitions, public.guest_ai_shadow_access_log, public.guest_ai_shadow_manifest`);
  await pg.sql(`delete from public.guest_ai_shadow_control; insert into public.guest_ai_shadow_control (id, state, daily_cost_limit_usd) values (1, 'disabled', 1.00)`);
}
/** Leva até `running` pelo caminho AUTORIZADO (manifesto → configuração → retenção → ready → running). */
async function toRunning(over: Record<string, unknown> = {}) {
  await rpc("shadow_manifest_add", { p_actor: ACTOR, p_manifest_version: 1, p_tenant_id: T_ID, p_property_id: P_ID, p_selection_reason: "highest_volume", p_twin_status: "verified", p_history_status: "verified" });
  let v = Number((await control()).state_version);
  const cfg = await rpc("shadow_configure", {
    p_expected_version: v, p_actor: ACTOR, p_model_id: "openai/gpt-5.6-sol", p_reasoning_effort: "low", p_max_input_tokens: 60000, p_max_output_tokens: 1024,
    p_max_total_tokens: 70000, p_max_turn_cost_usd: 0.5, p_daily_cost_limit_usd: 1.0, p_max_daily_tokens: 5000000, p_max_daily_calls: 500, p_error_window_minutes: 60,
    p_error_min_sample: 20, p_budget_day_timezone: "America/Sao_Paulo", p_telemetry_retention_days: 30, p_tick_interval_seconds: 60, p_max_conversations_per_tick: 5,
    p_manifest_version: 1, ...over,
  });
  expect(cfg.result).toBe("applied");
  v = Number(cfg.state_version);
  const ret = await rpc("shadow_authorize_retention", { p_expected_version: v, p_actor: ACTOR, p_scope: "openai_responses", p_evidence_sha256: EVID });
  expect(ret.result).toBe("applied");
  const rd = await rpc("shadow_transition", { p_expected_version: Number(ret.state_version), p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation" });
  expect(rd.result).toBe("applied");
  const run = await rpc("shadow_transition", { p_expected_version: Number(rd.state_version), p_to: "running", p_actor: ACTOR, p_reason: "authorized_activation" });
  expect(run.result).toBe("applied");
}

const TABLES = ["guest_ai_shadow_control", "guest_ai_shadow_transitions", "guest_ai_shadow_manifest", "guest_ai_shadow_executions", "guest_ai_shadow_budget_days", "guest_ai_shadow_budget_reservations", "guest_ai_shadow_access_log"];
const RPCS = ["shadow_get_control", "shadow_get_manifest", "shadow_manifest_add", "shadow_configure", "shadow_authorize_retention", "shadow_transition", "shadow_trip", "shadow_reserve_budget", "shadow_settle_budget", "shadow_evaluate_breakers", "shadow_record_execution", "shadow_report", "shadow_purge_expired"];
const INTERNAL = ["guest_ai_shadow_config_problem", "guest_ai_shadow_error_verdict", "guest_ai_shadow_trip_locked"];

describe.skipIf(!PG_AVAILABLE)("B3.3 · migration Shadow — Postgres real", () => {
  beforeAll(async () => {
    pg = startCluster([SHADOW_MIGRATION_PATH]);
    await pg.sql(`insert into public.properties (id, owner_id) values ('${P_ID}', '${T_ID}'), ('b0000000-0000-4000-8000-0000000000aa', '${T_ID}')`);
    await pg.sql(`insert into public.properties (id, owner_id, archived_at) values ('b0000000-0000-4000-8000-0000000000bb', '${T_ID}', now())`);
  }, 120_000);
  afterAll(() => pg?.stop());
  beforeEach(reset);

  describe("segurança do banco", () => {
    it("estado inicial: disabled, versão 1, só o teto aprovado (US$ 1,00), sem manifesto nem retenção", async () => {
      const c = await control();
      expect(c).toMatchObject({ result: "ok", state: "disabled", state_version: 1, daily_cost_limit_usd: 1, manifest_version: null, retention_authorized: false, model_id: null, max_turn_cost_usd: null, max_daily_calls: null });
      expect(await one("select count(*) from public.guest_ai_shadow_manifest")).toBe("0");
    });
    it("RLS ligada em todas as tabelas, sem política; nenhuma coluna json/jsonb", async () => {
      for (const t of TABLES) {
        expect(await one(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`), t).toBe("t");
        expect(await one(`select count(*) from pg_policy where polrelid = 'public.${t}'::regclass`), t).toBe("0");
      }
      expect(await one(`select count(*) from information_schema.columns where table_schema='public' and table_name like 'guest_ai_shadow_%' and data_type in ('json','jsonb')`)).toBe("0");
    });
    it("toda coluna de texto tem CHECK (vocabulário fechado ou formato) — texto livre é impossível", async () => {
      const textCols = (await one(`select table_name || '.' || column_name from information_schema.columns where table_schema='public' and table_name like 'guest_ai_shadow_%' and data_type in ('text','character varying','ARRAY') order by 1`)).split("\n");
      expect(textCols.length).toBeGreaterThan(20);
      for (const tc of textCols) {
        const [t, c] = tc.split(".");
        const n = await one(`select count(*) from pg_constraint where conrelid = 'public.${t}'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ '\\m${c}\\M'`);
        expect(Number(n), tc).toBeGreaterThan(0);
      }
    });
    it("nenhum DML direto para anon/authenticated/service_role (nem leitura)", async () => {
      for (const role of ["anon", "authenticated", "service_role"]) {
        for (const t of TABLES) {
          const r = await pg.trySql(`select 1 from public.${t} limit 1`, { role });
          expect(r.ok, `${role} select ${t}`).toBe(false);
        }
        expect((await pg.trySql(`update public.guest_ai_shadow_control set state = 'running'`, { role })).ok).toBe(false);
        expect((await pg.trySql(`insert into public.guest_ai_shadow_access_log (actor, report, tenant_id, from_at, to_at) values ('${ACTOR}', 'daily_cost', '${T_ID}', now(), now() + interval '1 h')`, { role })).ok).toBe(false);
      }
    });
    it("RPCs: EXECUTE só service_role; internas sem EXECUTE para ninguém; todas SECURITY DEFINER com search_path fixo", async () => {
      for (const fn of RPCS) {
        expect(await one(`select prosecdef from pg_proc where proname = '${fn}'`), fn).toBe("t");
        expect(await one(`select array_to_string(proconfig, ',') from pg_proc where proname = '${fn}'`), fn).toBe("search_path=pg_catalog, pg_temp");
        expect(await one(`select has_function_privilege('service_role', oid, 'execute') from pg_proc where proname = '${fn}'`), fn).toBe("t");
        for (const role of ["anon", "authenticated"]) expect(await one(`select has_function_privilege('${role}', oid, 'execute') from pg_proc where proname = '${fn}'`), `${role} ${fn}`).toBe("f");
      }
      for (const fn of INTERNAL) {
        for (const role of ["anon", "authenticated", "service_role"]) expect(await one(`select has_function_privilege('${role}', oid, 'execute') from pg_proc where proname = '${fn}'`), `${role} ${fn}`).toBe("f");
      }
      expect((await pg.trySql(`select public.shadow_get_control()`, { role: "anon" })).ok).toBe(false);
    });
  });

  describe("registro de execução: chaves exatas, vocabulário fechado, canários nunca gravados", () => {
    beforeEach(() => toRunning());
    it("registro válido gravado; duplicata do mesmo lote não entra duas vezes", async () => {
      const batch = uid("b1000000");
      expect(await record(recordOf("answer_candidate", { batchId: batch }))).toMatchObject({ result: "recorded", breaker: "ok" });
      expect(await record(recordOf("answer_candidate", { batchId: batch }))).toEqual({ result: "duplicate" });
      expect(await one("select count(*) from public.guest_ai_shadow_executions")).toBe("1");
    });
    it("canário em QUALQUER coluna textual, chave a mais/a menos, objeto aninhado ⇒ invalid_argument e NADA gravado", async () => {
      const good = recordToRow(recordOf("answer_candidate"));
      const variants: Array<Record<string, unknown>> = [];
      for (const k of ["decision", "channel", "chain_version", "shadow_version", "composer_version", "model_id", "strategy", "handoff_urgency", "pause_state", "context_check", "execution_state", "usage_source", "gateway_error", "budget_exceeded", "refusal_code", "technical_code", "block_code", "integrity_code"]) {
        variants.push({ ...good, execution_id: uid(), [k]: CANARY });
      }
      variants.push({ ...good, execution_id: uid(), intents: [CANARY] });
      variants.push({ ...good, execution_id: uid(), commitment_kinds: [CANARY] });
      variants.push({ ...good, execution_id: uid(), reply: CANARY });
      variants.push({ ...good, execution_id: uid(), decision: { text: CANARY } });
      variants.push({ ...good, execution_id: uid(), total_ms: CANARY });
      variants.push({ ...good, execution_id: uid(), tenant_id: CANARY });
      variants.push({ ...good, execution_id: uid(), started_at: CANARY });
      variants.push({ ...good, execution_id: uid(), response_discarded: false });
      variants.push({ ...good, execution_id: uid(), candidate_available: false });
      variants.push({ ...good, execution_id: uid(), decision: "technical_failure", candidate_available: false, technical_code: null });
      const missing = { ...good, execution_id: uid() };
      delete (missing as Record<string, unknown>).decision;
      variants.push(missing);
      for (const v of variants) expect(await record(v), JSON.stringify(v).slice(0, 80)).toEqual({ result: "invalid_argument" });
      expect(await rpc("shadow_record_execution", { p_record: [] })).toEqual({ result: "invalid_argument" });
      expect(await rpc("shadow_record_execution", { p_record: null })).toEqual({ result: "invalid_argument" });
      expect(await one("select count(*) from public.guest_ai_shadow_executions")).toBe("0");
      expect(await one(`select count(*) from public.guest_ai_shadow_executions e where e::text like '%${CANARY}%'`)).toBe("0");
    });
    it("INSERT direto (como dono) com texto livre também é recusado pelas CHECK", async () => {
      const r = await pg.trySql(`insert into public.guest_ai_shadow_transitions (from_state, to_state, state_version, actor, automatic, reason_code) values ('running', 'circuit_open', 2, null, true, '${CANARY}')`);
      expect(r.ok).toBe(false);
      const r2 = await pg.trySql(`insert into public.guest_ai_shadow_manifest (manifest_version, tenant_id, property_id, selection_reason, twin_status, history_status, authorized_by) values (9, '${T_ID}', '${P_ID}', '${CANARY}', 'verified', 'verified', '${ACTOR}')`);
      expect(r2.ok).toBe(false);
    });
  });

  describe("estado global: CAS, matriz de transições, nenhuma saída automática de falha", () => {
    it("ready/running exigem configuração COMPLETA (retenção, modelo, limites, manifesto)", async () => {
      expect(await rpc("shadow_transition", { p_expected_version: 1, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation" })).toEqual({ result: "config_incomplete", problem: "retention_not_authorized" });
      expect((await rpc("shadow_authorize_retention", { p_expected_version: 1, p_actor: ACTOR, p_scope: "openai_responses", p_evidence_sha256: EVID })).result).toBe("applied");
      expect(await rpc("shadow_transition", { p_expected_version: 2, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation" })).toEqual({ result: "config_incomplete", problem: "model_not_allowed" });
      const cfg = await rpc("shadow_configure", { p_expected_version: 2, p_actor: ACTOR, p_model_id: "openai/gpt-5.6-sol", p_reasoning_effort: null, p_max_input_tokens: null, p_max_output_tokens: null, p_max_total_tokens: null, p_max_turn_cost_usd: null, p_daily_cost_limit_usd: 1, p_max_daily_tokens: null, p_max_daily_calls: null, p_error_window_minutes: null, p_error_min_sample: null, p_budget_day_timezone: null, p_telemetry_retention_days: null, p_tick_interval_seconds: null, p_max_conversations_per_tick: null, p_manifest_version: null });
      expect(cfg.result).toBe("applied");
      expect(await rpc("shadow_transition", { p_expected_version: 3, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation" })).toEqual({ result: "config_incomplete", problem: "limits_missing" });
    });
    it("caminho autorizado até running; transições registradas com autor e motivo", async () => {
      await toRunning();
      expect((await control()).state).toBe("running");
      expect(await one(`select string_agg(from_state || '>' || to_state || ':' || reason_code || ':' || (actor is not null)::text, ',' order by id) from public.guest_ai_shadow_transitions`)).toBe("disabled>ready:authorized_activation:true,ready>running:authorized_activation:true");
    });
    it("CAS: versão errada ⇒ stale_version; sem autor ou motivo inválido ⇒ invalid_argument", async () => {
      expect(await rpc("shadow_transition", { p_expected_version: 99, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation" })).toMatchObject({ result: "stale_version", state_version: 1 });
      expect((await rpc("shadow_transition", { p_expected_version: 1, p_to: "ready", p_actor: null, p_reason: "authorized_activation" })).result).toBe("invalid_argument");
      expect((await rpc("shadow_transition", { p_expected_version: 1, p_to: "ready", p_actor: ACTOR, p_reason: "error_rate_exceeded" })).result).toBe("invalid_argument");
      expect((await rpc("shadow_transition", { p_expected_version: 1, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation", p_evidence_sha256: CANARY })).result).toBe("invalid_argument");
      expect((await rpc("shadow_transition", { p_expected_version: 1, p_to: "circuit_open", p_actor: ACTOR, p_reason: "authorized_disable" })).result).toBe("invalid_transition");
      expect((await rpc("shadow_transition", { p_expected_version: 1, p_to: "running", p_actor: ACTOR, p_reason: "authorized_activation" })).result).toBe("invalid_transition");
    });
    it("disparo automático só a partir de running e só para falha; falha NUNCA volta sozinha a running", async () => {
      expect(await rpc("shadow_trip", { p_to: "circuit_open", p_reason: "error_rate_exceeded" })).toMatchObject({ result: "noop", state: "disabled" });
      await toRunning();
      expect(await rpc("shadow_trip", { p_to: "running", p_reason: "error_rate_exceeded" })).toEqual({ result: "invalid_argument" });
      expect(await rpc("shadow_trip", { p_to: "circuit_open", p_reason: "authorized_resume" })).toEqual({ result: "invalid_argument" });
      const t = await rpc("shadow_trip", { p_to: "circuit_open", p_reason: "error_rate_exceeded" });
      expect(t).toMatchObject({ result: "applied", state: "circuit_open" });
      const v = Number(t.state_version);
      expect(await rpc("shadow_trip", { p_to: "technical_failure", p_reason: "telemetry_failure" })).toMatchObject({ result: "noop", state: "circuit_open" });
      expect((await rpc("shadow_transition", { p_expected_version: v, p_to: "running", p_actor: ACTOR, p_reason: "authorized_resume" })).result).toBe("invalid_transition");
      expect((await rpc("shadow_transition", { p_expected_version: v, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_recovery" })).result).toBe("invalid_transition"); // sem referência
      expect(await rpc("shadow_transition", { p_expected_version: v, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_recovery", p_evidence_sha256: EVID })).toMatchObject({ result: "applied", state: "ready" });
      expect(await one(`select count(*) from public.guest_ai_shadow_transitions where automatic and actor is null and to_state = 'circuit_open'`)).toBe("1");
    });
    it("integridade escala de qualquer estado ativo/falha e só sai para disabled, com referência da correção", async () => {
      await toRunning();
      await rpc("shadow_trip", { p_to: "circuit_open", p_reason: "error_rate_exceeded" });
      const t = await rpc("shadow_trip", { p_to: "integrity_violation", p_reason: "integrity_divergence" });
      expect(t).toMatchObject({ result: "applied", state: "integrity_violation" });
      const v = Number(t.state_version);
      expect((await rpc("shadow_transition", { p_expected_version: v, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_recovery", p_evidence_sha256: EVID })).result).toBe("invalid_transition");
      expect((await rpc("shadow_transition", { p_expected_version: v, p_to: "disabled", p_actor: ACTOR, p_reason: "authorized_disable" })).result).toBe("invalid_transition");
      expect(await rpc("shadow_transition", { p_expected_version: v, p_to: "disabled", p_actor: ACTOR, p_reason: "authorized_disable", p_evidence_sha256: EVID })).toMatchObject({ result: "applied", state: "disabled" });
    });
    it("pausa/retomada autorizadas; configuração e retenção nunca mudam em ready/running; revogar retenção em running desliga", async () => {
      await toRunning();
      let v = Number((await control()).state_version);
      expect((await rpc("shadow_configure", { p_expected_version: v, p_actor: ACTOR, p_model_id: null, p_reasoning_effort: null, p_max_input_tokens: null, p_max_output_tokens: null, p_max_total_tokens: null, p_max_turn_cost_usd: null, p_daily_cost_limit_usd: null, p_max_daily_tokens: null, p_max_daily_calls: null, p_error_window_minutes: null, p_error_min_sample: null, p_budget_day_timezone: null, p_telemetry_retention_days: null, p_tick_interval_seconds: null, p_max_conversations_per_tick: null, p_manifest_version: null })).result).toBe("invalid_transition");
      expect((await rpc("shadow_authorize_retention", { p_expected_version: v, p_actor: ACTOR, p_scope: "openai_responses", p_evidence_sha256: EVID })).result).toBe("invalid_transition");
      const p = await rpc("shadow_transition", { p_expected_version: v, p_to: "paused", p_actor: ACTOR, p_reason: "authorized_pause" });
      expect(p.state).toBe("paused");
      const r = await rpc("shadow_transition", { p_expected_version: Number(p.state_version), p_to: "running", p_actor: ACTOR, p_reason: "authorized_resume" });
      expect(r.state).toBe("running");
      v = Number(r.state_version);
      expect((await rpc("shadow_authorize_retention", { p_expected_version: v, p_actor: ACTOR, p_scope: null, p_evidence_sha256: null })).result).toBe("applied");
      expect(await control()).toMatchObject({ state: "disabled", retention_authorized: false });
      expect((await rpc("shadow_authorize_retention", { p_expected_version: v + 1, p_actor: ACTOR, p_scope: "openai_responses", p_evidence_sha256: null })).result).toBe("invalid_argument");
      expect((await rpc("shadow_authorize_retention", { p_expected_version: v + 1, p_actor: ACTOR, p_scope: "google", p_evidence_sha256: EVID })).result).toBe("invalid_argument");
      expect((await rpc("shadow_authorize_retention", { p_expected_version: 1, p_actor: ACTOR, p_scope: "openai_responses", p_evidence_sha256: EVID })).result).toBe("stale_version");
    });
    it("configuração recusa modelo Google, teto diário acima de US$ 1,00, fuso inexistente e manifesto inexistente", async () => {
      const base = { p_expected_version: 1, p_actor: ACTOR, p_model_id: "openai/gpt-5.6-sol", p_reasoning_effort: "low", p_max_input_tokens: 1, p_max_output_tokens: 1, p_max_total_tokens: 1, p_max_turn_cost_usd: 0.1, p_daily_cost_limit_usd: 1, p_max_daily_tokens: 1, p_max_daily_calls: 1, p_error_window_minutes: 1, p_error_min_sample: 2, p_budget_day_timezone: "America/Sao_Paulo", p_telemetry_retention_days: 1, p_tick_interval_seconds: 1, p_max_conversations_per_tick: 1, p_manifest_version: null };
      for (const bad of [{ p_model_id: "google/gemini-3.8-flash" }, { p_daily_cost_limit_usd: 1.01 }, { p_max_output_tokens: 5000 }, { p_error_min_sample: 1 }, { p_budget_day_timezone: "Mars/Olympus" }, { p_manifest_version: 3 }, { p_max_daily_calls: -1 }, { p_actor: null }]) {
        expect((await rpc("shadow_configure", { ...base, ...bad })).result, JSON.stringify(bad)).toBe("invalid_argument");
      }
      expect((await rpc("shadow_configure", { ...base, p_expected_version: 5 })).result).toBe("stale_version");
      expect((await rpc("shadow_configure", base)).result).toBe("applied");
    });
  });

  describe("orçamento: reserva atômica, teto de US$ 1,00, órfã nunca libera, liquidação", () => {
    it("fora de running ⇒ state_not_running; argumentos inválidos recusados; limites por turno", async () => {
      expect((await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 10, p_cost: 0.01, p_calls: 1 })).result).toBe("state_not_running");
      await toRunning();
      for (const bad of [{ p_tokens: 0 }, { p_cost: 0 }, { p_calls: 3 }, { p_execution_id: null }]) {
        expect((await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 10, p_cost: 0.01, p_calls: 1, ...bad })).result).toBe("invalid_argument");
      }
      expect(await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 10, p_cost: 0.6, p_calls: 2 })).toEqual({ result: "exceeded", limit: "turn_cost" });
      expect(await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 140001, p_cost: 0.01, p_calls: 2 })).toEqual({ result: "exceeded", limit: "turn_total_tokens" });
      const id = uid();
      expect((await rpc("shadow_reserve_budget", { p_execution_id: id, p_tokens: 10, p_cost: 0.01, p_calls: 1 })).result).toBe("reserved");
      expect((await rpc("shadow_reserve_budget", { p_execution_id: id, p_tokens: 10, p_cost: 0.01, p_calls: 1 })).result).toBe("duplicate");
    });
    it("40 reservas CONCORRENTES de US$ 0,05: exatamente 20 cabem; o total nunca passa de US$ 1,00; estouro ⇒ budget_exhausted", async () => {
      await toRunning();
      const results = await Promise.all(Array.from({ length: 40 }, () => rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 100, p_cost: 0.05, p_calls: 1 })));
      const reserved = results.filter((r) => r.result === "reserved").length;
      expect(reserved).toBe(20);
      expect(results.filter((r) => !["reserved", "exceeded", "state_not_running"].includes(String(r.result)))).toEqual([]);
      expect(Number(await one(`select sum(reserved_cost + settled_cost) from public.guest_ai_shadow_budget_days`))).toBeLessThanOrEqual(1);
      expect((await control()).state).toBe("budget_exhausted");
    });
    it("reserva órfã (worker morto) continua contada: não libera saldo", async () => {
      await toRunning();
      for (let i = 0; i < 19; i++) expect((await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 100, p_cost: 0.05, p_calls: 1 })).result).toBe("reserved");
      // nenhuma liquidação: as 19 ficam abertas; só cabe mais 0,05
      expect((await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 100, p_cost: 0.05, p_calls: 1 })).result).toBe("reserved");
      expect(await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 100, p_cost: 0.01, p_calls: 1 })).toEqual({ result: "exceeded", limit: "daily_cost" });
      expect(await one(`select open_reservations from public.guest_ai_shadow_budget_days`)).toBe("20");
    });
    it("liquidação troca a reserva pelo real, uma vez só; real que atinge o teto ⇒ budget_exhausted", async () => {
      await toRunning();
      const r = await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 1000, p_cost: 0.4, p_calls: 2 });
      expect(await rpc("shadow_settle_budget", { p_reservation_id: r.reservation_id, p_tokens: 300, p_cost: 0.1, p_calls: 1 })).toEqual({ result: "settled", budget: "available" });
      expect(await one(`select reserved_cost::text || '|' || settled_cost::text || '|' || open_reservations from public.guest_ai_shadow_budget_days`)).toBe("0.00000000|0.10000000|0");
      expect(await rpc("shadow_settle_budget", { p_reservation_id: r.reservation_id, p_tokens: 1, p_cost: 0.1, p_calls: 1 })).toEqual({ result: "already_settled" });
      expect(await rpc("shadow_settle_budget", { p_reservation_id: uid(), p_tokens: 1, p_cost: 0.1, p_calls: 1 })).toEqual({ result: "not_found" });
      expect((await rpc("shadow_settle_budget", { p_reservation_id: r.reservation_id, p_tokens: -1, p_cost: 0.1, p_calls: 1 })).result).toBe("invalid_argument");
      const r2 = await rpc("shadow_reserve_budget", { p_execution_id: uid(), p_tokens: 1000, p_cost: 0.5, p_calls: 2 });
      expect(await rpc("shadow_settle_budget", { p_reservation_id: r2.reservation_id, p_tokens: 1000, p_cost: 0.9, p_calls: 2 })).toEqual({ result: "settled", budget: "exhausted" });
      expect((await control()).state).toBe("budget_exhausted");
    });
  });

  describe("disjuntores no banco (mesma transação do registro)", () => {
    beforeEach(() => toRunning());
    it("EXATAMENTE 5 % (1 erro em 20) não dispara; 2 em 20 (> 5 %) dispara circuit_open", async () => {
      for (let i = 0; i < 19; i++) await record(recordOf("answer_candidate"));
      const r = await record(recordOf("technical_failure"));
      expect(r).toMatchObject({ result: "recorded", breaker: "ok", n: 20, errors: 1 });
      expect((await control()).state).toBe("running");
      const r2 = await record(recordOf("technical_failure"));
      expect(r2).toMatchObject({ breaker: "error_rate_exceeded", n: 21, errors: 2, trip: "applied" });
      expect((await control()).state).toBe("circuit_open");
    });
    it("amostra pequena: duas falhas técnicas consecutivas disparam; intercaladas não", async () => {
      await record(recordOf("technical_failure"));
      await record(recordOf("answer_candidate"));
      expect((await record(recordOf("technical_failure"))).breaker).toBe("ok");
      expect(await record(recordOf("technical_failure"))).toMatchObject({ breaker: "consecutive_failures", trip: "applied" });
      expect((await control()).state).toBe("circuit_open");
    });
    it("bloqueios legítimos não entram no denominador", async () => {
      for (const d of ["human_pause_active", "budget_blocked", "blocked_not_authorized", "aborted_by_shutdown"] as const) for (let i = 0; i < 10; i++) await record(recordOf(d));
      expect(await one(`select count(*) filter (where evaluable) || '/' || count(*) from public.guest_ai_shadow_executions`)).toBe("0/40");
      expect((await record(recordOf("technical_failure"))).breaker).toBe("ok");
      expect((await record(recordOf("technical_failure"))).breaker).toBe("consecutive_failures");
    });
    it("decisão de integridade ⇒ integrity_violation global (independe da taxa)", async () => {
      expect(await record(recordOf("integrity_violation"))).toMatchObject({ breaker: "integrity_violation", trip: "applied" });
      expect((await control()).state).toBe("integrity_violation");
    });
    it("janela/amostra não configuradas ⇒ medição indisponível ⇒ technical_failure", async () => {
      await pg.sql(`update public.guest_ai_shadow_control set error_window_minutes = null`);
      expect(await rpc("shadow_evaluate_breakers")).toEqual({ result: "measurement_unavailable" });
      expect(await record(recordOf("answer_candidate"))).toMatchObject({ breaker: "measurement_unavailable", trip: "applied" });
      expect((await control()).state).toBe("technical_failure");
    });
    it("paridade TS × SQL do disjuntor em sequências aleatórias", async () => {
      const decisions: ShadowDecision[] = ["answer_candidate", "technical_failure", "human_pause_active", "silence", "budget_blocked"];
      let rnd = 7;
      const next = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
      for (let round = 0; round < 6; round++) {
        await pg.sql(`truncate public.guest_ai_shadow_executions; update public.guest_ai_shadow_control set state = 'running', error_min_sample = ${3 + round}`);
        const seqd: ShadowDecision[] = [];
        for (let i = 0; i < 8; i++) {
          const d = decisions[Math.floor(next() * decisions.length)]!;
          seqd.push(d);
          await pg.sql(`update public.guest_ai_shadow_control set state = 'running'`);
          const sql = await record(recordOf(d, { finishedAt: new Date(Date.now() - (100 - i) * 1000).toISOString() }));
          const ts = evaluateErrorBreaker([...seqd].reverse().map((x) => ({ evaluable: isEvaluable(x), technicalError: isTechnicalError(x) })), 3 + round);
          expect(sql.breaker, `rodada ${round} passo ${i}`).toBe(ts);
        }
      }
    });
  });

  describe("manifesto, relatório auditado, expurgo", () => {
    it("inclusão exige gêmeo/histórico verificados, imóvel real, ativo e do tenant; versão ativa é imutável", async () => {
      const add = (o: Record<string, unknown> = {}) => rpc("shadow_manifest_add", { p_actor: ACTOR, p_manifest_version: 1, p_tenant_id: T_ID, p_property_id: P_ID, p_selection_reason: "highest_volume", p_twin_status: "verified", p_history_status: "verified", ...o });
      expect((await add({ p_twin_status: "failed" })).result).toBe("not_verified");
      expect((await add({ p_history_status: "not_checked" })).result).toBe("not_verified");
      expect((await add({ p_tenant_id: OTHER_T })).result).toBe("tenant_mismatch");
      expect((await add({ p_property_id: "b0000000-0000-4000-8000-0000000000bb" })).result).toBe("archived");
      expect((await add({ p_property_id: "b0000000-0000-4000-8000-0000000000cc" })).result).toBe("not_found");
      expect((await add({ p_selection_reason: CANARY })).result).toBe("invalid_argument");
      expect((await add({ p_actor: null })).result).toBe("invalid_argument");
      expect((await add()).result).toBe("applied");
      expect((await add()).result).toBe("duplicate");
      await pg.sql(`update public.guest_ai_shadow_control set manifest_version = 1`);
      expect((await add({ p_property_id: "b0000000-0000-4000-8000-0000000000aa" })).result).toBe("version_immutable");
      expect(await rpc("shadow_get_manifest")).toMatchObject({ result: "ok", manifest_version: 1, entries: [{ tenant_id: T_ID, property_id: P_ID, selection_reason: "highest_volume" }] });
    });
    it("relatório só agregados do tenant pedido e cada leitura é auditada", async () => {
      await toRunning();
      await record(recordOf("answer_candidate"));
      await record(recordOf("silence", { tenantId: OTHER_T }));
      const r = await rpc("shadow_report", { p_actor: ACTOR, p_report: "decision_summary", p_tenant_id: T_ID, p_from: "2000-01-01T00:00:00Z", p_to: "2100-01-01T00:00:00Z" });
      expect(r).toEqual({ result: "ok", rows: [{ property_id: P_ID, decision: "answer_candidate", executions: 1 }] });
      const c = await rpc("shadow_report", { p_actor: ACTOR, p_report: "daily_cost", p_tenant_id: T_ID, p_from: "2000-01-01T00:00:00Z", p_to: "2100-01-01T00:00:00Z" });
      expect(c.result).toBe("ok");
      expect(await one(`select count(*) from public.guest_ai_shadow_access_log where actor = '${ACTOR}'`)).toBe("2");
      expect((await rpc("shadow_report", { p_actor: ACTOR, p_report: CANARY, p_tenant_id: T_ID, p_from: "2000-01-01T00:00:00Z", p_to: "2100-01-01T00:00:00Z" })).result).toBe("invalid_argument");
    });
    it("expurgo só com retenção configurada; apaga só o que passou do prazo", async () => {
      expect(await rpc("shadow_purge_expired")).toEqual({ result: "retention_not_configured" });
      await toRunning();
      await record(recordOf("answer_candidate", { startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:01.000Z" }));
      await record(recordOf("answer_candidate"));
      expect(await rpc("shadow_purge_expired")).toEqual({ result: "ok", deleted: 1 });
    });
  });

  describe("adaptador createShadowStore contra o banco real", () => {
    const store = () => createShadowStore({ call: async (fn, args) => ({ data: await rpc(fn, args), error: null }) });
    it("lê estado/manifesto, reserva, liquida, avalia, registra e dispara pelas RPCs reais", async () => {
      const s = store();
      expect(await s.readControl()).toMatchObject({ state: "disabled", retentionAuthorized: false, dailyCostLimitUsd: 1 });
      await toRunning();
      expect(await s.readControl()).toMatchObject({ state: "running", modelId: "openai/gpt-5.6-sol", maxTurnCostUsd: 0.5, retentionAuthorized: true, retentionScope: "openai_responses" });
      expect((await s.readManifest())!.entries).toEqual([{ manifestVersion: 1, tenantId: T_ID, propertyId: P_ID, selectionReason: "highest_volume", twinStatus: "verified", historyStatus: "verified" }]);
      const res = await s.reserve(uid(), { tokens: 1000, costUsd: 0.01, calls: 2 });
      expect(res.kind).toBe("reserved");
      expect(await s.settle((res as { reservationId: string }).reservationId, { tokens: 100, costUsd: 0.001, calls: 1 })).toBe("settled");
      expect(await s.evaluateBreakers()).toBe("ok");
      expect(await s.record(recordOf("answer_candidate"))).toEqual({ kind: "recorded", breaker: "ok" });
      expect(await s.trip("circuit_open", "error_rate_exceeded")).toBe("applied");
      expect((await s.readControl())!.state).toBe("circuit_open");
    });
  });
});
