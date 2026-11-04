/**
 * B3.2 · pausa humana DERIVADA do histórico (persistidas + webhooks brutos + coluna). Matriz B32-38..60.
 * Política pura + loader real (banco falso de leitura) + integração na cadeia (sem Gateway, sem envio).
 */
import { describe, expect, it } from "vitest";
import {
  HUMAN_PAUSE_WINDOW_MS,
  deriveHumanPause,
  detectPausePreemption,
  guestMessageActionability,
  type HumanPauseInput,
  type PausePersistedRow,
  type PauseRawRow,
} from "@/lib/guest-ai/policy/human-pause";
import { loadHumanPauseSource, PAUSE_MAX_ROWS } from "@/lib/guest-ai/data/human-pause.server";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { fakeDb, type Row } from "./helpers/b3-fake-db";
import { CONV, ctx, harness, turn as chainTurn, v4 } from "./helpers/b23-chain";
import { burst, ownershipRow } from "./helpers/b25-fixtures";

const NOW = "2026-11-03T12:00:00.000Z";
const at = (min: number, sec = 0) => new Date(Date.parse(NOW) + min * 60_000 + sec * 1000).toISOString();
const human = (id: string, created_at: string, over: Partial<PausePersistedRow> = {}): PausePersistedRow => ({ id, role: "assistant", sender_type: "human", is_internal_note: false, created_at, external_id: null, ...over });
const guest = (id: string, created_at: string, over: Partial<PausePersistedRow> = {}): PausePersistedRow => ({ id, role: "user", sender_type: "guest", is_internal_note: false, created_at, external_id: null, ...over });
const raw = (id: string, sender: string | null, first_seen_at: string, inserted_at: string | null, over: Partial<PauseRawRow> = {}): PauseRawRow => ({ record_id: id, first_seen_at, sender, inserted_at, message_id: `ext-${id}`, ota_message_id: null, channex_property_id: "cx-1", ...over });
const input = (over: Partial<HumanPauseInput> = {}): HumanPauseInput => ({ lookup: "ok", now: NOW, column: { ai_paused: false, paused_until: null }, persisted: [], persistedComplete: true, raw: [], rawComplete: true, allowedSourcePropertyIds: ["cx-1"], ...over });

