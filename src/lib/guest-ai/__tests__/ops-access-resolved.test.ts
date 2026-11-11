/**
 * BASTIDORES · caso real de 10/11/2026 (Renan Siqueira, Studio 103): problema de senha/cadeado resolvido pela
 * equipe, o hóspede disse "Agora consegui" e o card de check-in ficou pendente. Cobre, sem tocar a produção:
 *  1. o leitor NUNCA perde a mensagem inteira por causa de número/código (só o segredo é trocado);
 *  2. acesso destravado ("agora consegui", "abriu", "deu certo", "já peguei a chave") com suporte de acesso antes,
 *     no dia do check-in, vira check-in concluído; sem o contexto, fora do dia, com negação/pergunta ⇒ recusa;
 *  3. toda leitura que NÃO avança o card deixa o motivo exato na auditoria (`guest_ai_ops_actions`);
 *  4. os prazos do leitor respeitam o teto do Gateway (PR #86).
 */
import { describe, expect, it } from "vitest";
import {
  buildOpsExtractorInput,
  opsExtractorTimeoutMs,
  OPS_EXTRACTOR_SYSTEM,
  OPS_EXTRACTOR_TIMEOUT_MS,
  parseOpsSignals,
  readOpsSignals,
  readerReasonFor,
} from "@/lib/guest-ai/copilot/ops-extractor.server";
import type { HistoryResult } from "@/lib/guest-ai/history";
import { LIMITS } from "@/lib/guest-ai/llm/contracts";
import type { ProviderOutcome } from "@/lib/guest-ai/llm/providers/types";
import type { OpsState } from "@/lib/guest-ai/data/ops-state.server";
import { recordOpsNoAdvance } from "@/lib/guest-ai/ops/executor.server";
import { OPS_REFUSAL_CODES } from "@/lib/guest-ai/ops/contracts";
import { accessResolvedMarker, accessSupportContext, lexicalGuard } from "@/lib/guest-ai/ops/lexical";
import { evaluateOpsSignals, type OpsHistoryEntry, type OpsPolicyInput } from "@/lib/guest-ai/ops/policy";
import type { ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import type { ValidatedTurn } from "@/lib/guest-ai/types";
import { fakeProvider, okJson } from "./helpers/copilot-provider";
import { v5 } from "./helpers/b23-chain";

const TZ = "America/Sao_Paulo";

/** Conversa real (horários em UTC; em São Paulo = 21:34 a 21:40 de 10/11). */
const RENAN: Array<{ speaker: "guest" | "team"; text: string; at: string }> = [
  { speaker: "team", text: "Olá Renan, bem-vindo! Qualquer dúvida, estamos por aqui.", at: "2026-11-10T22:00:00Z" },
  { speaker: "guest", text: "Senha errada", at: "2026-11-11T00:34:57Z" },
  { speaker: "guest", text: "Senha errada do cofre da chave", at: "2026-11-11T00:35:20Z" },
  { speaker: "guest", text: "Não funcionou", at: "2026-11-11T00:36:00Z" },
  { speaker: "team", text: "Renan, o cofre é o cadeado da direita. Digite o código 2610 nele, por favor.", at: "2026-11-11T00:36:38Z" },
  { speaker: "guest", text: "Digitei 2610 no cadeado", at: "2026-11-11T00:38:10Z" },
  { speaker: "team", text: "Por favor, nos confirme se encontrou o imóvel conforme o esperado.", at: "2026-11-11T00:39:00Z" },
  { speaker: "guest", text: "Agora consegui", at: "2026-11-11T00:40:28Z" },
  { speaker: "guest", text: "Muito obrigado", at: "2026-11-11T00:40:42Z" },
];
const NOW = new Date("2026-11-11T00:41:00Z"); // 21:41 de 10/11 em São Paulo

function entries(rows = RENAN): OpsHistoryEntry[] {
  return rows.map((r, i) => ({
    ref: `hist:${r.speaker}:h${i + 1}`,
    messageId: `m${i + 1}`,
    speaker: r.speaker,
    text: r.text,
    at: r.at,
  }));
}
function hist(rows = RENAN): HistoryResult {
  return {
    status: "available",
    entries: rows.map((r, i) => ({
      ref: `hist:${r.speaker}:h${i + 1}`,
      messageId: `m${i + 1}`,
      speaker: r.speaker,
      channel: "airbnb",
      at: r.at,
      text: r.text,
      media: null,
      delivery: "delivered",
      current: i === rows.length - 1,
    })),
  } as unknown as HistoryResult;
}

const milestone = (quote: string, evidence: string[]): ModelDecision =>
  ({
    ...(v5() as unknown as ModelDecision),
    hospitalityMilestone: { kind: "checkin_confirmed", evidence },
    milestoneQuote: quote,
  }) as ModelDecision;

const policyInput = (over: Partial<OpsPolicyInput> = {}, rows = RENAN): OpsPolicyInput => ({
  decision: milestone("Agora consegui", ["hist:guest:h8"]),
  history: entries(rows),
  phase: "in_stay",
  timezone: TZ,
  now: NOW,
  reservation: { id: "r1", status: "confirmed", checkinDate: "2026-11-10", checkoutDate: "2026-11-11" },
  conversation: {
    status: "assigned",
    assignedTo: "u1",
    handoffReason: null,
    handoffUrgency: null,
    aiPaused: true,
    pausedUntil: null,
  },
  cards: { checkin: null, checkout: null },
  property: { checkinTime: "15:00", checkinTimeMax: null, checkoutTime: "11:00", checkoutTimeMin: null },
  defaultHandoffReason: "PADRAO",
  ...over,
});
const one = (i: OpsPolicyInput) => {
  const r = evaluateOpsSignals(i);
  expect(r).toHaveLength(1);
  return r[0]!;
};

describe("Acesso destravado ⇒ check-in (regra factual de hospitalidade)", () => {
  it("CASO REAL: 'Agora consegui' depois do suporte de senha/cadeado, no dia da entrada, com a equipe no comando ⇒ avança o card", () => {
    expect(one(policyInput())).toMatchObject({
      action: "checkin_done",
      outcome: "would_apply",
      code: null,
      evidenceMessageId: "m8",
    });
  });
  it.each([
    ["Abriu", "Abriu!"],
    ["Deu certo", "Deu certo, obrigado"],
    ["Já peguei a chave", "Já peguei a chave"],
    ["Funcionou", "Funcionou agora"],
    ["Conseguimos", "Conseguimos abrir, valeu"],
  ])("'%s' no contexto de suporte à entrada ⇒ would_apply", (quote, text) => {
    const rows = [...RENAN.slice(0, 7), { speaker: "guest" as const, text, at: "2026-11-11T00:40:28Z" }];
    expect(one(policyInput({ decision: milestone(quote, ["hist:guest:h8"]) }, rows))).toMatchObject({
      outcome: "would_apply",
    });
  });
  it("a palavra de problema do próprio contexto na mesma frase não bloqueia ('senha errada, agora consegui')", () => {
    const rows = [...RENAN.slice(0, 7), { speaker: "guest" as const, text: "A senha estava errada, agora consegui", at: "2026-11-11T00:40:28Z" }];
    expect(one(policyInput({ decision: milestone("agora consegui", ["hist:guest:h8"]) }, rows)).outcome).toBe("would_apply");
  });
  it("madrugada da noite da entrada (00:40 do dia seguinte) ainda é o dia do check-in", () => {
    expect(one(policyInput({ now: new Date("2026-11-11T03:40:00Z") })).outcome).toBe("would_apply");
  });

  it("frase solta, sem suporte de acesso antes ⇒ recusa (access_context_missing)", () => {
    const rows = [RENAN[0]!, { speaker: "guest" as const, text: "Agora consegui", at: "2026-11-11T00:40:28Z" }];
    expect(one(policyInput({ decision: milestone("Agora consegui", ["hist:guest:h2"]) }, rows))).toMatchObject({
      outcome: "refused",
      code: "access_context_missing",
    });
  });
  it("fora do dia do check-in ⇒ recusa (not_checkin_day)", () => {
    expect(one(policyInput({ now: new Date("2026-11-12T20:00:00Z") })).code).toBe("not_checkin_day");
    // 05:00 do dia seguinte já não é madrugada da noite da entrada
    expect(one(policyInput({ now: new Date("2026-11-11T08:30:00Z") })).code).toBe("not_checkin_day");
  });
  it("antes do horário oficial de entrada continua valendo o item 5 (not_in_stay)", () => {
    expect(one(policyInput({ phase: "pre_stay" })).code).toBe("not_in_stay");
  });
  it("negação, pergunta e futuro continuam recusando", () => {
    for (const [quote, text, code] of [
      ["Ainda não consegui", "Ainda não consegui", "lexical_negation"],
      ["Será que agora consegui?", "Será que agora consegui?", "lexical_question"],
      ["Vou tentar de novo quando consegui", "Vou tentar de novo quando consegui", "lexical_future"],
    ] as const) {
      const rows = [...RENAN.slice(0, 7), { speaker: "guest" as const, text, at: "2026-11-11T00:40:28Z" }];
      expect(one(policyInput({ decision: milestone(quote, ["hist:guest:h8"]) }, rows)).code, text).toBe(code);
    }
  });
  it("card já concluído ⇒ recusa (card_done), mesmo com a frase certa", () => {
    const done = { status: "done", doneAt: "2026-11-11T00:30:00Z", arrivalTimeOverride: null, arrivalTimeSource: null, mutedUntil: null, lateCheckoutTime: null, lateCheckoutApprovedAt: null };
    expect(one(policyInput({ cards: { checkin: done, checkout: null } })).code).toBe("card_done");
  });
  it("trecho que não é do turno corrente do hóspede continua recusado (evidência)", () => {
    expect(one(policyInput({ decision: milestone("Agora consegui", ["hist:team:h7"]) })).code).toBe("evidence_not_guest");
  });
});

describe("léxico do acesso destravado", () => {
  it("marcadores positivos e negativos", () => {
    for (const s of ["agora consegui", "abriu", "deu certo", "ja peguei a chave", "funcionou", "got it open", "ya abri"])
      expect(accessResolvedMarker(s), s).toBe(true);
    for (const s of ["onde fica a chave?", "vou abrir depois", "obrigado", "abrir"]) expect(accessResolvedMarker(s), s).toBe(false);
  });
  it("no acesso destravado, 'problema' do contexto não bloqueia; fora dele continua bloqueando", () => {
    expect(lexicalGuard("o problema era o cadeado, agora consegui", "checkin_done")).toBeNull();
    expect(lexicalGuard("estou com problema na porta", "checkin_done")).toBe("lexical_problem");
    expect(lexicalGuard("consegui entrar no app", "checkin_done")).toBe("lexical_not_property_access");
  });
  it("suporte de acesso: o hóspede relatou dificuldade com o assunto de acesso; só saudação da equipe/IA não conta; 6 h de janela", () => {
    const at = "2026-11-11T00:40:28Z";
    expect(accessSupportContext([{ speaker: "guest", text: "Senha errada", at: "2026-11-11T00:34:00Z" }], at)).toBe(true);
    expect(
      accessSupportContext(
        [
          { speaker: "guest", text: "Não funcionou", at: "2026-11-11T00:35:00Z" },
          { speaker: "team", text: "Use o cadeado da direita", at: "2026-11-11T00:36:00Z" },
        ],
        at,
      ),
    ).toBe(true);
    expect(accessSupportContext([{ speaker: "team", text: "Seu código de acesso será liberado hoje", at: "2026-11-11T00:36:00Z" }], at)).toBe(false);
    expect(accessSupportContext([{ speaker: "legacy_ai", text: "Seu código de acesso é enviado hoje", at: "2026-11-11T00:30:00Z" }], at)).toBe(false);
    expect(accessSupportContext([{ speaker: "guest", text: "Bom dia, que horas é o check-in?" }], at)).toBe(false);
    expect(accessSupportContext([{ speaker: "guest", text: "Senha errada", at: "2026-11-10T10:00:00Z" }], at)).toBe(false);
  });
});

describe("leitor: nunca perde a mensagem inteira por causa de número ou código", () => {
  const input = (over: Record<string, unknown> = {}) => ({
    history: hist(),
    phase: "in_stay" as const,
    timezone: TZ,
    checkInAt: "2026-11-10T18:00:00Z",
    checkOutAt: "2026-11-11T14:00:00Z",
    now: NOW,
    traceId: "t",
    remainingMs: () => 20_000,
    signal: new AbortController().signal,
    ...over,
  });
  const messages = (b: { user: string }) => JSON.parse(b.user.slice(b.user.indexOf("\n") + 1)).mensagens as Array<{ texto: string; atual: boolean; falante: string }>;

  it("'digitei … no cadeado' e a explicação da equipe chegam ao leitor com só o código trocado", () => {
    const m = messages(buildOpsExtractorInput(input())!);
    expect(m.some((x) => x.texto === "[mensagem omitida]")).toBe(false);
    const dig = m.find((x) => /Digitei/.test(x.texto))!;
    expect(dig.texto).toMatch(/Digitei .*no cadeado/);
    expect(dig.texto).not.toContain("2610");
    const team = m.find((x) => /cofre é o cadeado/.test(x.texto))!;
    expect(team.texto).toMatch(/cadeado da direita/);
    expect(team.texto).not.toContain("2610");
    expect(m.filter((x) => x.atual).map((x) => x.texto)).toEqual(["Agora consegui", "Muito obrigado"]);
  });
  it("código solto numa mensagem própria (valor dividido) também chega sem o número, nunca omitido", () => {
    const rows = [
      { speaker: "team" as const, text: "O código do cadeado é", at: "2026-11-11T00:36:00Z" },
      { speaker: "guest" as const, text: "2610", at: "2026-11-11T00:37:00Z" },
      { speaker: "guest" as const, text: "Agora consegui", at: "2026-11-11T00:40:00Z" },
    ];
    const m = messages(buildOpsExtractorInput(input({ history: hist(rows) }))!);
    expect(m.map((x) => x.texto).join("|")).not.toContain("2610");
    expect(m.every((x) => x.texto !== "[mensagem omitida]")).toBe(true);
  });
  it("só conteúdo bloqueado (chave privada) é retido por inteiro", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----";
    const rows = [{ speaker: "guest" as const, text: pem, at: "2026-11-11T00:36:00Z" }, { speaker: "guest" as const, text: "Agora consegui", at: "2026-11-11T00:40:00Z" }];
    const m = messages(buildOpsExtractorInput(input({ history: hist(rows) }))!);
    expect(m[0]!.texto).toBe("[mensagem omitida]");
    expect(m[1]!.texto).toBe("Agora consegui");
  });
  it("o prompt manda tratar '[segredo removido]' como diálogo e ACESSO DESTRAVADO como entrada, e pede o motivo da abstenção", () => {
    expect(OPS_EXTRACTOR_SYSTEM).toContain("[segredo removido]");
    expect(OPS_EXTRACTOR_SYSTEM).toMatch(/ACESSO DESTRAVADO = ENTRADA/);
    expect(OPS_EXTRACTOR_SYSTEM).toContain("milestoneAbstain");
  });
});

