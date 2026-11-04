/**
 * B3.3 · ENTREGA 3 — HARNESS DE SIMULAÇÃO (somente teste; nada aqui é importado por produção).
 *
 * Executa a arquitetura REAL do Shadow (worker, gerador emitido, executor, cadeia, extrator, adaptador
 * `createShadowStore`, adaptador `createDistributedLeaseStore`, portas `shadowRpcFrom`/`leaseRpcFrom`)
 * contra um PostgreSQL 17.6 REAL e LOCAL (cluster temporário, migrations do lease e do Shadow, RLS,
 * privilégios e RPCs executados de verdade, cada chamada como `service_role` numa conexão própria).
 *
 * Controles: relógio de parede e monotônico do worker, latência por RPC/Gateway, falhas injetadas
 * (antes da execução, resposta perdida DEPOIS do commit, travamento até o cancelamento), interrupção de
 * workers (abandono no meio do fluxo), concorrência real (processos psql paralelos), expiração de lease
 * pelo relógio do banco, intervenções humanas em qualquer ponto, inspeção do banco e registro de toda
 * chamada (só nome da função e código do resultado — nunca argumentos de texto).
 *
 * Mundo SINTÉTICO: conversas, imóveis e tenants fictícios. Nenhum dado real de hóspede. O Gateway é
 * sempre o transporte falso (`LlmProvider` injetado): nenhuma rede.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { startCluster, SHADOW_MIGRATION_PATH, type PgCluster } from "../pg/pg-cluster";
import { createShadowStore, type ShadowStore } from "@/lib/guest-ai/data/shadow-store.server";
import { createDistributedLeaseStore } from "@/lib/guest-ai/data/lease-store.server";
import { leaseRpcFrom, shadowRpcFrom, type GuestAiDb, type RpcCapableClient } from "@/lib/guest-ai/data/client.server";
import type { DistributedLeaseStore } from "@/lib/guest-ai/batch/lease";
import type { ShadowWorkerIo } from "@/lib/guest-ai/shadow-exec/worker.server";
import type { ShadowCandidate } from "@/lib/guest-ai/data/shadow-candidates.server";
import type { OwnershipLoad } from "@/lib/guest-ai/data/conversation-ownership.server";
import type { CollectorWindowSource } from "@/lib/guest-ai/data/collector.server";
import type { LlmProvider, ProviderOutcome, ProviderRequest } from "@/lib/guest-ai/llm/providers/types";
import type { LlmCallLogEvent } from "@/lib/guest-ai/llm/telemetry";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { issue } from "@/lib/guest-ai/trust";
import { conversationContext } from "../helpers/b21-fixtures";
import { CONV, MSG, TURN_FIELDS, history, v4 } from "../helpers/b23-chain";
import { operationalPorts, ownershipRow, staySource } from "../helpers/b25-fixtures";
import { P_ID, T_ID, benignPause } from "../helpers/b33-shadow";

export const PG176_BIN = "/opt/pg176/bin";
export const PG176_AVAILABLE = existsSync(`${PG176_BIN}/postgres`) && existsSync("/usr/bin/psql");

// ───────────────────────────── Banco ─────────────────────────────

export interface E3Db {
  pg: PgCluster;
  /** SQL como dono (fixtures e inspeção). */
  sql(q: string): Promise<string>;
  /** SQL como service_role. */
  sr(q: string): Promise<string>;
  /** Linhas JSON de uma consulta (dono). */
  rows<T = Record<string, unknown>>(q: string): Promise<T[]>;
  log(): string;
  stop(): void;
}

/**
 * Sobe o PostgreSQL 17.6 com as duas migrations reais. `log_statement=all` grava no log do servidor
 * TODA instrução recebida: é a prova de que nenhum texto livre chegou ao banco (varredura de canários).
 */
export function startE3Db(): E3Db {
  const pg = startCluster([SHADOW_MIGRATION_PATH], { bin: PG176_BIN, serverOptions: ["log_statement=all", "log_min_messages=warning"] });
  return {
    pg,
    sql: (q) => pg.sql(q),
    sr: (q) => pg.sql(q, { role: "service_role" }),
    async rows<T>(q: string) {
      const out = await pg.sql(`select coalesce(json_agg(e3row), '[]'::json) from (${q}) e3row`);
      return JSON.parse(out) as T[];
    },
    log: () => readFileSync(`${pg.dir}/pg.log`, "utf8"),
    stop: () => pg.stop(),
  };
}

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return v.length ? `array[${v.map((x) => `'${String(x).replace(/'/g, "''")}'`).join(",")}]::uuid[]` : "'{}'::uuid[]";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

