/**
 * B3.3 · E3 — Fase 4: PRIVACIDADE E DESCARTE com PostgreSQL 17.6 real.
 *
 * Canários sintéticos ÚNICOS em todos os pontos de entrada de texto do fluxo (mensagem do hóspede,
 * histórico, contexto do imóvel, saída do modelo em todos os campos livres, erros do Gateway, exceções
 * das portas, erros do banco). Depois de cada cenário, os canários são procurados em: todas as tabelas
 * do banco, o log do servidor com TODAS as instruções recebidas (`log_statement=all`), console,
 * stdout/stderr, eventos de log do Gateway, desfechos do worker, resposta do tick, relatórios
 * auditados, exceções não tratadas e rejeições assíncronas. Resultado exigido: zero ocorrências.
 * Controle de sensibilidade: o mesmo canário PRECISA aparecer na requisição ao modelo (destino legítimo).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runShadowWorker } from "@/lib/guest-ai/shadow-exec/worker.server";
import { runShadowTick } from "@/lib/guest-ai/shadow-exec/tick.server";
import { v4 } from "../helpers/b23-chain";
import type { LlmCallLogEvent } from "@/lib/guest-ai/llm/telemetry";
import {
  PG176_AVAILABLE, startE3Db, controller, worldIo, convSpec, candidateOf, simProvider, shadowToRunning, seedConversation, realStores, rpcAsSr, recordResult, ACTOR,
  type E3Db, type ConvSpec,
} from "./harness";

let db: E3Db;
const K = (tag: string) => `CANARIO-E3-${tag}-${Math.random().toString(36).slice(2, 10)}`;
const captured: string[] = [];
const sink = (...a: unknown[]) => void captured.push(a.map((x) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(" "));
const asyncErrors: string[] = [];
const onUnhandled = (e: unknown) => void asyncErrors.push(String((e as Error)?.stack ?? e));

async function dbHits(canaries: string[]): Promise<Record<string, number>> {
  const tables = (await db.sql(`select string_agg(table_name, ',') from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`)).split(",");
  const hits: Record<string, number> = {};
  for (const t of tables) {
    for (const c of canaries) {
      // o canário vai em hexadecimal: a própria varredura não pode escrevê-lo no log de instruções
      const hex = Buffer.from(c, "utf8").toString("hex");
      const n = Number(await db.sql(`select count(*) from public.${t} x where strpos(x::text, convert_from(decode('${hex}', 'hex'), 'UTF8')) > 0`));
      if (n) hits[`${t}:${c}`] = n;
    }
  }
  return hits;
}

describe.skipIf(!PG176_AVAILABLE)("E3 · Fase 4 — privacidade e descarte (PostgreSQL 17.6 real)", () => {
  beforeAll(() => {
    db = startE3Db();
    process.on("unhandledRejection", onUnhandled);
    process.on("uncaughtException", onUnhandled);
  }, 60_000);
  afterAll(() => {
    process.off("unhandledRejection", onUnhandled);
    process.off("uncaughtException", onUnhandled);
    db?.stop();
  });
  beforeEach(() => {
    captured.length = 0;
    for (const m of ["log", "info", "warn", "error", "debug", "trace"] as const) vi.spyOn(console, m).mockImplementation(sink);
    vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => (sink(String(chunk)), true)) as never);
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => (sink(String(chunk)), true)) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const runScenario = async (name: string, s: ConvSpec, provider: ReturnType<typeof simProvider>, canaries: string[], ctl = controller(), extra?: () => Promise<string>) => {
    const log: LlmCallLogEvent[] = [];
    const out = await runShadowWorker(candidateOf(s), worldIo([s], { db, ctl, provider, log }));
    const extraText = extra ? await extra() : "";
    const destinations: Record<string, string> = {
      worker_outcome: JSON.stringify(out),
      gateway_log_events: JSON.stringify(log),
      console_and_stdio: captured.join("\n"),
      rpc_call_log: JSON.stringify(ctl.calls),
      postgres_statement_log: db.log(),
      async_errors: asyncErrors.join("\n"),
      extra: extraText,
    };
    const leaks: string[] = [];
    for (const [dest, text] of Object.entries(destinations)) for (const c of canaries) if (text.includes(c)) leaks.push(`${dest}:${c}`);
    const tableHits = await dbHits(canaries);
    const toModel = canaries.filter((c) => JSON.stringify(provider.requests).includes(c));
    recordResult(`privacy-${name}`, { out, leaks, tableHits, canaries: canaries.length, reachedModel: toModel.length, statementsLogged: db.log().split("\n").filter((l) => l.includes("statement:")).length });
    return { out, leaks, tableHits, toModel };
  };

  it("canários na mensagem do hóspede, no histórico e no contexto do imóvel: chegam ao modelo e a NENHUM outro destino", async () => {
    const kMsg = K("msg");
    const kCtx = K("ctx");
    await shadowToRunning(db, [convSpec()]);
    const s = await seedConversation(db, convSpec({ text: `Qual o horário? ${kMsg}`, contextPatch: (ctx) => ({ ...ctx, guest: { ...ctx.guest, property: { ...ctx.guest.property, name: `Casa ${kCtx}` } } }) as typeof ctx }));
    await shadowToRunning(db, [s]);
    const r = await runScenario("input", s, simProvider(), [kMsg, kCtx]);
    expect(r.out).toEqual({ status: "recorded", decision: "answer_candidate" });
    expect(r.toModel.sort()).toEqual([kMsg, kCtx].sort()); // sensibilidade: o canário realmente percorreu o fluxo
    expect(r.leaks).toEqual([]);
    expect(r.tableHits).toEqual({});
  }, 60_000);

  it("canários em TODOS os campos livres da saída do modelo (resposta, pergunta, compromissos, nome): nada persiste nem sai", async () => {
    const ks = { reply: K("reply"), name: K("name"), question: K("question"), missing: K("missing"), commitment: K("commit") };
    const s = await seedConversation(db, convSpec());
    await shadowToRunning(db, [s]);
    const out1 = v4({ reply: `O check-in é às 15h ${ks.reply}`, groundedOn: ["ctx:checkin_oficial"], speakerName: ks.name });
    const decisions = [
      out1,
      v4({ strategy: "handoff", reply: null, handoff: { needed: true, question: `Pode confirmar? ${ks.question}`, urgency: "normal" }, groundedOn: [], missingInformation: [`falta ${ks.missing}`] }),
      v4({ strategy: "answer_and_handoff", reply: `Vou repassar à equipe ${ks.reply}`, handoff: { needed: true, question: `Repasse ${ks.question}`, urgency: "normal" }, commitments: [`Vou avisar a equipe ${ks.commitment}`], commitmentKinds: ["team_relay"] }),
    ];
    const canaries = Object.values(ks);
    for (const [i, d] of decisions.entries()) {
      const sx = await seedConversation(db, convSpec());
      await shadowToRunning(db, [sx]);
      const provider = simProvider({ outcome: () => ({ kind: "ok", text: JSON.stringify(d), finishReason: "stop", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, requestId: "r" }) });
      const r = await runScenario(`output-${i}`, sx, provider, canaries);
      expect(r.out.status).toBe("recorded");
      expect(r.leaks).toEqual([]);
      expect(r.tableHits).toEqual({});
    }
  }, 90_000);

  it("exceções com canário nas portas (escopo, pausa, contexto) e no Gateway: o texto da exceção nunca sai", async () => {
    const points = ["scope", "pause1", "context", "gateway"] as const;
    for (const point of points) {
      const k = K(`exc-${point}`);
      const s = await seedConversation(db, convSpec());
      await shadowToRunning(db, [s]);
      const provider = simProvider({ during: () => { if (point === "gateway") throw new Error(k); } });
      const w = worldIo([s], { db, ctl: controller(), provider, hooks: { at: (p) => { if (p === point) throw Object.assign(new Error(k), { code: "lookup_failed", detail: k }); } } });
      const log: LlmCallLogEvent[] = [];
      const out = await runShadowWorker(candidateOf(s), { ...w, log: (e) => void log.push(e) });
      const text = [JSON.stringify(out), JSON.stringify(log), captured.join("\n"), db.log(), asyncErrors.join("\n")].join("\n");
      recordResult(`privacy-exception-${point}`, { out, leak: text.includes(k) });
      expect(out.status === "recorded" || out.status === "record_failed").toBe(true);
      expect(text.includes(k), point).toBe(false);
      expect(await dbHits([k])).toEqual({});
    }
  }, 90_000);

  it("erro do banco com canário na mensagem de erro e erro do provedor: códigos fixos, nenhum texto", async () => {
    const k = K("dberr");
    const s = await seedConversation(db, convSpec());
    await shadowToRunning(db, [s]);
    const base = realStores(db, controller());
    const w = worldIo([s], { db, ctl: controller(), provider: simProvider({ outcome: () => ({ kind: "error", error: { code: "provider_unavailable", retryable: false, httpStatus: 503 }, usage: null, requestId: k }) }) });
    const poisonedStore = (sig?: AbortSignal) => {
      const st = base.storeFor(sig);
      return { ...st, settle: async () => { throw new Error(k); } };
    };
    const out = await runShadowWorker(candidateOf(s), { ...w, storeFor: poisonedStore as never });
    const text = [JSON.stringify(out), captured.join("\n"), db.log()].join("\n");
    expect(text.includes(k)).toBe(false);
    expect(await dbHits([k])).toEqual({});
  }, 60_000);

  it("tick, relatório auditado e nova tentativa: respostas só com contadores/agregados; canário ausente", async () => {
    const k = K("tick");
    const s = await seedConversation(db, convSpec({ text: `oi ${k}` }));
    await shadowToRunning(db, [s]);
    const provider = simProvider({ outcome: (n) => (n === 1 ? { kind: "error", error: { code: "provider_unavailable", retryable: true, httpStatus: 503 }, usage: null, requestId: null } : { kind: "ok", text: JSON.stringify(v4({ reply: `ok ${k}`, groundedOn: ["ctx:checkin_oficial"] })), finishReason: "stop", usage: { inputTokens: 900, outputTokens: 120, totalTokens: 1020 }, requestId: "r" }) });
    const ctl = controller();
    const w = worldIo([s], { db, ctl, provider });
    // o tick adquire a SUA trava (a do harness é liberada antes)
    await rpcAsSr(db, "shadow_release_tick", { p_tick_token: db.tick });
    const summary = await runShadowTick({ store: async () => w.storeFor(new AbortController().signal), candidates: async () => ({ ok: true, candidates: [candidateOf(s)] }), worker: (c, tickToken) => runShadowWorker(c, { ...w, tickToken }) });
    const report = await rpcAsSr(db, "shadow_report", { p_actor: ACTOR, p_report: "decision_summary", p_tenant_id: s.tenant, p_from: "2026-01-01T00:00:00Z", p_to: "2030-01-01T00:00:00Z" });
    const text = [JSON.stringify(summary), JSON.stringify(report), captured.join("\n"), db.log()].join("\n");
    recordResult("privacy-tick-report", { summary, reportRows: (report.rows as unknown[])?.length ?? 0, retryCalls: provider.calls });
    expect(provider.calls).toBe(2);
    expect(JSON.stringify(provider.requests).includes(k)).toBe(true);
    expect(text.includes(k)).toBe(false);
    expect(await dbHits([k])).toEqual({});
    expect(Object.keys(summary as object).sort()).toEqual(["blocked", "conversationsConsidered", "executed", "failed", "outcome"]);
  }, 60_000);

  it("varredura final: nenhuma coluna de texto livre nas tabelas Shadow/lease e nenhum canário em todo o banco nem no log de instruções", async () => {
    const free = await db.sql(`
      select coalesce(string_agg(c.table_name||'.'||c.column_name, ','), '') from information_schema.columns c
      where c.table_schema='public' and (c.table_name like 'guest_ai_shadow_%' or c.table_name = 'guest_ai_conversation_leases')
        and c.data_type in ('text','character varying','json','jsonb')
        and not exists (select 1 from information_schema.check_constraints cc join information_schema.constraint_column_usage u on u.constraint_name = cc.constraint_name where u.table_name = c.table_name and u.column_name = c.column_name)`);
    expect(free.split(",").filter(Boolean)).toEqual([]);
    expect(db.log().match(/CANARIO-E3-[a-z-]+-[a-z0-9]+/g) ?? []).toEqual([]);
  });
});
