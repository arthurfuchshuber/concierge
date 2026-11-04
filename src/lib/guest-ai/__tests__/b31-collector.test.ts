/**
 * B3.1 · coletor (debounce 15 s, reconciliação, pausa, limites), máquina de estados do lease,
 * telemetria por metadados e loader real da janela. Matriz B31-01..28.
 *
 * Os testes do lease AQUI exercitam o MODELO DE REFERÊNCIA puro (compare-and-swap de versão + token +
 * expiração). A exclusividade distribuída é comprovada só em `b31-lease-pg.test.ts` (Postgres real,
 * conexões independentes), que também confere que modelo e banco dão o mesmo resultado.
 */
import { describe, expect, it } from "vitest";
import { COLLECTOR_DEFAULTS, checkCollectorConfig, evaluateCollectorWindow, quietWindowFor, type CollectorMessage, type CollectorWindowInput } from "@/lib/guest-ai/batch/collector";
import {
  B31_LEASE_GATE,
  MAX_ATTEMPTS,
  applyLeaseEvent,
  claimReadyBatch,
  newLeaseRecord,
  resolveLeaseBackend,
  type DistributedLeaseStore,
  type LeaseRecord,
} from "@/lib/guest-ai/batch/lease";
import { COLLECTOR_TELEMETRY_VERSION, buildCollectorTelemetry, emitCollectorTelemetry, summarizeCollectorTelemetry, type CollectorTelemetryRecord } from "@/lib/guest-ai/batch/telemetry";
import { deriveHumanPause, type HumanPauseInput } from "@/lib/guest-ai/policy/human-pause";
import { COLLECTOR_SCAN_ROWS, fetchCollectorWindow } from "@/lib/guest-ai/data/collector.server";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { fakeDb, type Row } from "./helpers/b3-fake-db";