// ───────────────────────────── Falhas e registro de chamadas ─────────────────────────────

export type FaultMode = "before" | "after_commit" | "hang";
export interface Fault {
  fn: string;
  mode: FaultMode;
  /** Só a n-ésima chamada desta função (1-based) dentro do controlador; ausente ⇒ todas. */
  nth?: number;
  /** Filtro adicional sobre os argumentos (ex.: evento do lease). */
  when?: (args: Record<string, unknown>) => boolean;
}
export interface CallRecord {
  fn: string;
  /** `result` devolvido pelo banco, ou `error:<código>`. Nunca argumentos. */
  outcome: string;
  event?: string;
  ms: number;
}
export interface Controller {
  faults: Fault[];
  latencyMs: (fn: string, args: Record<string, unknown>) => number;
  calls: CallRecord[];
  counts: Map<string, number>;
  /** Gancho chamado ANTES de cada RPC (intervenções humanas, expiração forçada…). */
  before?: (fn: string, args: Record<string, unknown>) => Promise<void> | void;
}
export const controller = (over: Partial<Controller> = {}): Controller => ({ faults: [], latencyMs: () => 0, calls: [], counts: new Map(), ...over });

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * Cliente "tipo PostgREST" sobre o Postgres real: `rpc(fn, args)` devolve um construtor com
 * `.abortSignal(sig)`. Cancelar MATA o processo psql (como o `fetch` abortado): a instrução que já
 * chegou ao servidor pode terminar e confirmar — exatamente o limite real do cancelamento.
 */
