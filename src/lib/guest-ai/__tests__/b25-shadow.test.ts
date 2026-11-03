/**
 * B2.5 · Harness Shadow consolidado: todos os cenários da F2-B2 passam pelo pipeline completo
 * (lote → contexto → pausa → autorizações → identidade de envio → composição → mock → parser →
 * validadores → decisão final), sempre passivo, com telemetria sem conteúdo sensível.
 */
import { describe, expect, it } from "vitest";
import { runShadowTurn, type ShadowHarnessDeps, type ShadowTurnResult } from "@/lib/guest-ai/shadow/harness";
import { createLlmMock, type LlmMockSpec } from "@/lib/guest-ai/shadow/llm-mock";
import type { ShadowTurnRecord } from "@/lib/guest-ai/shadow/telemetry";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { CONV, ctx, currentRef, history, turn, v4 } from "./helpers/b23-chain";
import { CH_PREF, R6, burst, operationalPorts, ownershipRow, senderSource, stayCard, staySource } from "./helpers/b25-fixtures";

const T0 = Date.parse("2026-11-03T12:00:00Z");
const quiet = (over: Record<string, unknown> = {}) => v4({ strategy: "silence", reply: "", shouldReply: false, intents: ["acknowledgment"], groundedOn: [], ...over });
const custom = (output: Record<string, unknown> | string): LlmMockSpec => ({ scenario: "custom", output });
const airbnbCtx = async () => ctx({ interlocutor: { ...ctx().guest.interlocutor, surface: "airbnb" } });

interface Scenario {
  name: string;
  model: LlmMockSpec;
  ports?: Partial<ShadowHarnessDeps["ports"]>;
  turn?: ValidatedTurn;
  batch?: ReturnType<typeof burst>;
  extra?: Partial<ShadowHarnessDeps>;
  expect: { kind: string; code?: string; blocks?: string[] };
}

const SECRET_MARKERS = ["4471", "senha", "gás", "Socorro", "caminhonete", "chuveiro", "cofre", "wa:5511988887777", CH_PREF];

async function exec(s: Scenario, records: ShadowTurnRecord[] = []): Promise<ShadowTurnResult> {
  const d: ShadowHarnessDeps = {
    ports: operationalPorts({ ...(s.batch ? { loadHistory: async () => s.batch!.historyResult } : {}), ...s.ports }),
    model: createLlmMock(s.model),
    guard: SECRET_SCRUBBER,
    now: () => T0,
    telemetry: (r) => void records.push(r),
    ...s.extra,
  };
  return runShadowTurn({ turn: s.turn ?? turn(), traceId: "b25-shadow", ...(s.batch ? { batch: s.batch.batch } : {}) }, d);
}