const T0 = Date.parse("2026-11-03T12:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const SCOPE = { conversationId: "c1", propertyId: "p1", tenantId: "t1", channel: "web" as const, senderId: "sess" };
const cm = (id: string, sec: number, over: Partial<CollectorMessage> = {}): CollectorMessage => ({
  id, conversationId: "c1", propertyId: "p1", tenantId: "t1", channel: "web", senderRole: "guest", senderId: "sess", text: `msg ${id}`, tPersisted: at(sec), tChannel: at(sec), tReceived: at(sec), rawMatched: true, ...over,
});
const noPause = (over: Partial<HumanPauseInput> = {}) => deriveHumanPause({ lookup: "ok", now: at(1000), column: null, persisted: [], persistedComplete: true, raw: [], rawComplete: true, allowedSourcePropertyIds: null, ...over });
const win = (messages: CollectorMessage[], nowSec: number, over: Partial<CollectorWindowInput> = {}): CollectorWindowInput => ({ scope: SCOPE, messages, unpersistedRawGuest: [], pendingOverflow: false, alreadyAnswered: [], pause: noPause(), now: at(nowSec), ...over });
const ev = (i: CollectorWindowInput) => evaluateCollectorWindow(i);

describe("B3.1 · debounce (15 s configurável) e formação do lote", () => {
  it("B31-01 · uma mensagem ⇒ aguarda 15 s; com 15 s ⇒ pronta", () => {
    expect(ev(win([cm("a", 0)], 10))).toMatchObject({ state: "collecting", reason: "quiet_window", eligibleAt: at(15) });
    const r = ev(win([cm("a", 0)], 15));
    expect(r).toMatchObject({ state: "ready", closure: "quiet_window" });
    if (r.state === "ready") expect(r.batch.messages.map((m) => m.id)).toEqual(["a"]);
  });
  it("B31-02 · segunda mensagem dentro do debounce reinicia a janela", () => {
    expect(ev(win([cm("a", 0), cm("b", 10)], 20))).toMatchObject({ state: "collecting", eligibleAt: at(25) });
    const r = ev(win([cm("a", 0), cm("b", 10)], 25));
    expect(r.state).toBe("ready");
    if (r.state === "ready") expect(r.batch.size).toBe(2);
  });
  it("B31-03 · exatamente no limite ⇒ pronta (inclusivo); 1 ms antes ⇒ coletando", () => {
    expect(ev(win([cm("a", 0)], 15)).state).toBe("ready");
    expect(ev({ ...win([cm("a", 0)], 15), now: new Date(T0 + 14_999).toISOString() }).state).toBe("collecting");
  });
  it("B31-04 · mensagem depois da elegibilidade e antes do claim ⇒ lote reavaliado (pronto volta a coletar)", () => {
    expect(ev(win([cm("a", 0)], 16)).state).toBe("ready");
    expect(ev(win([cm("a", 0), cm("b", 16)], 17))).toMatchObject({ state: "collecting", eligibleAt: at(31) });
    const r = ready(["a"], 16);
    const o = applyLeaseEvent(r, { type: "observe", messageIds: ["a", "b"], now: at(16) });
    expect(o).toMatchObject({ ok: true, effect: "applied", record: { state: "collecting", batchId: null } });
  });
  it("B31-05 · mensagem depois do claim não altera o lote reivindicado (fica para o próximo ciclo)", () => {
    const claimed = claim(ready(["a"]), "w1", 0);
    const o = applyLeaseEvent(claimed, { type: "observe", messageIds: ["a", "b"], now: at(20) });
    expect(o).toMatchObject({ ok: true, effect: "deferred" });
    if (o.ok) {
      expect(o.record.messageIds).toEqual(["a"]);
      expect(o.record.deferredMessageIds).toEqual(["b"]);
      expect(o.record.state).toBe("claimed");
    }
  });
  it("B31-06/07/08 · conversas, tenants e canais diferentes nunca se misturam", () => {
    expect(ev(win([cm("a", 0), cm("b", 1, { conversationId: "c2" })], 30))).toMatchObject({ state: "rejected", reason: "cross_conversation" });
    expect(ev(win([cm("a", 0), cm("b", 1, { tenantId: "t2" })], 30))).toMatchObject({ state: "rejected", reason: "cross_tenant" });
    expect(ev(win([cm("a", 0), cm("b", 1, { channel: "whatsapp" })], 30))).toMatchObject({ state: "rejected", reason: "cross_channel" });
    expect(ev(win([cm("a", 0), cm("b", 1, { propertyId: "p2" })], 30))).toMatchObject({ state: "rejected", reason: "cross_property" });
    expect(ev(win([cm("a", 0), cm("b", 1, { senderRole: "team" })], 30))).toMatchObject({ state: "rejected", reason: "non_guest_message" });
  });
  it("B31-09 · webhook duplicado ⇒ uma mensagem lógica; mesmo id com conteúdo diferente ⇒ recusa", () => {
    const r = ev(win([cm("a", 0), cm("a", 0)], 20));
    expect(r.state).toBe("ready");
    if (r.state === "ready") expect([r.batch.size, r.batch.duplicatesRemoved]).toEqual([1, ["a"]]);
    expect(ev(win([cm("a", 0), cm("a", 0, { text: "outro" })], 20))).toMatchObject({ state: "rejected", reason: "duplicate_conflict" });
  });
  it("B31-10 · fora de ordem ⇒ ordenação determinística (gravação + id); diferença com o canal é contada", () => {
    const msgs = [cm("c", 5, { tChannel: at(1) }), cm("a", 1), cm("b", 3)];
    const r1 = ev(win(msgs, 40));
    const r2 = ev(win([...msgs].reverse(), 40));
    expect(r1.state).toBe("ready");
    if (r1.state === "ready" && r2.state === "ready") {
      expect(r1.batch.messages.map((m) => m.id)).toEqual(["a", "b", "c"]);
      expect(r2.batch.batchId).toBe(r1.batch.batchId);
      expect(r1.metrics.reorderedByChannelTime).toBe(1);
    }
  });
  it("B31-11 · instante ausente ou inválido ⇒ estado tipado, sem inferência", () => {
    expect(ev(win([cm("a", 0, { tPersisted: null })], 30))).toMatchObject({ state: "rejected", reason: "invalid_timestamp" });
    expect(ev(win([cm("a", 0, { tChannel: "ontem" })], 30))).toMatchObject({ state: "rejected", reason: "invalid_timestamp" });
    expect(ev(win([cm("a", 0, { tReceived: "x" })], 30))).toMatchObject({ state: "rejected", reason: "invalid_timestamp" });
    expect(ev({ ...win([cm("a", 0)], 30), now: "agora" })).toMatchObject({ state: "rejected", reason: "invalid_timestamp" });
  });
  it("B31-12/13/14 · limites (20 mensagens, 4.000 por mensagem, 12.000 no lote) sem truncamento", () => {
    const twenty = Array.from({ length: 20 }, (_, k) => cm(`m${String(k).padStart(2, "0")}`, k));
    expect(ev(win(twenty, 60)).state).toBe("ready");
    expect(ev(win([...twenty, cm("m20", 20)], 60))).toMatchObject({ state: "rejected", reason: "too_many_messages" });
    expect(ev(win([cm("a", 0, { text: "x".repeat(4000) })], 60)).state).toBe("ready");
    expect(ev(win([cm("a", 0, { text: "x".repeat(4001) })], 60))).toMatchObject({ state: "rejected", reason: "message_too_large" });
    const big = [0, 1, 2, 3].map((k) => cm(`b${k}`, k, { text: "y".repeat(3001) }));
    const r = ev(win(big, 60));
    expect(r).toMatchObject({ state: "rejected", reason: "batch_too_large" });
    expect("batch" in r).toBe(false);
  });
  it("leitura das pendentes acima do teto ⇒ rejeitado (nunca lote parcial)", () => {
    expect(ev(win([cm("a", 0)], 60, { pendingOverflow: true }))).toMatchObject({ state: "rejected", reason: "pending_overflow" });
  });
  it("espera máxima contra inanição ⇒ fecha com `max_wait`", () => {
    const burst = Array.from({ length: 12 }, (_, k) => cm(`r${String(k).padStart(2, "0")}`, k * 11));
    const r = ev(win(burst, 125));
    expect(r).toMatchObject({ state: "ready", closure: "max_wait", eligibleAt: at(120) });
  });
});

describe("B3.1 · reconciliação de atrasos de webhook e pausa", () => {
  it("B31-23 · mensagem atrasada do canal: referência = max(canal, recebimento, gravação)", () => {
    // escrita no canal às 0 s, recebida aos 200 s (p99 real ≈ 211 s), gravada aos 201 s
    const m = cm("a", 201, { channel: "airbnb", tChannel: at(0), tReceived: at(200) });
    const r = ev(win([m], 210, { scope: { ...SCOPE, channel: "airbnb" } }));
    expect(r).toMatchObject({ state: "collecting", eligibleAt: at(216) });
    if (r.state === "collecting") expect(r.metrics.maxChannelToReceiveMs).toBe(200_000);
    // relógio do canal ADIANTADO (canal 205 s > gravação 201 s): a referência é o mais tardio
    const skew = cm("b", 201, { channel: "airbnb", tChannel: at(205), tReceived: at(200) });
    expect(ev(win([skew], 216, { scope: { ...SCOPE, channel: "airbnb" } }))).toMatchObject({ state: "collecting", eligibleAt: at(220) });
  });
  it("gravada sem bruto correspondente ⇒ espera a reconciliação; depois segue com canal desconhecido (contado)", () => {
    const m = cm("a", 0, { channel: "airbnb", tChannel: null, tReceived: null, rawMatched: false });
    const s = { scope: { ...SCOPE, channel: "airbnb" as const } };
    expect(ev(win([m], 30, s))).toMatchObject({ state: "collecting", reason: "awaiting_reconciliation", eligibleAt: at(60) });
    const r = ev(win([m], 61, s));
    expect(r).toMatchObject({ state: "ready" });
    if (r.state === "ready") expect(r.metrics.channelTimeUnknown).toBe(1);
  });
  it("bruto de hóspede ainda não gravado ⇒ não fecha o lote até a carência", () => {
    expect(ev(win([cm("a", 0)], 30, { unpersistedRawGuest: [{ tReceived: at(20), tChannel: at(19) }] }))).toMatchObject({ state: "collecting", reason: "awaiting_persistence", eligibleAt: at(80) });
    expect(ev(win([], 30, { unpersistedRawGuest: [{ tReceived: "x", tChannel: null }] }))).toMatchObject({ state: "rejected", reason: "invalid_timestamp" });
  });
  it("B31-24 · mensagem durante a pausa: nenhuma elegibilidade, nem retroativa depois do vencimento", () => {
    const pause = (nowSec: number) => noPause({ now: at(nowSec), persisted: [{ id: "h", role: "assistant", sender_type: "human", is_internal_note: false, created_at: at(0), external_id: null }] });
    // pausa até 600 s; hóspede escreveu aos 100 s
    expect(ev(win([cm("g", 100)], 200, { pause: pause(200) }))).toMatchObject({ state: "blocked", reason: "paused", retryAt: at(600) });
    expect(ev(win([cm("g", 100)], 700, { pause: pause(700) }))).toMatchObject({ state: "idle", reason: "paused_backlog_only", pausedBacklog: ["g"] });
    // nova mensagem depois do fim: só ela forma o lote; a da pausa fica no histórico (backlog)
    const r = ev(win([cm("g", 100), cm("n", 650)], 700, { pause: pause(700) }));
    expect(r).toMatchObject({ state: "ready", pausedBacklog: ["g"] });
    if (r.state === "ready") expect(r.batch.messages.map((m) => m.id)).toEqual(["n"]);
  });
  it("pausa desconhecida ou indeterminada ⇒ bloqueio (fail-closed)", () => {
    expect(ev(win([cm("a", 0)], 30, { pause: noPause({ lookup: "failed" }) }))).toMatchObject({ state: "blocked", reason: "pause_unknown" });
    expect(ev(win([cm("a", 0)], 30, { pause: noPause({ column: { ai_paused: true, paused_until: null } }) }))).toMatchObject({ state: "blocked", reason: "pause_indefinite" });
  });
  it("sem pendências ⇒ idle; já respondidas não entram", () => {
    expect(ev(win([], 30))).toMatchObject({ state: "idle", reason: "no_pending" });
    expect(ev(win([cm("a", 0)], 30, { alreadyAnswered: ["a"] }))).toMatchObject({ state: "idle", reason: "no_pending" });
  });
});

// ─────────────── Lease (máquina de estados) ───────────────
const ready = (ids: string[], at0 = 0): LeaseRecord => {
  // protocolo: observar as pendentes e fechar o lote com elas (o lote só aceita mensagens pendentes)
  const obs = applyLeaseEvent(newLeaseRecord("c1", at(at0)), { type: "observe", messageIds: ids, now: at(at0), expectedVersion: 0 });
  if (!obs.ok) throw new Error(obs.reason);
  const o = applyLeaseEvent(obs.record, { type: "mark_ready", batchId: "batch:x", messageIds: ids, expectedVersion: obs.record.version, now: at(at0) });
  if (!o.ok) throw new Error(o.reason);
  return o.record;
};
const claim = (r: LeaseRecord, token: string, sec: number, ttlMs = 60_000): LeaseRecord => {
  const o = applyLeaseEvent(r, { type: "claim", token, ttlMs, expectedVersion: r.version, now: at(sec) });
  if (!o.ok) throw new Error(o.reason);
  return o.record;
};

describe("B3.1 · lease por conversa — máquina de estados (compare-and-swap, token, expiração)", () => {
  it("B31-15 · duas instâncias com a MESMA versão: só a primeira transição vale; a outra recebe conflito", () => {
    const base = ready(["a"]);
    const w1 = applyLeaseEvent(base, { type: "claim", token: "w1", ttlMs: 60_000, expectedVersion: base.version, now: at(1) });
    expect(w1.ok).toBe(true);
    const stored = (w1 as { record: LeaseRecord }).record;
    // w2 leu a versão antiga ⇒ conflito de versão no compare-and-swap
    expect(applyLeaseEvent(stored, { type: "claim", token: "w2", ttlMs: 60_000, expectedVersion: base.version, now: at(1) })).toEqual({ ok: false, reason: "version_conflict" });
    // w2 relê e tenta de novo ⇒ lease de outro, ativo
    expect(applyLeaseEvent(stored, { type: "claim", token: "w2", ttlMs: 60_000, expectedVersion: stored.version, now: at(2) })).toEqual({ ok: false, reason: "lease_held" });
  });
  it("B31-16 · conversas diferentes são independentes (paralelas)", () => {
    const a = claim({ ...ready(["a"]), conversationId: "c1" }, "w1", 1);
    const b = claim({ ...ready(["b"]), conversationId: "c2" }, "w2", 1);
    expect([a.state, b.state, a.ownerToken, b.ownerToken]).toEqual(["claimed", "claimed", "w1", "w2"]);
  });
  it("B31-17/18 · lease expirado é recuperável; worker morto depois do claim não bloqueia nem perde mensagens", () => {
    const c = claim(ready(["a", "b"]), "w1", 0, 30_000);
    const exp = applyLeaseEvent(c, { type: "expire", now: at(31) });
    expect(exp).toMatchObject({ ok: true, record: { state: "expired", messageIds: ["a", "b"] } });
    const rec = claim((exp as { record: LeaseRecord }).record, "w2", 32);
    expect(rec).toMatchObject({ state: "claimed", ownerToken: "w2", attempts: 2, messageIds: ["a", "b"] });
    // recuperação direta (sem passar por expire) também respeita o prazo
    expect(applyLeaseEvent(c, { type: "claim", token: "w3", ttlMs: 1, expectedVersion: c.version, now: at(10) })).toEqual({ ok: false, reason: "lease_held" });
    expect(claim(c, "w3", 30)).toMatchObject({ ownerToken: "w3" });
  });
  it("B31-19 · worker antigo conclui depois do novo claim ⇒ não sobrescreve (stale_owner / version_conflict)", () => {
    const c1 = claim(ready(["a"]), "w1", 0, 30_000);
    const s1 = (applyLeaseEvent(c1, { type: "start", token: "w1", expectedVersion: c1.version, now: at(1) }) as { record: LeaseRecord }).record;
    const c2 = claim(s1, "w2", 40); // w1 morreu; prazo venceu aos 30 s
    expect(applyLeaseEvent(c2, { type: "complete", token: "w1", expectedVersion: s1.version, now: at(41) })).toEqual({ ok: false, reason: "version_conflict" });
    const s2 = (applyLeaseEvent(c2, { type: "start", token: "w2", expectedVersion: c2.version, now: at(41) }) as { record: LeaseRecord }).record;
    expect(applyLeaseEvent(s2, { type: "complete", token: "w1", expectedVersion: s2.version, now: at(42) })).toEqual({ ok: false, reason: "stale_owner" });
    // dono vencido também não conclui
    expect(applyLeaseEvent(s2, { type: "complete", token: "w2", expectedVersion: s2.version, now: at(200) })).toEqual({ ok: false, reason: "lease_expired" });
    expect(applyLeaseEvent(s2, { type: "complete", token: "w2", expectedVersion: s2.version, now: at(50) })).toMatchObject({ ok: true, record: { state: "completed" } });
  });
  it("B31-20 · reinício do processo: o estado vem do registro persistido (serializado), não de memória", () => {
    const c = claim(ready(["a"]), "w1", 0, 30_000);
    const restored = JSON.parse(JSON.stringify(c)) as LeaseRecord;
    expect(applyLeaseEvent(restored, { type: "claim", token: "w9", ttlMs: 1000, expectedVersion: restored.version, now: at(5) })).toEqual({ ok: false, reason: "lease_held" });
    expect(claim(restored, "w9", 31)).toMatchObject({ ownerToken: "w9" });
    // o coletor é função pura do estado persistido: mesma entrada ⇒ mesma decisão
    expect(ev(win([cm("a", 0)], 20))).toEqual(ev(win([cm("a", 0)], 20)));
  });
  it("B31-22 · retentativa do mesmo lote ⇒ sem duplicidade lógica", () => {
    const c = claim(ready(["a"]), "w1", 0);
    const s = (applyLeaseEvent(c, { type: "start", token: "w1", expectedVersion: c.version, now: at(1) }) as { record: LeaseRecord }).record;
    const done = (applyLeaseEvent(s, { type: "complete", token: "w1", expectedVersion: s.version, now: at(2) }) as { record: LeaseRecord }).record;
    expect(applyLeaseEvent(done, { type: "complete", token: "w1", expectedVersion: done.version, now: at(3) })).toEqual({ ok: false, reason: "already_processed" });
    expect(applyLeaseEvent(done, { type: "observe", messageIds: ["a"], now: at(4) })).toMatchObject({ ok: true, effect: "noop" });
    expect(applyLeaseEvent(done, { type: "observe", messageIds: ["a", "b"], now: at(5) })).toMatchObject({ ok: true, record: { state: "collecting", messageIds: ["b"] } });
  });
  it("falha: retentável volta a ready até o teto de tentativas; depois, failed; transição implícita é recusada", () => {
    let r = ready(["a"]);
    for (let k = 1; k <= MAX_ATTEMPTS; k++) {
      r = claim(r, `w${k}`, k * 100);
      const f = applyLeaseEvent(r, { type: "fail", token: `w${k}`, retryable: true, expectedVersion: r.version, now: at(k * 100 + 1) });
      r = (f as { record: LeaseRecord }).record;
    }
    expect(r.state).toBe("failed");
    const rd = ready(["a"]);
    expect(applyLeaseEvent(rd, { type: "start", token: "w", expectedVersion: rd.version, now: at(1) })).toEqual({ ok: false, reason: "invalid_transition" });
    expect(applyLeaseEvent(newLeaseRecord("c1", at(0)), { type: "claim", token: "w", ttlMs: 1, expectedVersion: 0, now: at(1) })).toEqual({ ok: false, reason: "invalid_transition" });
    const cancelled = applyLeaseEvent(rd, { type: "cancel", expectedVersion: rd.version, now: at(1) });
    expect(cancelled).toMatchObject({ ok: true, record: { state: "cancelled" } });
  });
  it("B31-27 · sem armazenamento transacional: backend indisponível e claim sempre recusado (nada em memória substitui o banco)", async () => {
    const backend = resolveLeaseBackend();
    expect(backend).toMatchObject({ available: false, reason: "no_store" });
    expect(await claimReadyBatch(backend, { conversationId: "c1" })).toEqual({ ok: false, reason: "lease_backend_unavailable" });
    // um armazenamento que não declara a garantia transacional (ex.: memória) é recusado
    const memory = { guarantee: "memory", load: async () => ready(["a"]), claim: async () => ({ result: "acquired" }), transition: async () => ({ result: "applied" }) } as unknown as DistributedLeaseStore;
    expect(resolveLeaseBackend(memory)).toMatchObject({ available: false, reason: "store_without_transactional_guarantee" });
    expect(await claimReadyBatch({ available: true, store: memory }, { conversationId: "c1" })).toEqual({ ok: false, reason: "lease_backend_unavailable" });
    // o gate é DERIVADO da evidência da suíte Postgres real (b31-lease-gate.test.ts confere os hashes)
    expect(B31_LEASE_GATE.distributedLeaseImplemented).toBe(true);
    expect(B31_LEASE_GATE.gateComplete).toBe(Object.values(B31_LEASE_GATE.runtimeCriteria).every(Boolean));
  });
});

describe("B3.1 · telemetria só por metadados", () => {
  const rec = (over: Partial<CollectorTelemetryRecord> = {}): Record<string, unknown> => ({
    version: COLLECTOR_TELEMETRY_VERSION, channel: "airbnb", conversationId: "c1", batchId: "batch:1a2b3c4d", messageCount: 2, firstMessageAt: at(0), lastMessageAt: at(5), lastReceivedAt: at(6), lastPersistedAt: at(7),
    eligibleAt: at(22), claimedAt: at(23), finishedAt: at(30), waitMs: 23_000, lateArrivals: 1, channelTimeUnknown: 0, reorderedByChannelTime: 0, pausedBacklog: 0, maxChannelToReceiveMs: 1000, maxReceiveToPersistMs: 1000,
    closureReason: "quiet_window", attempts: 1, leaseResult: "backend_unavailable", finalState: "pending", duplicatesRemoved: 0, ...over,
  });
  it("B31-25 · lista branca: texto, nome, telefone ou token ⇒ recusado; registro congelado", () => {
    const ok = buildCollectorTelemetry(rec());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(Object.isFrozen(ok.record)).toBe(true);
    for (const extra of [{ text: "Oi" }, { guestName: "Ana" }, { phone: "+55" }, { leaseToken: "abc" }, { content: "x" }]) expect(buildCollectorTelemetry({ ...rec(), ...extra })).toEqual({ ok: false, reason: "unknown_key" });
    expect(buildCollectorTelemetry(rec({ conversationId: "Olá, preciso de ajuda" as never }))).toEqual({ ok: false, reason: "invalid_value" });
    expect(buildCollectorTelemetry(rec({ firstMessageAt: "ontem" as never }))).toEqual({ ok: false, reason: "invalid_value" });
  });
  it("B31-26 · falha do coletor de telemetria não compromete o lote (erro engolido e contado)", () => {
    const decision = ev(win([cm("a", 0)], 20));
    expect(emitCollectorTelemetry(rec(), () => { throw new Error("sink"); })).toBe("sink_failed");
    expect(emitCollectorTelemetry(rec(), null)).toBe("no_sink");
    expect(ev(win([cm("a", 0)], 20))).toEqual(decision);
  });
  it("métricas: fragmentação por canal, chegadas tardias, distribuição, recuperações e recusas", () => {
    const rs = [
      rec({ conversationId: "c1", firstMessageAt: at(0), lastMessageAt: at(5) }),
      rec({ conversationId: "c1", firstMessageAt: at(30), lastMessageAt: at(30), messageCount: 1, leaseResult: "recovered_expired" }),
      rec({ conversationId: "c2", channel: "web", firstMessageAt: at(0), lastMessageAt: at(0), messageCount: 1, lateArrivals: 0, leaseResult: "held_by_other", finalState: "cancelled" }),
    ].map((r) => (buildCollectorTelemetry(r) as { record: CollectorTelemetryRecord }).record);
    const s = summarizeCollectorTelemetry(rs);
    expect(s.byChannel.airbnb).toMatchObject({ batches: 2, fragmentationRate: 0.5 });
    expect(s.byChannel.web).toMatchObject({ batches: 1, fragmentationRate: 0 });
    expect([s.leaseRecoveries, s.concurrentClaimsRefused, s.cancelled]).toEqual([1, 1, 1]);
    expect(s.sizeDistribution).toEqual({ "2": 1, "1": 2 });
  });
});

describe("B3.1 · configuração", () => {
  it("B31-28 · valor inicial = 15 s, configurável por canal, sem adaptação automática", () => {
    expect(COLLECTOR_DEFAULTS.quietWindowMs).toBe(15_000);
    expect(Object.isFrozen(COLLECTOR_DEFAULTS)).toBe(true);
    expect(quietWindowFor(COLLECTOR_DEFAULTS, "airbnb")).toBe(15_000);
    const cfg = { ...COLLECTOR_DEFAULTS, perChannel: { airbnb: { quietWindowMs: 10_000 } } };
    expect(quietWindowFor(cfg, "airbnb")).toBe(10_000);
    expect(ev({ ...win([cm("a", 0, { channel: "airbnb" })], 5, { scope: { ...SCOPE, channel: "airbnb" } }), config: cfg })).toMatchObject({ state: "collecting", eligibleAt: at(10) });
    expect(checkCollectorConfig({ ...COLLECTOR_DEFAULTS, quietWindowMs: 0 })).toBe("quiet_window_invalid");
    // faixa da diretriz: 8–15 s (limites inclusivos)
    expect(checkCollectorConfig({ ...COLLECTOR_DEFAULTS, quietWindowMs: 8_000 })).toBe("ok");
    expect(checkCollectorConfig({ ...COLLECTOR_DEFAULTS, quietWindowMs: 7_999 })).toBe("quiet_window_invalid");
    expect(checkCollectorConfig({ ...COLLECTOR_DEFAULTS, quietWindowMs: 15_001 })).toBe("quiet_window_invalid");
    expect(checkCollectorConfig({ ...COLLECTOR_DEFAULTS, perChannel: { airbnb: { quietWindowMs: 20_000 } } })).toBe("quiet_window_invalid");
    expect(checkCollectorConfig({ ...COLLECTOR_DEFAULTS, maxWaitMs: 1000 })).toBe("max_wait_invalid");
  });
});

// ─────────────── Loader real da janela (somente leitura) ───────────────
const THREAD = "0f9c7d2e-thread-0001";
const turn = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", { surface: "airbnb", conversationId: "c1", messageId: "m3", propertyId: "p1", tenantId: "t1", guestSessionId: `airbnb:${THREAD}`, conversationStatus: "ai", reservationId: null, messageCreatedAt: null, ...over }) as ValidatedTurn;
const msg = (id: string, sec: number, over: Row = {}): Row => ({ id, conversation_id: "c1", role: "user", sender_type: "guest", channel: "airbnb", is_internal_note: false, created_at: at(sec), external_id: `e-${id}`, content: `texto ${id}`, ...over });
const TP = "payload->payload->>message_thread_id";
const rawRow = (id: string, ext: string, sender: string, recv: number, chan: number): Row => ({ id, entity_type: "webhook:message", [TP]: THREAD, "payload->payload->>sender": sender, "payload->payload->>id": ext, first_seen_at: at(recv), channex_property_id: "cx-1", sender, inserted_at: at(chan), message_id: ext, ota_message_id: null });

describe("B3.1 · loader da janela do coletor (somente leitura)", () => {
  const world = (over: Partial<Record<string, Row[]>> = {}) => ({
    property_chat_messages: [msg("h0", -100, { role: "assistant", sender_type: "human", external_id: "e-h0" }), msg("m1", 0), msg("n1", 2, { is_internal_note: true, role: "assistant", sender_type: "human" }), msg("m2", 4), msg("m3", 9)],
    channex_raw_records: [rawRow("r1", "e-m1", "guest", 1, 0), rawRow("r2", "e-m2", "guest", 30, 3), rawRow("r9", "e-nao-gravada", "guest", 12, 11)],
    ...over,
  });
  it("pendentes = cauda de hóspede depois da última não-hóspede (nota interna ignorada); instantes ligados ao bruto", async () => {
    const { db, calls, writes } = fakeDb(world());
    const w = await fetchCollectorWindow(turn(), { db, nowMs: T0 + 20_000 });
    expect(w.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(w.messages[1]).toMatchObject({ tChannel: at(3), tReceived: at(30), tPersisted: at(4), rawMatched: true });
    expect(w.messages[2]).toMatchObject({ rawMatched: false, tChannel: null });
    expect(w.unpersistedRawGuest).toEqual([{ tReceived: at(12), tChannel: at(11) }]);
    expect(w.pendingOverflow).toBe(false);
    expect(writes).toEqual([]);
    expect(calls[0]).toMatchObject({ table: "property_chat_messages", select: "id, conversation_id, role, sender_type, channel, is_internal_note, created_at, external_id, content" });
    expect(calls[0]!.filters).toContainEqual(["eq", "conversation_id", "c1"]);
    for (const c of calls.filter((x) => x.table === "channex_raw_records")) expect(c.select).not.toMatch(/payload\s*(,|$)|->>message\b/);
    // fim a fim com o coletor: espera o bruto não gravado e a reconciliação de m3
    expect(evaluateCollectorWindow({ ...w, alreadyAnswered: [], pause: noPause(), now: at(20) })).toMatchObject({ state: "collecting", reason: "awaiting_reconciliation" });
  });
  it("bloco de hóspede maior que a leitura ⇒ pendingOverflow", async () => {
    const many = Array.from({ length: COLLECTOR_SCAN_ROWS + 1 }, (_, k) => msg(`g${String(k).padStart(2, "0")}`, k, { channel: "web", external_id: null }));
    const w = await fetchCollectorWindow(turn({ surface: "guide_chat", guestSessionId: "sess" }), { db: fakeDb({ property_chat_messages: many }).db, nowMs: T0 });
    expect(w.pendingOverflow).toBe(true);
  });
  it("B31-21 · falha temporária do banco ⇒ erro TIPADO (nunca 'sem pendências')", async () => {
    await expect(fetchCollectorWindow(turn(), { db: fakeDb(world(), { fail: { property_chat_messages: true } }).db, nowMs: T0 })).rejects.toMatchObject({ code: "collector_lookup_failed" });
    await expect(fetchCollectorWindow(turn(), { db: fakeDb(world(), { throwOn: ["channex_raw_records"] }).db, nowMs: T0 })).rejects.toMatchObject({ name: "GuestAiReadError" });
  });
  it("B31-09 no loader · bruto duplicado (reentrega) liga uma vez; sessão sem thread ⇒ erro", async () => {
    const w = await fetchCollectorWindow(turn(), { db: fakeDb(world({ channex_raw_records: [rawRow("r1", "e-m1", "guest", 1, 0), rawRow("r1b", "e-m1", "guest", 2, 0)] })).db, nowMs: T0 });
    expect(w.messages.find((m) => m.id === "m1")).toMatchObject({ tReceived: at(1) });
    await expect(fetchCollectorWindow(turn({ guestSessionId: "airbnb:" }), { db: fakeDb(world()).db, nowMs: T0 })).rejects.toThrow();
  });
});