export function pgRpcClient(db: E3Db, ctl: Controller): RpcCapableClient {
  const pg = db.pg;
  const exec = async (fn: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: unknown; error: unknown }> => {
    const t0 = performance.now();
    const n = (ctl.counts.get(fn) ?? 0) + 1;
    ctl.counts.set(fn, n);
    const event = typeof args.p_event === "string" ? args.p_event : undefined;
    const done = (outcome: string, r: { data: unknown; error: unknown }) => {
      ctl.calls.push({ fn, outcome, event, ms: Math.round(performance.now() - t0) });
      return r;
    };
    await ctl.before?.(fn, args);
    await sleep(ctl.latencyMs(fn, args), signal);
    if (signal?.aborted) return done("error:aborted", { data: null, error: { code: "aborted" } });
    const fault = ctl.faults.find((f) => f.fn === fn && (f.nth === undefined || f.nth === n) && (!f.when || f.when(args)));
    if (fault?.mode === "before") return done("error:injected_before", { data: null, error: { code: "injected" } });
    if (fault?.mode === "hang") {
      await new Promise<void>((resolve) => (signal ? signal.addEventListener("abort", () => resolve(), { once: true }) : undefined));
      return done("error:aborted", { data: null, error: { code: "aborted" } });
    }
    const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
    const q = `set role service_role;\nselect public.${fn}(${named})`;
    const res = await new Promise<{ code: number; out: string; aborted: boolean }>((resolve) => {
      const p = spawn("psql", ["-h", pg.dir, "-p", String(pg.port), "-U", "postgres", "-d", pg.db, "-v", "ON_ERROR_STOP=1", "-q", "-tA", "-c", q]);
      let out = "";
      let aborted = false;
      const onAbort = () => {
        aborted = true;
        p.kill("SIGKILL");
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      p.stdout.on("data", (d) => (out += d));
      p.on("close", (code) => {
        signal?.removeEventListener("abort", onAbort);
        resolve({ code: code ?? 1, out: out.trim(), aborted });
      });
    });
    if (res.aborted) return done("error:aborted", { data: null, error: { code: "aborted" } });
    if (res.code !== 0) return done("error:pg", { data: null, error: { code: "pg_error" } });
    const data = JSON.parse(res.out) as { result?: string };
    if (fault?.mode === "after_commit") return done(`error:lost_after_${data?.result ?? "?"}`, { data: null, error: { code: "response_lost" } });
    return done(String(data?.result ?? "?"), { data, error: null });
  };
  return {
    rpc(fn, args) {
      let sig: AbortSignal | undefined;
      let p: Promise<{ data: unknown; error: unknown }> | null = null;
      const run = () => (p ??= exec(fn, args, sig));
      return {
        then: (a, b) => run().then(a, b),
        abortSignal(s: AbortSignal) {
          sig = s;
          return { then: (a: never, b: never) => run().then(a, b) } as PromiseLike<{ data: unknown; error: unknown }>;
        },
      } as PromiseLike<{ data: unknown; error: unknown }> & { abortSignal: (s: AbortSignal) => PromiseLike<{ data: unknown; error: unknown }> };
    },
  };
}

/** Leitura do lease como service_role pela projeção do adaptador (sem o token). */
export function leaseReadDb(db: E3Db, signal?: AbortSignal): GuestAiDb {
  return {
    from(table: string) {
      let select = "";
      let id = "";
      const q = {
        select(s: string) {
          select = s;
          return q;
        },
        eq(_k: string, v: string) {
          id = v;
          return q;
        },
        async maybeSingle() {
          if (signal?.aborted) return { data: null, error: { code: "aborted" } };
          const r = await db.pg.trySql(`select row_to_json(t) from (select ${select} from public.${table} where conversation_id = ${lit(id)}) t`, { role: "service_role" });
          return r.ok ? { data: r.out ? JSON.parse(r.out) : null, error: null } : { data: null, error: { code: "pg_error" } };
        },
      };
      return q;
    },
  } as unknown as GuestAiDb;
}

/** Store e lease REAIS (mesmas portas de produção) ligados ao sinal do worker. */
export function realStores(db: E3Db, ctl: Controller) {
  const client = pgRpcClient(db, ctl);
  return {
    storeFor: (signal?: AbortSignal): ShadowStore => createShadowStore(shadowRpcFrom(client, signal)),
    leaseFor: (signal?: AbortSignal): DistributedLeaseStore => createDistributedLeaseStore({ rpc: leaseRpcFrom(client, signal), db: leaseReadDb(db, signal) }),
  };
}

// ───────────────────────────── Configuração do banco Shadow ─────────────────────────────

export const ACTOR = "ac000000-0000-4000-8000-0000000000e3";
const EVID = "e3".repeat(32);

export interface ShadowLimitsSql {
  p_model_id: string;
  p_reasoning_effort: string;
  p_max_input_tokens: number;
  p_max_output_tokens: number;
  p_max_total_tokens: number;
  p_max_turn_cost_usd: number;
  p_daily_cost_limit_usd: number;
  p_max_daily_tokens: number;
  p_max_daily_calls: number;
  p_error_window_minutes: number;
  p_error_min_sample: number;
  p_budget_day_timezone: string;
  p_telemetry_retention_days: number;
  p_tick_interval_seconds: number;
  p_max_conversations_per_tick: number;
}
/** Limites de TESTE (não são propostas operacionais; essas estão no relatório, seção M). */
export const TEST_LIMITS: ShadowLimitsSql = {
  p_model_id: "openai/gpt-5.6-sol",
  p_reasoning_effort: "low",
  p_max_input_tokens: 60_000,
  p_max_output_tokens: 1_024,
  p_max_total_tokens: 70_000,
  p_max_turn_cost_usd: 0.5,
  p_daily_cost_limit_usd: 1,
  p_max_daily_tokens: 5_000_000,
  p_max_daily_calls: 500,
  p_error_window_minutes: 60,
  p_error_min_sample: 20,
  p_budget_day_timezone: "America/Sao_Paulo",
  p_telemetry_retention_days: 30,
  p_tick_interval_seconds: 60,
  p_max_conversations_per_tick: 5,
};

export async function rpcAsSr(db: E3Db, fn: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const named = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(", ");
  return JSON.parse(await db.sr(`select public.${fn}(${named})`)) as Record<string, unknown>;
}

/** Zera o Shadow e leva até `running` pelo caminho AUTORIZADO (RPCs administrativas, com autor). */
export async function shadowToRunning(db: E3Db, propertiesIn: Array<{ tenant: string; property: string }>, over: Partial<ShadowLimitsSql> = {}) {
  const properties = [...new Map(propertiesIn.map((p) => [p.property, p])).values()];
  await db.sql(`truncate public.guest_ai_shadow_executions, public.guest_ai_shadow_budget_reservations, public.guest_ai_shadow_budget_days, public.guest_ai_shadow_transitions, public.guest_ai_shadow_access_log, public.guest_ai_shadow_manifest`);
  await db.sql(`delete from public.guest_ai_shadow_control; insert into public.guest_ai_shadow_control (id, state, daily_cost_limit_usd) values (1, 'disabled', 1.00)`);
  for (const p of properties) await db.sql(`insert into public.properties(id, owner_id) values ('${p.property}', '${p.tenant}') on conflict (id) do update set owner_id = excluded.owner_id, archived_at = null`);
  for (const p of properties) {
    const r = await rpcAsSr(db, "shadow_manifest_add", { p_actor: ACTOR, p_manifest_version: 1, p_tenant_id: p.tenant, p_property_id: p.property, p_selection_reason: "highest_volume", p_twin_status: "verified", p_history_status: "verified" });
    if (r.result !== "applied") throw new Error(`manifest:${String(r.result)}`);
  }
  let v = Number((await rpcAsSr(db, "shadow_get_control")).state_version);
  const cfg = await rpcAsSr(db, "shadow_configure", { p_expected_version: v, p_actor: ACTOR, ...TEST_LIMITS, ...over, p_manifest_version: 1 });
  if (cfg.result !== "applied") throw new Error(`configure:${String(cfg.result)}`);
  v = Number(cfg.state_version);
  const ret = await rpcAsSr(db, "shadow_authorize_retention", { p_expected_version: v, p_actor: ACTOR, p_scope: "openai_responses", p_evidence_sha256: EVID });
  v = Number(ret.state_version);
  const r1 = await rpcAsSr(db, "shadow_transition", { p_expected_version: v, p_to: "ready", p_actor: ACTOR, p_reason: "authorized_activation" });
  const r2 = await rpcAsSr(db, "shadow_transition", { p_expected_version: Number(r1.state_version), p_to: "running", p_actor: ACTOR, p_reason: "authorized_activation" });
  if (r2.result !== "applied") throw new Error(`running:${String(r2.result)}`);
}

export async function shadowState(db: E3Db): Promise<{ state: string; version: number }> {
  const c = await rpcAsSr(db, "shadow_get_control");
  return { state: String(c.state), version: Number(c.state_version) };
}

export async function budgetTotals(db: E3Db) {
  const [d] = await db.rows<{ reserved_cost: number; settled_cost: number; reserved_calls: number; settled_calls: number; open_reservations: number }>(
    `select coalesce(sum(reserved_cost),0)::float8 reserved_cost, coalesce(sum(settled_cost),0)::float8 settled_cost, coalesce(sum(reserved_calls),0)::int reserved_calls, coalesce(sum(settled_calls),0)::int settled_calls, coalesce(sum(open_reservations),0)::int open_reservations from public.guest_ai_shadow_budget_days`,
  );
  const [r] = await db.rows<{ open: number; settled: number; open_cost: number }>(
    `select count(*) filter (where status='open')::int open, count(*) filter (where status='settled')::int settled, coalesce(sum(cost_usd) filter (where status='open'),0)::float8 open_cost from public.guest_ai_shadow_budget_reservations`,
  );
  return { ...d!, reservations: r! };
}

/**
 * Invariante contábil do orçamento: o agregado do dia = soma das reservas (abertas pelo valor
 * reservado; liquidadas pelo valor real). Divergência ⇒ dupla liquidação, perda ou corrida.
 */
export async function budgetLedgerConsistent(db: E3Db): Promise<boolean> {
  const out = await db.sql(`
    select bool_and(ok) from (
      select d.budget_day,
        abs(d.reserved_cost - coalesce(sum(r.cost_usd) filter (where r.status='open'),0)) < 1e-9
        and abs(d.settled_cost - coalesce(sum(r.settled_cost) filter (where r.status='settled'),0)) < 1e-9
        and d.reserved_calls = coalesce(sum(r.calls) filter (where r.status='open'),0)
        and d.settled_calls = coalesce(sum(r.settled_calls) filter (where r.status='settled'),0)
        and d.open_reservations = count(*) filter (where r.status='open') as ok
      from public.guest_ai_shadow_budget_days d left join public.guest_ai_shadow_budget_reservations r on r.budget_day = d.budget_day
      group by d.budget_day, d.reserved_cost, d.settled_cost, d.reserved_calls, d.settled_calls, d.open_reservations) s`);
  return out === "t" || out === "";
}

// ───────────────────────────── Mundo sintético ─────────────────────────────

let seq = 0;
export const synthUuid = (prefix: string) => `${prefix}-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;

export interface HumanState {
  /** Fonte da pausa (mesmo formato do loader real). */
  pause: ReturnType<typeof benignPause> & Record<string, unknown>;
  ownership: OwnershipLoad["status"];
  /** Falha de leitura da pausa/posse. */
  readFails?: boolean;
}

export interface ConvSpec {
  conv: string;
  msg: string;
  tenant: string;
  property: string;
  /** Mensagens do hóspede na janela do coletor (ids). Padrão: [msg]. */
  guestMessages?: string[];
  /** Texto da mensagem atual (canários entram aqui). */
  text?: string;
  human: HumanState;
  /** Altera o contexto carregado (canários em campos do imóvel, por exemplo). */
  contextPatch?: (ctx: ReturnType<typeof conversationContext>) => ReturnType<typeof conversationContext>;
}

export function convSpec(over: Partial<ConvSpec> = {}): ConvSpec {
  return {
    conv: synthUuid("c3000000"),
    msg: synthUuid("a3000000"),
    tenant: T_ID,
    property: P_ID,
    human: { pause: benignPause() as HumanState["pause"], ownership: "none" },
    ...over,
  };
}

/** Troca, em profundidade, os ids da fixture pelos da conversa sintética (Sets e Maps preservados). */
function remap<T>(value: T, m: Map<string, string>): T {
  const swap = (s: string) => {
    let out = s;
    for (const [a, b] of m) if (out.includes(a)) out = out.split(a).join(b);
    return out;
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return swap(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Set) return new Set([...v].map(walk));
    if (v instanceof Map) return new Map([...v].map(([k, x]) => [walk(k), walk(x)]));
    if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      const o: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}

export interface WorldHooks {
  /** Chamado em cada ponto observável do fluxo (nome do ponto, conversa). */
  at?: (point: "scope" | "pause1" | "collector" | "pause2" | "ownership" | "context" | "gateway", spec: ConvSpec) => Promise<void> | void;
}

export interface WorldOpts {
  db: E3Db;
  ctl: Controller;
  provider: LlmProvider;
  hooks?: WorldHooks;
  log?: LlmCallLogEvent[];
  /** Relógio de parede do worker (ms). Padrão: 1 min depois da mensagem sintética (fora do debounce). */
  wallNow?: () => number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  masterSwitchOn?: () => boolean;
}

export const WALL_T0 = Date.parse("2026-11-03T10:01:00Z");
/**
 * Relógio de parede REAL por padrão: a janela dos disjuntores no banco compara `finished_at` (informado
 * pelo worker) com o `now()` do banco, então o harness usa o mesmo relógio da máquina do banco.
 */
export const REAL_WALL = () => Date.now();

/** `io` do worker com store/lease REAIS e leitura de conversa SINTÉTICA, por conversa. */
export function worldIo(specs: ConvSpec[], o: WorldOpts): ShadowWorkerIo {
  const byConv = new Map(specs.map((s) => [s.conv, s]));
  const stores = realStores(o.db, o.ctl);
  const mapOf = (s: ConvSpec) =>
    new Map<string, string>([
      [CONV, s.conv],
      [MSG, s.msg],
      [P_ID, s.property],
      [T_ID, s.tenant],
    ]);
  const turnOf = (s: ConvSpec): ValidatedTurn => issue("turn", { ...TURN_FIELDS, conversationId: s.conv, messageId: s.msg, tenantId: s.tenant, propertyId: s.property }) as ValidatedTurn;
  const specOf = (conv: string) => {
    const s = byConv.get(conv);
    if (!s) throw Object.assign(new Error("unknown_conversation"), { code: "lookup_failed" });
    return s;
  };
  return {
    storeFor: (signal) => stores.storeFor(signal),
    leaseFor: (signal) => stores.leaseFor(signal),
    async validateTurnScope(input) {
      const s = specOf(input.conversationId);
      await o.hooks?.at?.("scope", s);
      if (input.expectedOwnerId !== s.tenant) throw Object.assign(new Error("x"), { code: "tenant_mismatch" });
      return turnOf(s);
    },
    async fetchCollectorWindow(turn): Promise<CollectorWindowSource> {
      const s = specOf(turn.conversationId);
      await o.hooks?.at?.("collector", s);
      const ids = s.guestMessages ?? [s.msg];
      return {
        scope: { conversationId: s.conv, propertyId: s.property, tenantId: s.tenant, channel: "web", senderId: turn.guestSessionId },
        messages: ids.map((id, i) => ({
          id,
          conversationId: s.conv,
          propertyId: s.property,
          tenantId: s.tenant,
          channel: "web" as const,
          senderRole: "guest" as const,
          senderId: turn.guestSessionId,
          text: i === ids.length - 1 ? (s.text ?? "Qual é o horário do check-in?") : "Olá",
          tPersisted: new Date(Date.parse("2026-11-03T10:00:00Z") - (ids.length - 1 - i) * 1000).toISOString(),
          tChannel: null,
          tReceived: null,
          rawMatched: true,
        })),
        unpersistedRawGuest: [],
        pendingOverflow: false,
      };
    },
    async loadHumanPauseSource(turn) {
      const s = specOf(turn.conversationId);
      await o.hooks?.at?.("pause1", s);
      if (s.human.readFails) throw new Error("read_failed");
      return s.human.pause as never;
    },
    async loadOwnership(turn) {
      const s = specOf(turn.conversationId);
      await o.hooks?.at?.("ownership", s);
      if (s.human.readFails) throw new Error("read_failed");
      const st = s.human.ownership;
      if (st === "none" || st === "identified")
        return { status: st, row: ownershipRow({ id: s.conv, ...(st === "identified" ? { status: "needs_human", handoff_reason: "Assunto da equipe", handoff_at: "2026-11-03T09:00:00Z" } : {}) }) } as OwnershipLoad;
      return { status: st } as OwnershipLoad;
    },
    portsFor(turn, row) {
      const s = specOf(turn.conversationId);
      const m = mapOf(s);
      return operationalPorts({
        loadContext: async () => {
          await o.hooks?.at?.("context", s);
          const base = conversationContext();
          // chamado aberto no contexto coerente com a posse lida (mesma conversa, mesma fonte na produção)
          const cases = s.human.ownership === "identified" ? [{ caseId: CONV, status: "needs_human", handoffReason: "Assunto da equipe", handoffAt: "2026-11-03T09:00:00Z" }] : [];
          const ctx = remap(conversationContext({ property: { ...base.guest.property, id: P_ID, tenantId: T_ID } }, cases), m);
          return s.contextPatch ? s.contextPatch(ctx) : ctx;
        },
        loadHistory: async () => {
          const ids = s.guestMessages ?? [s.msg];
          const previous = ids.slice(0, -1).map((id, i) => ({ id, role: "user", sender_type: "guest", content: "Olá", created_at: new Date(Date.parse("2026-11-03T10:00:00Z") - (ids.length - 1 - i) * 1000).toISOString() }));
          return remap(history(s.text ?? "Qual é o horário do check-in?", previous as never), m);
        },
        loadStayAuthorizationSource: async () => remap(staySource(), m),
        loadConversationOwnership: async () => row,
        loadHumanPause: async () => s.human.pause as never,
      });
    },
    masterSwitchOn: o.masterSwitchOn ?? (() => true),
    provider: o.provider,
    log: (e) => void o.log?.push(e),
    now: o.now,
    wallNow: o.wallNow ?? REAL_WALL,
    schedule: o.schedule,
  };
}

export const candidateOf = (s: ConvSpec): ShadowCandidate => ({ conversationId: s.conv, propertyId: s.property, tenantId: s.tenant, surface: "guide_chat", messageId: s.msg });

// ───────────────────────────── Gateway simulado ─────────────────────────────

export const goodDecision = (reply = "O check-in começa às 15h.") => v4({ reply, groundedOn: ["ctx:checkin_oficial"] });

export interface SimProvider extends LlmProvider {
  calls: number;
  /** Requisições recebidas (só para checar o que o MODELO veria; nunca persistidas). */
  requests: ProviderRequest[];
}
/**
 * Transporte falso: latência controlável que respeita o cancelamento, gancho durante a chamada,
 * resultado por chamada. Nunca rede.
 */
export function simProvider(opts: { latencyMs?: number; outcome?: (n: number) => ProviderOutcome; during?: (n: number) => Promise<void> | void; usage?: { inputTokens: number; outputTokens: number; totalTokens: number } } = {}): SimProvider {
  const p: SimProvider = {
    id: "sim",
    calls: 0,
    requests: [],
    async complete(req, signal) {
      p.calls += 1;
      const n = p.calls;
      p.requests.push(req);
      await opts.during?.(n);
      await sleep(opts.latencyMs ?? 0, signal);
      if (signal.aborted) return { kind: "error", error: { code: "aborted", retryable: false, httpStatus: null }, usage: null, requestId: null };
      if (opts.outcome) return opts.outcome(n);
      return { kind: "ok", text: JSON.stringify(goodDecision()), finishReason: "stop", usage: opts.usage ?? { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, requestId: `req-${n}` };
    },
  };
  return p;
}

/** Fecho: tabelas fora do Shadow/lease (para provar que nada fora delas muda). */
export async function nonShadowChecksum(db: E3Db): Promise<string> {
  const tables = (await db.sql(`select string_agg(table_name, ',' order by table_name) from information_schema.tables where table_schema='public' and table_type='BASE TABLE' and table_name not like 'guest_ai_%'`)).split(",").filter(Boolean);
  const parts: string[] = [];
  for (const t of tables) parts.push(`${t}:${await db.sql(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.${t} x`)}`);
  return parts.join(";");
}

// ───────────────────────────── Resultados reproduzíveis ─────────────────────────────

import { mkdirSync, writeFileSync } from "node:fs";
export const RESULTS_DIR = process.env.E3_RESULTS_DIR ?? "/tmp/e3-results";
/** Grava o resultado técnico de um cenário (só números, códigos e ids sintéticos). */
export function recordResult(name: string, data: unknown): void {
  try {
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(`${RESULTS_DIR}/${name}.json`, JSON.stringify(data, null, 1));
  } catch {
    /* evidência auxiliar; o teste decide pelas asserções */
  }
}

/** Insere a linha mínima da conversa (FK do lease). */
export async function seedConversation(db: E3Db, s: ConvSpec): Promise<ConvSpec> {
  await db.sql(`insert into public.property_chat_conversations(id) values ('${s.conv}') on conflict do nothing`);
  return s;
}

export async function leaseRow(db: E3Db, conv: string) {
  const [r] = await db.rows<{ state: string; version: number; attempts: number; message_ids: string[]; deferred: string[]; processed: string[]; expired: boolean }>(
    `select state, version, attempts, coalesce(message_ids,'{}') message_ids, coalesce(deferred_message_ids,'{}') deferred, coalesce(processed_message_ids,'{}') processed, coalesce(lease_expires_at <= now(), false) expired from public.guest_ai_conversation_leases where conversation_id = '${conv}'`,
  );
  return r ?? null;
}

export async function executions(db: E3Db, conv?: string) {
  return db.rows<{ execution_id: string; tenant_id: string; property_id: string; conversation_id: string; batch_id: string | null; decision: string; execution_state: string; technical_code: string | null; block_code: string | null; integrity_code: string | null; gateway_calls: number }>(
    `select execution_id, tenant_id, property_id, conversation_id, batch_id, decision, execution_state, technical_code, block_code, integrity_code, gateway_calls from public.guest_ai_shadow_executions ${conv ? `where conversation_id = '${conv}'` : ""} order by recorded_at`,
  );
}

export async function automaticTrips(db: E3Db) {
  return db.rows<{ from_state: string; to_state: string; reason_code: string }>(`select from_state, to_state, reason_code from public.guest_ai_shadow_transitions where automatic order by id`);
}

export const summarizeCalls = (ctl: Controller) => ctl.calls.map((c) => `${c.fn}${c.event ? `:${c.event}` : ""}=${c.outcome}`);
