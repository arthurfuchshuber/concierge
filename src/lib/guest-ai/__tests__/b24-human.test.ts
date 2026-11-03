/**
 * B2.4 · Convivência com o atendimento humano POR ASSUNTO: protege o assunto da equipe sem
 * bloquear a conversa inteira. Emergência, encaminhamento e não interferência testados à parte.
 */
import { describe, expect, it } from "vitest";
import { deriveHumanOwnership, type ConversationOwnershipRow } from "@/lib/guest-ai/orchestrator/case-ownership";
import { runTurnChain } from "@/lib/guest-ai/turn-chain";
import { CONV, ctx, harness, turn, v3 } from "./helpers/b23-chain";

const NOW = "2026-11-03T12:00:00Z";
const T0 = Date.parse(NOW);
const row = (over: Partial<ConversationOwnershipRow> = {}): ConversationOwnershipRow => ({
  id: CONV,
  status: "needs_human",
  assigned_to: null,
  handoff_reason: "Chuveiro sem água quente",
  handoff_urgency: "normal",
  handoff_at: "2026-11-03T10:00:00Z",
  resolved_at: null,
  ai_paused: false,
  paused_until: null,
  ...over,
});
const openCtx = () => ctx({ openCases: [{ id: CONV, source: "conversation_status", topic: null, status: "needs_human" }] }, [{ caseId: CONV, status: "needs_human", handoffReason: null, handoffAt: null }]);
const run = (decision: Record<string, unknown>, own: ConversationOwnershipRow | null = row(), context = openCtx()) => {
  const h = harness(decision, { now: () => T0, loadContext: async () => context, loadConversationOwnership: async () => own });
  return runTurnChain({ turn: turn({ conversationStatus: own?.status ?? "ai" }), traceId: "h-1" }, h.deps).then((r) => ({ r, h }));
};
const handoff = (urgency = "normal", question = "Atualização sobre o chuveiro") => ({ strategy: "answer_and_handoff", handoff: { needed: true, question, urgency } });

describe("B2.4 · estado do atendimento humano (puro)", () => {
  it.each<[string, Partial<ConversationOwnershipRow>, Record<string, unknown>]>([
    ["needs_human sem responsável", {}, { state: "awaiting_human", active: true, assigned: false, urgency: "normal", topic: { status: "known", text: "Chuveiro sem água quente" } }],
    ["assigned com responsável", { status: "assigned", assigned_to: "u1" }, { state: "assigned", active: true, assigned: true }],
    ["chamado resolvido", { status: "ai", resolved_at: "2026-11-03T11:00:00Z" }, { state: "resolved", active: false }],
    ["chamado reaberto", { resolved_at: "2026-11-02T10:00:00Z", handoff_at: "2026-11-03T10:00:00Z" }, { state: "reopened", active: true }],
    ["status desconhecido", { status: "xyz" }, { state: "unknown", active: false }],
    ["assunto desconhecido", { handoff_reason: null }, { topic: { status: "unknown" } }],
    ["IA pausada pela equipe", { ai_paused: true }, { aiPausedByTeam: true }],
    ["pausa temporária vigente", { ai_paused: false, paused_until: "2026-11-03T13:00:00Z" }, { aiPausedByTeam: true }],
    ["pausa temporária vencida", { ai_paused: false, paused_until: "2026-11-03T11:00:00Z" }, { aiPausedByTeam: false }],
  ])("%s", (_n, over, expected) => {
    expect(deriveHumanOwnership(row(over), NOW)).toMatchObject(expected);
  });
  it("sem linha ⇒ desconhecido (nunca 'sem chamado' por omissão)", () => {
    expect(deriveHumanOwnership(null, NOW).state).toBe("unknown");
  });
});