describe("B3.2 · pausa derivada — política", () => {
  it("B32-38 · mensagem humana pelo painel ⇒ pausa de 10 min a partir dela", () => {
    const p = deriveHumanPause(input({ persisted: [human("h1", at(-3))] }));
    expect(p).toMatchObject({ state: "paused", pausedUntil: at(7), reason: "recent_human_intervention", indefinite: false });
    expect(p.interventions.human_verified).toBe(1);
  });
  it("B32-39/40 · mensagem do anfitrião pelo Airbnb (sem usuário, `system`) e bruto `property` sem gravação ⇒ pausa", () => {
    expect(deriveHumanPause(input({ persisted: [human("s1", at(-2), { sender_type: "system" })] }))).toMatchObject({ state: "paused", pausedUntil: at(8) });
    const p = deriveHumanPause(input({ raw: [raw("r1", "property", at(-4), at(-5))] }));
    expect(p).toMatchObject({ state: "paused", pausedUntil: at(6) });
    expect(p.interventions.human_channel).toBe(1);
  });
  it("instante conservador: max(canal, recebimento, gravação) — webhook atrasado não encurta a pausa (P20/P27)", () => {
    // anfitrião respondeu no app às −10 min; webhook chegou às −2 min; gravado às −1 min ⇒ pausa até +9
    const p = deriveHumanPause(input({ persisted: [human("s1", at(-1), { sender_type: "system", external_id: "ext-r1" })], raw: [raw("r1", "property", at(-2), at(-10))] }));
    expect(p).toMatchObject({ state: "paused", pausedUntil: at(9) });
    // relógio do canal adiantado: o canal manda; ainda assim o máximo é usado
    expect(deriveHumanPause(input({ raw: [raw("r1", "property", at(-8), at(-3))] }))).toMatchObject({ pausedUntil: at(7) });
  });
  it("B32-41 · segunda mensagem humana após 9 min reinicia a janela integralmente", () => {
    const p = deriveHumanPause(input({ persisted: [human("h1", at(-12)), human("h2", at(-3))] }));
    expect(p).toMatchObject({ state: "paused", pausedUntil: at(7), latestInterventionAt: at(-3) });
  });
  it("B32-42 · exatamente no vencimento ainda é pausa; 1 ms depois, ativa", () => {
    expect(deriveHumanPause(input({ persisted: [human("h1", at(-10))] }))).toMatchObject({ state: "paused", pausedUntil: NOW });
    expect(deriveHumanPause(input({ now: new Date(Date.parse(NOW) + 1).toISOString(), persisted: [human("h1", at(-10))] }))).toMatchObject({ state: "active" });
    expect(HUMAN_PAUSE_WINDOW_MS).toBe(600_000);
  });
  it("B32-43/44/45 · acionabilidade: durante a pausa não; depois do fim, só ESTRITAMENTE posterior nos dois instantes", () => {
    const pausedNow = deriveHumanPause(input({ persisted: [human("h1", at(-3))] }));
    expect(guestMessageActionability({ tChannel: at(-1), tPersisted: at(-1) }, pausedNow)).toBe("paused_backlog");
    const ended = deriveHumanPause(input({ now: at(20), persisted: [human("h1", at(-3))] }));
    expect(ended.state).toBe("active");
    // enviada durante a pausa e entregue depois do fim (P23) ⇒ não responde retroativamente
    expect(guestMessageActionability({ tChannel: at(5), tPersisted: at(12) }, ended)).toBe("paused_backlog");
    // igual ao limite (P24) ⇒ não
    expect(guestMessageActionability({ tChannel: at(7), tPersisted: at(7) }, ended)).toBe("paused_backlog");
    // nova mensagem depois do fim ⇒ pode retomar
    expect(guestMessageActionability({ tChannel: at(15), tPersisted: at(15, 2) }, ended)).toBe("actionable");
    // canal desconhecido com pausa conhecida ⇒ não comprova que veio depois
    expect(guestMessageActionability({ tChannel: null, tPersisted: at(15) }, ended)).toBe("paused_backlog");
  });
  it("B32-46/47 · automação só com flag EXPLÍCITA; sem flag (heurística) a intervenção conta", () => {
    expect(deriveHumanPause(input({ raw: [raw("r1", "property", at(-2), at(-2), { automation: true })] }))).toMatchObject({ state: "active", automatedIgnored: 1 });
    expect(deriveHumanPause(input({ raw: [raw("r1", "property", at(-2), at(-2), { automation: null })] }))).toMatchObject({ state: "paused" });
  });
  it("B32-48 · remetente desconhecido ⇒ pausa preventiva (gravado ou bruto)", () => {
    expect(deriveHumanPause(input({ persisted: [human("x", at(-1), { sender_type: "bot" as never })] }))).toMatchObject({ state: "paused" });
    expect(deriveHumanPause(input({ persisted: [human("x", at(-1), { sender_type: "guest", role: "assistant" })] }))).toMatchObject({ state: "paused" });
    expect(deriveHumanPause(input({ raw: [raw("r", null, at(-1), at(-1))] }))).toMatchObject({ state: "paused", interventions: expect.objectContaining({ unknown_non_guest: 1 }) });
  });
  it("B32-49/50 · brutos entram na decisão; gravado + bruto do mesmo id contam UMA vez", () => {
    const p = deriveHumanPause(input({ persisted: [human("h", at(-2), { sender_type: "system", external_id: "ext-r1" })], raw: [raw("r1", "property", at(-2, -5), at(-3))] }));
    expect(p.interventions).toEqual({ human_verified: 0, human_channel: 0, system_unproven: 1, unknown_non_guest: 0 });
    // eco bruto da mensagem da própria IA (ligado pelo id) não pausa
    expect(deriveHumanPause(input({ persisted: [{ ...human("a", at(-2)), sender_type: "ai", external_id: "ext-r1" }], raw: [raw("r1", "property", at(-2), at(-2))] }))).toMatchObject({ state: "active", echoesIgnored: 1 });
    // bruto de hóspede não pausa
    expect(deriveHumanPause(input({ raw: [raw("r2", "guest", at(-1), at(-1))] }))).toMatchObject({ state: "active" });
  });
  it("B32-51 · coluna da equipe (pausa vigente com prazo ou indeterminada) prevalece", () => {
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: at(30) } }))).toMatchObject({ state: "paused", pausedUntil: at(30), reason: "column_pause" });
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: null } }))).toMatchObject({ state: "paused", indefinite: true });
    expect(guestMessageActionability({ tChannel: at(1), tPersisted: at(1) }, deriveHumanPause(input({ column: { ai_paused: true, paused_until: null } })))).toBe("blocked_indefinite");
  });
  it("F-09 (Entrega 3.1) · regra do SaaS na coluna, com o instante informado (relógio do PostgreSQL)", () => {
    // ai_paused=false ⇒ autorizada (mesmo com prazo futuro gravado)
    expect(deriveHumanPause(input({ column: { ai_paused: false, paused_until: at(30) } }))).toMatchObject({ state: "active", indefinite: false });
    expect(deriveHumanPause(input({ column: { ai_paused: false, paused_until: null } }))).toMatchObject({ state: "active", pausedUntil: null });
    // ai_paused=true e paused_until nulo ⇒ indeterminada
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: null } }))).toMatchObject({ state: "paused", indefinite: true });
    // ai_paused=true e now ≤ paused_until ⇒ vigente (igualdade inclusive)
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: at(0) } }))).toMatchObject({ state: "paused", indefinite: false, pausedUntil: at(0) });
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: at(5) } }))).toMatchObject({ state: "paused", pausedUntil: at(5) });
    // ai_paused=true e now > paused_until ⇒ expirada: autorizada; o fim da pausa ainda delimita o backlog
    const expired = deriveHumanPause(input({ column: { ai_paused: true, paused_until: at(-1) } }));
    expect(expired).toMatchObject({ state: "active", indefinite: false, pausedUntil: at(-1) });
    expect(guestMessageActionability({ tChannel: at(-2), tPersisted: at(-2) }, expired)).toBe("paused_backlog");
    expect(guestMessageActionability({ tChannel: at(0), tPersisted: at(0) }, expired)).toBe("actionable");
  });
  it("B32-52 · histórico mais restritivo que a coluna (coluna vencida/falsa) prevalece", () => {
    expect(deriveHumanPause(input({ column: { ai_paused: false, paused_until: at(-30) }, persisted: [human("h", at(-1))] }))).toMatchObject({ state: "paused", pausedUntil: at(9) });
  });
  it("B32-53/54/60 · leitura falha, instante inválido, histórico cortado ou coluna ilegível ⇒ unknown (bloqueio)", () => {
    expect(deriveHumanPause(input({ lookup: "failed" }))).toMatchObject({ state: "unknown", reason: "lookup_failed" });
    expect(deriveHumanPause(input({ persisted: [human("h", "ontem")] }))).toMatchObject({ state: "unknown", reason: "invalid_timestamp" });
    expect(deriveHumanPause(input({ raw: [raw("r", "property", at(-1), "xx")] }))).toMatchObject({ state: "unknown", reason: "invalid_timestamp" });
    expect(deriveHumanPause(input({ persistedComplete: false }))).toMatchObject({ state: "unknown", reason: "history_incomplete" });
    expect(deriveHumanPause(input({ rawComplete: false }))).toMatchObject({ state: "unknown" });
    expect(deriveHumanPause(input({ column: { ai_paused: "sim", paused_until: null } }))).toMatchObject({ state: "unknown", reason: "column_unreadable" });
    expect(deriveHumanPause(input({ now: "relógio" }))).toMatchObject({ state: "unknown" });
    expect(guestMessageActionability({ tChannel: at(1), tPersisted: at(1) }, deriveHumanPause(input({ lookup: "failed" })))).toBe("blocked_unknown");
  });
  it("divergência entre fontes (bruto anfitrião × gravado hóspede) ou bruto de outro imóvel ⇒ unknown (P25)", () => {
    expect(deriveHumanPause(input({ persisted: [guest("g", at(-1), { external_id: "ext-r1" })], raw: [raw("r1", "property", at(-1), at(-1))] }))).toMatchObject({ state: "unknown", reason: "source_conflict" });
    expect(deriveHumanPause(input({ raw: [raw("r1", "guest", at(-1), at(-1), { channex_property_id: "cx-9" })] }))).toMatchObject({ state: "unknown", reason: "source_conflict" });
  });
  it("B32-55 · não há trilha de auditoria de mensagens de chat: nada \"revoga\" uma intervenção — o histórico só ACRESCENTA pausa", () => {
    // limitação documentada: uma mensagem editada/apagada não reduz a pausa; o que está no histórico conta.
    const base = deriveHumanPause(input({ persisted: [human("h", at(-2))] }));
    const withMore = deriveHumanPause(input({ persisted: [human("h", at(-2)), guest("g", at(-1))] }));
    expect(withMore.pausedUntil).toBe(base.pausedUntil);
  });
  it("B32-56 · intervenção durante a execução simulada ⇒ resultado obsoleto (preempção)", () => {
    const before = deriveHumanPause(input());
    const after = deriveHumanPause(input({ persisted: [human("h", at(0, -5))] }));
    expect(detectPausePreemption(before, after)).toBe("preempted");
    expect(detectPausePreemption(before, before)).toBe("unchanged");
    expect(detectPausePreemption(before, deriveHumanPause(input({ lookup: "failed" })))).toBe("preempted");
  });
  it("B32-59 · nota interna da equipe não é mensagem ao hóspede: não pausa (classificação formal)", () => {
    expect(deriveHumanPause(input({ persisted: [human("n", at(-1), { is_internal_note: true })] }))).toMatchObject({ state: "active", internalNotesIgnored: 1 });
    // valor ilegível na marcação ⇒ preventivo
    expect(deriveHumanPause(input({ persisted: [human("n", at(-1), { is_internal_note: null })] }))).toMatchObject({ state: "paused" });
  });
});