describe("leitor: o motivo de cada saída sem sinal", () => {
  const base = (over: Record<string, unknown> = {}) => ({
    history: hist(),
    phase: "in_stay" as const,
    timezone: TZ,
    checkInAt: "2026-11-10T18:00:00Z",
    checkOutAt: "2026-11-11T14:00:00Z",
    now: NOW,
    traceId: "t",
    remainingMs: () => 20_000,
    signal: new AbortController().signal,
    ...over,
  });
  const read = (provider: ReturnType<typeof fakeProvider>, over: Record<string, unknown> = {}) =>
    readOpsSignals(base(over) as never, { provider, log: () => {} });

  it("marco declarado ⇒ sinal e nenhum motivo", async () => {
    const r = await read(fakeProvider(okJson({ hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h8"] }, milestoneQuote: "Agora consegui", milestoneAbstain: null, guestEtas: [] })));
    expect(r.reason).toBeNull();
    expect(r.signals?.hospitalityMilestone).toEqual({ kind: "checkin_confirmed", evidence: ["hist:guest:h8"] });
  });
  it("leitor sem marco ⇒ o próprio código do leitor vira o motivo; sem código ⇒ reader_no_signal", async () => {
    const a = await read(fakeProvider(okJson({ hospitalityMilestone: null, milestoneQuote: null, milestoneAbstain: "context_unclear", guestEtas: [] })));
    expect(a.reason).toBe("reader_abstain_context_unclear");
    const b = await read(fakeProvider(okJson({ hospitalityMilestone: null, milestoneQuote: null, guestEtas: [] })));
    expect(b.reason).toBe("reader_no_signal");
    const c = await read(fakeProvider(okJson({ hospitalityMilestone: null, milestoneQuote: null, milestoneAbstain: "texto livre", guestEtas: [] })));
    expect(c.reason).toBe("reader_no_signal");
  });
  it("falhas ⇒ código fechado: sem histórico, sem fuso, prazo curto, abortado, erro do provedor, JSON inválido", async () => {
    expect((await read(fakeProvider(okJson({})), { history: null })).reason).toBe("reader_no_history");
    expect((await read(fakeProvider(okJson({})), { timezone: null })).reason).toBe("reader_no_timezone");
    expect((await read(fakeProvider(okJson({})), { remainingMs: () => 800 })).reason).toBe("reader_deadline");
    const ac = new AbortController();
    ac.abort();
    expect((await read(fakeProvider(okJson({})), { signal: ac.signal })).reason).toBe("reader_deadline");
    const err: ProviderOutcome = { kind: "error", error: { code: "bad_request", retryable: false } as never, usage: null, requestId: null };
    expect((await read(fakeProvider(err))).reason).toBe("reader_model_failed");
    const bad: ProviderOutcome = { kind: "ok", text: "não é json", finishReason: "stop", usage: null, requestId: null };
    expect((await read(fakeProvider(bad))).reason).toBe("reader_invalid_output");
    const to: ProviderOutcome = { kind: "error", error: { code: "timeout", retryable: true } as never, usage: null, requestId: null };
    expect((await read(fakeProvider(to))).reason).toBe("reader_timeout");
  });
  it("parseOpsSignals valida o código de abstenção e ignora quando há marco", () => {
    const cur = ["hist:guest:h8"];
    expect(parseOpsSignals({ milestoneAbstain: "access_unresolved" }, cur).milestoneAbstain).toBe("access_unresolved");
    expect(parseOpsSignals({ milestoneAbstain: "xx" }, cur).milestoneAbstain).toBeNull();
    expect(readerReasonFor(parseOpsSignals({ milestoneAbstain: "no_fact" }, cur))).toBe("reader_abstain_no_fact");
  });
  it("todos os códigos do leitor existem na lista fechada de motivos e cabem na regex da auditoria", () => {
    const rx = /^[a-z][a-z0-9_]{0,63}$/;
    for (const c of OPS_REFUSAL_CODES.filter((x) => x.startsWith("reader_"))) expect(rx.test(c), c).toBe(true);
    for (const c of ["not_checkin_day", "access_context_missing"] as const) expect(OPS_REFUSAL_CODES).toContain(c);
  });
});

describe("PR #86: prazos do leitor dentro do teto do Gateway", () => {
  it("o prazo nunca passa do próprio teto do leitor, do que resta da geração nem do teto do Gateway", () => {
    expect(OPS_EXTRACTOR_TIMEOUT_MS).toBeLessThanOrEqual(LIMITS.maxTimeoutMs);
    expect(opsExtractorTimeoutMs(60_000)).toBe(OPS_EXTRACTOR_TIMEOUT_MS);
    expect(opsExtractorTimeoutMs(3_000)).toBe(3_000);
    expect(opsExtractorTimeoutMs(500_000)).toBeLessThanOrEqual(LIMITS.maxTimeoutMs);
  });
  it("a chamada ao modelo sai com prazo ≤ teto do Gateway, mesmo com muito tempo sobrando, e em raciocínio baixo", async () => {
    let seen: { reasoningEffort?: unknown } | null = null;
    const p = fakeProvider(okJson({ hospitalityMilestone: null, milestoneQuote: null, guestEtas: [] }));
    const spy = { ...p, complete: async (req: never, s: AbortSignal) => ((seen = req), p.complete(req, s)) };
    const t0 = Date.now();
    await readOpsSignals(
      { history: hist(), phase: "in_stay", timezone: TZ, checkInAt: null, checkOutAt: null, now: NOW, traceId: "t", remainingMs: () => 600_000, signal: new AbortController().signal },
      { provider: spy as never, log: () => {} },
    );
    expect(Date.now() - t0).toBeLessThan(LIMITS.maxTimeoutMs);
    expect(seen!.reasoningEffort).toBe("low");
  });
});

describe("auditoria: o 'não avançou' fica registrado com o motivo exato", () => {
  const TURN = {
    surface: "airbnb",
    conversationId: "c1000000-0000-4000-8000-000000000001",
    messageId: "e1000000-0000-4000-8000-000000000001",
    propertyId: "b1000000-0000-4000-8000-000000000001",
    tenantId: "a1000000-0000-4000-8000-000000000001",
  } as unknown as ValidatedTurn;
  const card = (over: Record<string, unknown> = {}) => ({
    status: "pending", doneAt: null, arrivalTimeOverride: null, arrivalTimeSource: null, mutedUntil: null, lateCheckoutTime: null, lateCheckoutApprovedAt: null, ...over,
  });
  const state = (cards: OpsState["cards"]): OpsState =>
    ({
      conversation: { status: "assigned", assignedTo: null, handoffReason: null, handoffUrgency: null, aiPaused: true, pausedUntil: null },
      reservation: { id: "r1", status: "confirmed", checkinDate: "2026-11-10", checkoutDate: "2026-11-11" },
      cards,
      property: { checkinTime: "15:00", checkinTimeMax: null, checkoutTime: "11:00", checkoutTimeMin: null },
    }) as never;
  const fakeRpc = (result = "recorded") => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    return { calls, rpc: { call: async (fn: string, args: Record<string, unknown>) => (calls.push({ fn, args }), { data: { result }, error: null }) } as never };
  };
  const run = (st: OpsState, phase: "pre_stay" | "in_stay" | "post_checkout", env: Record<string, string> = { GUEST_AI_OPS_MODE: "live" }, r = fakeRpc()) =>
    recordOpsNoAdvance({ turn: TURN, phase, code: "reader_abstain_context_unclear", suggestionId: "s1" }, { env, loadState: async () => st, rpc: r.rpc }).then((res) => ({ res, calls: r.calls }));

  it("card de entrada pendente na estadia ⇒ linha 'refused' em checkin_done com o código do leitor", async () => {
    const { res, calls } = await run(state({ checkin: card(), checkout: null }), "in_stay");
    expect(res).toEqual({ status: "recorded" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe("guest_ai_ops_record");
    expect(calls[0]!.args).toMatchObject({
      p_action: "checkin_done",
      p_outcome: "refused",
      p_code: "reader_abstain_context_unclear",
      p_mode: "live",
      p_trigger_message_id: TURN.messageId,
      p_reservation_id: "r1",
      p_suggestion_id: "s1",
      p_evidence_message_id: null,
    });
  });
  it("entrada já concluída, saída pendente ⇒ a linha é do card de saída", async () => {
    const { calls } = await run(state({ checkin: card({ status: "done", doneAt: "2026-11-10T21:00:00Z" }), checkout: null }), "in_stay");
    expect(calls[0]!.args.p_action).toBe("checkout_done");
  });
  it("nenhum card pendente, fase sem card ou modo off ⇒ não grava (nada a avançar)", async () => {
    const done = card({ status: "done", doneAt: "2026-11-10T21:00:00Z" });
    expect((await run(state({ checkin: done, checkout: done }), "in_stay")).calls).toHaveLength(0);
    expect((await run(state({ checkin: card(), checkout: done }), "post_checkout")).res).toEqual({ status: "no_pending_card" });
    expect((await run(state({ checkin: card(), checkout: null }), "in_stay", { GUEST_AI_OPS_MODE: "off" })).res).toEqual({ status: "off" });
  });
  it("modo shadow registra com mode=shadow; banco que já tem a linha ⇒ 'exists'; falha do banco nunca lança", async () => {
    expect((await run(state({ checkin: card(), checkout: null }), "in_stay", { GUEST_AI_OPS_MODE: "shadow" })).calls[0]!.args.p_mode).toBe("shadow");
    expect((await run(state({ checkin: card(), checkout: null }), "in_stay", { GUEST_AI_OPS_MODE: "live" }, fakeRpc("exists"))).res).toEqual({ status: "exists" });
    const boom = { call: async () => { throw new Error("x"); } } as never;
    const out = await recordOpsNoAdvance({ turn: TURN, phase: "in_stay", code: "reader_no_signal", suggestionId: null }, { env: { GUEST_AI_OPS_MODE: "live" }, loadState: async () => state({ checkin: card(), checkout: null }), rpc: boom });
    expect(out).toEqual({ status: "error" });
  });
});