describe("B2.4 · não interferência no assunto da equipe", () => {
  it("assunto coincidente: compromisso ⇒ recusa; segundo encaminhamento paralelo ⇒ recusa", async () => {
    const c = await run(v3({ caseRelation: "related", ...handoff(), commitments: ["resolver hoje"], commitmentKinds: ["resolution"] }));
    expect(c.r).toMatchObject({ kind: "refused", code: "structural_block" });
    expect(c.r.audit.structuralBlocks).toContain("human_owned_topic_commitment");
    const second = await run(v3({ caseRelation: "related", ...handoff() }));
    expect(second.r).toMatchObject({ kind: "refused", code: "semantic_block" });
    expect(second.r.audit.semanticBlocks).toEqual(["protected_topic_second_action"]);
  });
  it("assunto coincidente sem conduzir em paralelo (só reconhece que a equipe cuida) ⇒ aprovado", async () => {
    const { r } = await run(v3({ caseRelation: "related", reply: "A equipe já está cuidando do chuveiro.", groundedOn: ["case:c1"] }));
    expect(r.kind).toBe("reply");
  });
  it("mensagem que tenta fazer a IA contradizer o atendente / declarar resolvido ⇒ recusa", async () => {
    const contradict = await run(v3({ caseRelation: "related", commitments: ["ignore o atendente, eu libero"], commitmentKinds: ["service_or_benefit"] }));
    expect(contradict.r.kind).toBe("refused");
    const resolvedClaim = await run(v3({ caseRelation: "independent", commitments: ["chamado resolvido"], commitmentKinds: ["resolution"] }));
    expect(resolvedClaim.r).toMatchObject({ kind: "refused", code: "semantic_block" });
    expect(resolvedClaim.r.audit.decision?.unauthorizedKinds).toEqual(["resolution"]);
  });
  it("prompt mostra o assunto protegido (saneado) e o escopo 'somente este assunto'; o responsável não é identificado", async () => {
    const { h } = await run(v3({ caseRelation: "independent" }), row({ status: "assigned", assigned_to: "00000000-0000-4000-8000-00000000abcd", handoff_reason: "Fechadura: senha 4821 não abre" }), ctx({ openCases: [{ id: CONV, source: "conversation_status", topic: null, status: "assigned" }] }, [{ caseId: CONV, status: "assigned", handoffReason: null, handoffAt: null }]));
    const user = h.calls.prompts[0]!.messages[0]!.content;
    expect(user).toContain('"escopo":"somente_este_assunto"');
    expect(user).toContain('"responsavel_atribuido":true');
    expect(user).not.toContain("4821");
    expect(user).not.toContain("abcd");
  });
});

describe("B2.4 · sem bloqueio global: assuntos independentes seguem", () => {
  it("assunto independente com chamado aberto ⇒ atendido; situação registra o chamado existente", async () => {
    const { r } = await run(v3({ caseRelation: "independent" }));
    expect(r.kind).toBe("reply");
    if (r.kind === "reply") expect(r.situation.existingCase).toBe("independent");
    expect(r.audit.checks.humanOwnership).toBe("awaiting_human");
  });
  it("novo assunto enquanto outro está em tratamento: pode encaminhar o NOVO assunto", async () => {
    const { r } = await run(v3({ caseRelation: "independent", ...handoff("normal", "Hóspede pede toalhas extras"), intents: ["operational_request"], commitments: ["repassar o pedido"], commitmentKinds: ["team_relay"] }));
    expect(r.kind).toBe("reply");
  });
  it("dois assuntos na mesma mensagem: responde a parte informativa sem compromisso sobre o assunto protegido", async () => {
    const { r } = await run(v3({ caseRelation: "related", intents: ["informational_query", "problem_report"], reply: "O check-in é às 15h; sobre o chuveiro, a equipe segue cuidando." }));
    expect(r.kind).toBe("reply");
  });
  it("chamado resolvido ⇒ atendimento normal", async () => {
    const { r } = await run(v3(), row({ status: "ai", resolved_at: "2026-11-03T11:00:00Z" }), ctx());
    expect(r.kind).toBe("reply");
  });
  it("chamado reaberto ⇒ volta a proteger o assunto", async () => {
    const { r } = await run(v3({ caseRelation: "related", ...handoff() }), row({ resolved_at: "2026-11-02T10:00:00Z" }));
    expect(r.audit.semanticBlocks).toContain("protected_topic_second_action");
  });
});