const THREAD = "0f9c7d2e-thread-0001";
const T = (over: Partial<ValidatedTurn> = {}) =>
  issue("turn", { surface: "airbnb", conversationId: "c1", messageId: "m1", propertyId: "p1", tenantId: "t1", guestSessionId: `airbnb:${THREAD}`, conversationStatus: "ai", reservationId: null, messageCreatedAt: null, ...over }) as ValidatedTurn;
const TP = "payload->payload->>message_thread_id";
function world(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    property_chat_conversations: [{ id: "c1", property_id: "p1", ai_paused: false, paused_until: null }],
    property_chat_messages: [
      { id: "g1", conversation_id: "c1", role: "user", sender_type: "guest", is_internal_note: false, created_at: at(-20), external_id: "e-g1" },
      { id: "h1", conversation_id: "c1", role: "assistant", sender_type: "system", is_internal_note: false, created_at: at(-4), external_id: "e-h1" },
      { id: "x9", conversation_id: "c-outra", role: "assistant", sender_type: "human", is_internal_note: false, created_at: at(-1), external_id: null },
    ],
    channex_raw_records: [
      { id: "r1", entity_type: "webhook:message", [TP]: THREAD, "payload->payload->>sender": "property", first_seen_at: at(-5), channex_property_id: "cx-1", sender: "property", inserted_at: at(-6), message_id: "e-h1", ota_message_id: null },
      { id: "r2", entity_type: "webhook:message", [TP]: THREAD, "payload->payload->>sender": "property", first_seen_at: at(-2), channex_property_id: "cx-1", sender: "property", inserted_at: at(-3), message_id: "e-nunca-gravada", ota_message_id: null },
      { id: "r3", entity_type: "webhook:message", [TP]: "outra", "payload->payload->>sender": "property", first_seen_at: at(-1), channex_property_id: "cx-7", sender: "property", inserted_at: at(-1), message_id: "e-x", ota_message_id: null },
    ],
    property_listing_raw_data: [{ property_id: "p1", owner_id: "t1", channex_property_id: "cx-1" }],
    channex_twin_links: [],
    ...over,
  };
}