const SCENARIOS: Scenario[] = [
  { name: "rajada de mensagens (lote único, uma decisão)", batch: burst(), model: custom(v4({ reply: "É coberto e cabe, sim.", groundedOn: ["hist:guest:h4"] })), expect: { kind: "reply" } },
  { name: "lote com segredo fatiado entre mensagens", batch: burst(["a senha", "do cofre", "é 44", "71"]), model: custom(v4()), expect: { kind: "refused", code: "guard_ambiguous" } },
  { name: "promessa só no texto (sem estrutura)", model: custom(v4({ reply: "Já confirmei sua entrada antecipada para as 12h." })), expect: { kind: "refused", code: "semantic_block", blocks: ["text_completion_without_evidence"] } },
  { name: "tipo de compromisso incorreto", model: custom(v4({ reply: "Vou liberar sua entrada antecipada.", commitments: ["x"], commitmentKinds: ["team_relay"], strategy: "answer_and_handoff", handoff: { needed: true, question: "q", urgency: "low" } })), expect: { kind: "refused", blocks: ["text_commitment_undeclared"] } },
  {
    name: "horário prometido igual ao R6",
    ports: { loadStayAuthorizationSource: async () => staySource([stayCard(R6)]) },
    model: custom(v4({ reply: "Pode sair às 13h.", commitments: ["s"], commitmentKinds: ["late_checkout"], groundedOn: ["ctx:saida_tardia"], promisedTimes: [{ kind: "late_checkout", date: "2026-11-07", time: "13:00", timezone: "America/Sao_Paulo" }] })),
    expect: { kind: "reply" },
  },
  {
    name: "horário prometido divergente do R6",
    ports: { loadStayAuthorizationSource: async () => staySource([stayCard(R6)]) },
    model: custom(v4({ reply: "Pode sair às 14h.", commitments: ["s"], commitmentKinds: ["late_checkout"], groundedOn: ["ctx:saida_tardia"], promisedTimes: [{ kind: "late_checkout", date: "2026-11-07", time: "14:00", timezone: "America/Sao_Paulo" }] })),
    expect: { kind: "refused", blocks: ["invalid_commitment_time"] },
  },
  { name: "entrada antecipada (sempre não autorizada)", model: custom(v4({ reply: "Pode entrar às 12h.", commitments: ["e"], commitmentKinds: ["early_checkin"], promisedTimes: [{ kind: "early_checkin", date: "2026-11-04", time: "12:00", timezone: "America/Sao_Paulo" }] })), expect: { kind: "refused", blocks: ["unauthorized_commitment"] } },
  { name: "IA pausada + resposta", ports: { loadConversationOwnership: async () => ownershipRow({ ai_paused: true }) }, model: custom(v4()), expect: { kind: "refused", code: "reply_during_pause" } },
  { name: "IA pausada + silêncio", ports: { loadConversationOwnership: async () => ownershipRow({ ai_paused: true }) }, model: custom(quiet()), expect: { kind: "paused" } },
  {
    name: "IA pausada + emergência comprovada",
    ports: { loadConversationOwnership: async () => ownershipRow({ ai_paused: true }), loadHistory: async () => history("Socorro, cheiro de gás!") },
    model: custom(quiet({ strategy: "handoff", intents: ["emergency"], handoff: { needed: true, question: "Possível vazamento de gás", urgency: "high" }, groundedOn: [currentRef()] })),
    expect: { kind: "urgent_internal_alert" },
  },
  {
    name: "chamado aberto + novo assunto independente",
    ports: {
      loadContext: async () => ctx({ openCases: [{ id: CONV, source: "conversation_status", topic: null, status: "needs_human" }] }, [{ caseId: CONV, status: "needs_human", handoffReason: null, handoffAt: null }]),
      loadConversationOwnership: async () => ownershipRow({ status: "needs_human", handoff_reason: "Chuveiro", handoff_at: "2026-11-03T10:00:00Z" }),
    },
    model: custom(v4({ caseRelation: "independent" })),
    expect: { kind: "reply" },
  },
  { name: "identidade de envio resolvida (airbnb) — despacho só preparado", turn: turn({ surface: "airbnb" }), ports: { loadContext: airbnbCtx }, model: custom(v4()), expect: { kind: "reply" } },
  { name: "identidade de envio ambígua (airbnb) — resposta bloqueada para despacho", turn: turn({ surface: "airbnb" }), ports: { loadContext: airbnbCtx, loadSenderIdentitySource: async () => senderSource({ prefs: [] , listings: [] }) }, model: custom(v4()), expect: { kind: "reply" } },
  { name: "falha de leitura da identidade de envio", turn: turn({ surface: "airbnb" }), ports: { loadContext: airbnbCtx, loadSenderIdentitySource: async () => { throw new Error("db"); } }, model: custom(v4()), expect: { kind: "reply" } },
  { name: "JSON inválido do modelo", model: { scenario: "invalid_json" }, expect: { kind: "refused", code: "parse_malformed_json" } },
  { name: "tempo esgotado", model: { scenario: "timeout" }, extra: { stageTimeoutMs: 30 }, expect: { kind: "technical_error", code: "stage_timeout" } },
  { name: "erro técnico do modelo", model: { scenario: "technical_error" }, expect: { kind: "technical_error", code: "model_call_failed" } },
];