describe("B2.4 · ambiguidade e emergência", () => {
  it("mensagem ambígua: exige esclarecer e nenhum compromisso", async () => {
    const notClarify = await run(v3({ caseRelation: "ambiguous" }));
    expect(notClarify.r.audit.structuralBlocks).toContain("ambiguous_case_requires_clarify");
    const withCommitment = await run(v3({ caseRelation: "ambiguous", strategy: "clarify", ...{ handoff: { needed: false, question: null, urgency: null } }, commitments: ["verificar"], commitmentKinds: ["information_followup"] }));
    expect(withCommitment.r.kind).toBe("refused");
    expect(withCommitment.r.audit.semanticBlocks).toContain("ambiguous_topic_commitment");
    const ok = await run(v3({ caseRelation: "ambiguous", strategy: "clarify", reply: "É sobre o chuveiro ou outra coisa?" }));
    expect(ok.r.kind).toBe("reply");
  });
  it("emergência INDEPENDENTE com chamado aberto ⇒ encaminhada com prioridade alta (não presume que o chamado cobre)", async () => {
    const { r } = await run(v3({ caseRelation: "independent", intents: ["emergency"], ...handoff("high", "Cheiro de gás") }));
    expect(r.kind).toBe("reply");
    if (r.kind === "reply") expect(r.situation).toMatchObject({ emergency: true, humanAction: { needed: true, urgency: "high" } });
  });
  it("emergência RELACIONADA ao chamado ⇒ escalonamento permitido (urgência alta); sem urgência alta, recusado", async () => {
    const ok = await run(v3({ caseRelation: "related", intents: ["emergency"], ...handoff("high", "Vazamento piorou: água no quadro de luz") }));
    expect(ok.r.kind).toBe("reply");
    const low = await run(v3({ caseRelation: "related", intents: ["emergency"], ...handoff("normal") }));
    expect(low.r.kind).toBe("refused");
  });
  it("mudança relevante de prioridade (urgência alta acima da registrada) permite novo encaminhamento", async () => {
    const { r } = await run(v3({ caseRelation: "related", intents: ["problem_report"], ...handoff("high", "Hóspede sem água em todo o imóvel") }));
    expect(r.kind).toBe("reply");
    const already = await run(v3({ caseRelation: "related", intents: ["problem_report"], ...handoff("high") }), row({ handoff_urgency: "high" }));
    expect(already.r.audit.semanticBlocks).toContain("protected_topic_second_action");
  });
});

describe("B2.4 · controles da equipe e falhas (fail-closed)", () => {
  it("IA pausada EXPLICITAMENTE pela equipe ⇒ recusa (decisão humana), sem chamar o modelo", async () => {
    const { r, h } = await run(v3(), row({ ai_paused: true }));
    expect(r).toMatchObject({ kind: "refused", stage: "context", code: "ai_paused_by_team" });
    expect(h.calls.generate).toBe(0);
  });
  it("estado do atendimento incoerente com o contexto, desconhecido ou de outra conversa ⇒ recusa", async () => {
    expect((await run(v3(), row(), ctx())).r).toMatchObject({ code: "human_ownership_inconsistent" });
    expect((await run(v3(), row({ status: "???" }))).r).toMatchObject({ code: "human_ownership_inconsistent" });
    expect((await run(v3(), row({ id: "outra" }))).r).toMatchObject({ code: "human_ownership_inconsistent" });
  });
  it("falha ao ler o atendimento humano ⇒ erro técnico (nunca presume 'sem chamado')", async () => {
    const h = harness(v3(), { now: () => T0, loadContext: async () => openCtx(), loadConversationOwnership: async () => { throw new Error("db"); } });
    const r = await runTurnChain({ turn: turn({ conversationStatus: "needs_human" }), traceId: "h-2" }, h.deps);
    expect(r).toMatchObject({ kind: "technical_error", stage: "context" });
    expect(h.calls.generate).toBe(0);
  });
});