describe("B3.2 · pausa derivada — loader real (somente leitura)", () => {
  it("lê coluna, mensagens SEM texto e brutos da thread do turno; mensagem do anfitrião nunca gravada pausa", async () => {
    const { db, calls, writes } = fakeDb(world());
    const src = await loadHumanPauseSource(T(), { db, nowMs: Date.parse(NOW) });
    const p = deriveHumanPause({ ...src, now: NOW });
    expect(p).toMatchObject({ state: "paused", pausedUntil: at(8) }); // bruto r2 (recebido −2) é o mais recente
    expect(p.interventions).toMatchObject({ system_unproven: 1, human_channel: 1 });
    expect(writes).toEqual([]);
    const msg = calls.filter((c) => c.table === "property_chat_messages");
    for (const c of msg) {
      expect(c.select).toBe("id, role, sender_type, is_internal_note, created_at, external_id");
      expect(c.filters).toContainEqual(["eq", "conversation_id", "c1"]);
    }
    const rawCalls = calls.filter((c) => c.table === "channex_raw_records");
    for (const c of rawCalls) {
      expect(c.filters).toContainEqual(["eq", TP, THREAD]);
      expect(c.select).not.toMatch(/payload\s*(,|$)|->>message\b|content/);
    }
  });
  it("conversa de outro imóvel, sessão sem thread, falha ou exceção ⇒ lookup failed ⇒ unknown", async () => {
    const bad = [
      fakeDb(world({ property_chat_conversations: [{ id: "c1", property_id: "p2", ai_paused: false, paused_until: null }] })).db,
      fakeDb(world(), { fail: { property_chat_messages: true } }).db,
      fakeDb(world(), { throwOn: ["channex_raw_records"] }).db,
      fakeDb(world({ property_listing_raw_data: [{ property_id: "p1", owner_id: "t-outro", channex_property_id: "cx-1" }] })).db,
    ];
    for (const db of bad) expect(deriveHumanPause({ ...(await loadHumanPauseSource(T(), { db, nowMs: Date.parse(NOW) })), now: NOW }).state).toBe("unknown");
    expect(deriveHumanPause({ ...(await loadHumanPauseSource(T({ guestSessionId: "airbnb:" }), { db: fakeDb(world()).db, nowMs: Date.parse(NOW) })), now: NOW }).state).toBe("unknown");
  });
  it("acima do teto de leitura ⇒ histórico incompleto ⇒ unknown (nunca lista cortada como completa)", async () => {
    const many = Array.from({ length: PAUSE_MAX_ROWS + 2 }, (_, k) => ({ id: `g${k}`, conversation_id: "c1", role: "user", sender_type: "guest", is_internal_note: false, created_at: at(-10, k % 50), external_id: null }));
    const src = await loadHumanPauseSource(T({ surface: "guide_chat", guestSessionId: "sess" }), { db: fakeDb(world({ property_chat_messages: many })).db, nowMs: Date.parse(NOW) });
    expect(deriveHumanPause({ ...src, now: NOW })).toMatchObject({ state: "unknown", reason: "history_incomplete" });
  });
  it("intervenção mais antiga que a janela de leitura ainda é considerada (lida à parte)", async () => {
    const w = world({ property_chat_messages: [{ id: "h-old", conversation_id: "c1", role: "assistant", sender_type: "human", is_internal_note: false, created_at: at(-45), external_id: null }], channex_raw_records: [] });
    const src = await loadHumanPauseSource(T({ surface: "guide_chat", guestSessionId: "sess" }), { db: fakeDb(w).db, nowMs: Date.parse(NOW) });
    expect(deriveHumanPause({ ...src, now: NOW })).toMatchObject({ state: "active", latestInterventionAt: at(-45), pausedUntil: at(-35) });
  });
});