describe("B2.5 · harness consolidado — todos os cenários, sempre passivo", () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))("%s", async (_n, s) => {
    const records: ShadowTurnRecord[] = [];
    const r = await exec(s, records);
    expect(r).toMatchObject({ kind: "executed", delivery: "not_sent", effectsExecuted: false, modelMode: "mock" });
    if (r.kind !== "executed") return;
    expect(r.outcome).toMatchObject({ kind: s.expect.kind, delivery: "not_sent", effectsExecuted: false });
    if (s.expect.code) expect((r.outcome as { code?: string }).code).toBe(s.expect.code);
    for (const b of s.expect.blocks ?? []) expect([...r.outcome.audit.structuralBlocks, ...r.outcome.audit.semanticBlocks]).toContain(b);
    // Telemetria: registrada, congelada, sem texto/segredo/identificador de canal.
    expect(r.telemetry).toBe("recorded");
    expect(records).toHaveLength(1);
    const json = JSON.stringify(records[0]);
    for (const m of SECRET_MARKERS) expect(json, m).not.toContain(m);
    expect(json).not.toMatch(/"(reply|content|question|commitments|senderChannelId|evidenceRefs)"\s*:/);
    // `security.text` é só o resumo da verificação (idioma e tipos), nunca o texto.
    const t = records[0]!.security.text;
    if (t) expect(Object.keys(t).sort()).toEqual(["detectedKinds", "language", "undeclaredKinds"]);
    expect(records[0]!.versions).toMatchObject({ decisionContract: 4 });
    expect(Object.isFrozen(records[0])).toBe(true);
    if (r.outcome.kind === "reply") expect(r.outcome.dispatch.sendAuthorization).toBe("not_granted");
  });

  it("identidade: resolvida ⇒ aguardando autorização; ambígua/falha ⇒ bloqueado; telemetria só com status/fonte/motivo", async () => {
    const ok = await exec(SCENARIOS.find((s) => s.name.startsWith("identidade de envio resolvida"))!);
    const amb = await exec(SCENARIOS.find((s) => s.name.startsWith("identidade de envio ambígua"))!);
    const fail = await exec(SCENARIOS.find((s) => s.name.startsWith("falha de leitura"))!);
    const state = (r: ShadowTurnResult) => (r.kind === "executed" && r.outcome.kind === "reply" ? r.outcome.dispatch.state : null);
    expect(state(ok)).toBe("awaiting_send_authorization");
    expect(state(amb)).toBe("blocked_sender_identity");
    expect(state(fail)).toBe("blocked_sender_identity");
    if (ok.kind === "executed") expect(ok.record.security.senderIdentity).toEqual({ status: "resolved", source: "host_preference", reason: null });
  });

  it("lote: a rajada vira UM prompt (todas as mensagens marcadas) e o lote é auditado", async () => {
    const s = SCENARIOS[0]!;
    const r = await exec(s);
    expect(r.kind === "executed" && r.outcome.audit.checks.batch).toMatchObject({ size: 4 });
    expect(r.kind === "executed" && r.record.execution.stagesCompleted.filter((x) => x === "model_output")).toHaveLength(1);
  });

  it("cancelamento externo ⇒ stage_aborted, nada produzido", async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await exec({ name: "cancel", model: custom(v4()), extra: { signal: ac.signal }, expect: { kind: "technical_error" } });
    expect(r.kind === "executed" && r.outcome).toMatchObject({ kind: "technical_error", code: "stage_aborted" });
    expect(r.kind === "executed" && r.record.execution.aborted).toBe(true);
  });

  it("falha da telemetria não altera a decisão nem lança", async () => {
    const r = await exec({ name: "tel", model: custom(v4()), extra: { telemetry: () => { throw new Error("collector down"); } }, expect: { kind: "reply" } });
    expect(r).toMatchObject({ kind: "executed", telemetry: "failed", outcome: { kind: "reply" } });
  });
});