describe("B3.2 · pausa derivada na cadeia (veto; sem Gateway, sem envio)", () => {
  const T0 = Date.parse(NOW);
  const pauseSrc = (over: Partial<HumanPauseInput> = {}) => {
    const { now: _n, ...rest } = input({ allowedSourcePropertyIds: null, ...over });
    return rest;
  };
  it("pausa derivada ativa ⇒ resposta recusada (mesmo veto da pausa da equipe)", async () => {
    const h = harness(v4(), { now: () => T0, loadConversationOwnership: async () => ownershipRow(), loadHumanPause: async () => pauseSrc({ persisted: [human("h", at(-2))] }) });
    const r = await runTurnChain({ turn: chainTurn(), traceId: "p" }, h.deps);
    expect(r).toMatchObject({ kind: "refused", code: "reply_during_pause" });
    expect(r.audit.checks.derivedPause).toBe("paused");
  });
  it("B32-53 na cadeia · falha ao ler a pausa ⇒ unknown ⇒ veto (nunca 'sem pausa')", async () => {
    const h = harness(v4(), { now: () => T0, loadConversationOwnership: async () => ownershipRow(), loadHumanPause: async () => { throw new Error("db"); } });
    const r = await runTurnChain({ turn: chainTurn(), traceId: "p" }, h.deps);
    expect(r.kind).not.toBe("reply");
    expect(r.audit.checks.derivedPause).toBe("unknown");
  });
  it("B32-57/58 · pausa vencida com chamado aberto: a pausa não vira bloqueio permanente; o chamado continua protegido por assunto", async () => {
    const h = harness(v4({ caseRelation: "independent" }), {
      now: () => T0,
      loadConversationOwnership: async () => ownershipRow({ status: "needs_human", handoff_reason: "Ar-condicionado", handoff_at: at(-60) }),
      loadContext: async () => ctx({ openCases: [{ id: CONV, source: "conversation_status", topic: null, status: "needs_human" }] }, [{ caseId: CONV, status: "needs_human", handoffReason: "Ar-condicionado", handoffAt: at(-60) }]),
      loadHumanPause: async () => pauseSrc({ persisted: [human("h", at(-30))] }),
    });
    const r = await runTurnChain({ turn: chainTurn(), traceId: "p" }, h.deps);
    expect(r.audit.checks.derivedPause).toBe("active");
    expect(r.audit.checks.pause).toBe("inactive");
    expect(r.audit.checks.humanOwnership).toBe("awaiting_human");
    expect({ kind: r.kind, code: (r as { code?: string }).code }).toEqual({ kind: "reply", code: undefined }); // assunto independente segue
  });
  it("B31-24/B32-44 na cadeia · lote com mensagem da pausa (mesmo depois do vencimento) ⇒ recusado", async () => {
    const b = burst();
    // intervenção às 09:55 ⇒ pausa até 10:05; o lote tem mensagens 10:00–10:15 ⇒ contém mensagens da pausa
    const h = harness(v4(), { now: () => Date.parse("2026-11-03T10:30:00Z"), loadHistory: async () => b.historyResult, loadConversationOwnership: async () => ownershipRow(), loadHumanPause: async () => pauseSrc({ persisted: [human("h", "2026-11-03T09:55:00.000Z")] }) });
    const r = await runTurnChain({ turn: chainTurn(), traceId: "p", batch: b.batch }, h.deps);
    expect(r).toMatchObject({ kind: "refused", code: "batch_contains_paused_messages" });
    expect(h.calls.generate).toBe(0);
  });
});

describe("B3.2 · ramos fail-closed restantes da política (fechados na Entrega 3.1, junto com F-09)", () => {
  it("entradas ilegíveis ⇒ unknown com o motivo certo (nunca autorização)", () => {
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: "não é instante" as never } }))).toMatchObject({ state: "unknown", reason: "column_unreadable" });
    expect(deriveHumanPause(input({ raw: [{ ...raw("r1", "property", at(-1), at(-1)), record_id: null as never }] }))).toMatchObject({ state: "unknown", reason: "history_incomplete" });
    expect(deriveHumanPause(input({ persisted: [{ ...human("h1", at(-1)), id: 7 as never }] }))).toMatchObject({ state: "unknown", reason: "history_incomplete" });
    // bruto casado com mensagem humana gravada e instante do canal ilegível
    expect(deriveHumanPause(input({ persisted: [human("h1", at(-1), { external_id: "ext-r1" })], raw: [raw("r1", "property", at(-1), "x")] }))).toMatchObject({ state: "unknown", reason: "invalid_timestamp" });
  });
  it("mensagem humana gravada cujos brutos são TODOS automação ⇒ ignorada (não pausa); parte automação ⇒ pausa", () => {
    const all = deriveHumanPause(input({ persisted: [human("h1", at(-1), { external_id: "ext-r1" })], raw: [raw("r1", "property", at(-1), at(-1), { automation: true } as never)] }));
    expect(all).toMatchObject({ state: "active", automatedIgnored: 1 });
    const mixed = deriveHumanPause(input({ persisted: [human("h1", at(-1), { external_id: "ext-r1" })], raw: [raw("r1", "property", at(-1), at(-1), { automation: true } as never), raw("r2", "property", at(-1), at(-1), { message_id: "x2", ota_message_id: "ext-r1", automation: false } as never)] }));
    expect(mixed.state).toBe("paused");
  });
  it("pausa indeterminada da coluna + intervenção recente no histórico ⇒ indeterminada, com o fim do histórico registrado", () => {
    expect(deriveHumanPause(input({ column: { ai_paused: true, paused_until: null }, persisted: [human("h1", at(-1))] }))).toMatchObject({ state: "paused", indefinite: true, reason: "column_pause", pausedUntil: at(9) });
  });
  it("pausa da coluna mais longa que a do histórico ⇒ motivo `column_pause`", () => {
    const p = deriveHumanPause(input({ column: { ai_paused: true, paused_until: at(60) }, persisted: [human("h1", at(-1))] }));
    expect(p).toMatchObject({ state: "paused", reason: "column_pause", pausedUntil: at(60) });
  });
  it("acionabilidade: instante de gravação ou de canal ilegível ⇒ blocked_unknown; pausa sem fim conhecido fora de `active` ⇒ blocked_unknown", () => {
    const active = deriveHumanPause(input());
    expect(guestMessageActionability({ tChannel: at(1), tPersisted: "x" }, active)).toBe("blocked_unknown");
    expect(guestMessageActionability({ tChannel: "x", tPersisted: at(1) }, active)).toBe("blocked_unknown");
    expect(guestMessageActionability({ tChannel: at(1), tPersisted: at(1) }, { ...active, state: "paused", pausedUntil: null })).toBe("blocked_unknown");
  });
  it("preempção: leitura ilegível antes OU depois ⇒ preempted; sem intervenção nos dois lados ⇒ unchanged", () => {
    const a = deriveHumanPause(input());
    const u = deriveHumanPause(input({ lookup: "failed" }));
    expect(detectPausePreemption(u, a)).toBe("preempted");
    expect(detectPausePreemption(a, u)).toBe("preempted");
    expect(detectPausePreemption(null as never, a)).toBe("preempted");
    expect(detectPausePreemption(a, a)).toBe("unchanged");
    const h = deriveHumanPause(input({ persisted: [human("h1", at(-30))] }));
    expect(detectPausePreemption(h, h)).toBe("unchanged");
    expect(detectPausePreemption(a, h)).toBe("preempted");
    expect(detectPausePreemption(h, a)).toBe("unchanged");
  });
});
