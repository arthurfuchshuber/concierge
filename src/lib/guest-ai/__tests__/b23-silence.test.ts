/**
 * B2.3 · Regras de silêncio e marcos da estadia, exercitadas pela cadeia fail-closed completa.
 * A CLASSIFICAÇÃO é do modelo (saídas sintéticas abaixo); o sistema só garante coerência e
 * autorização. `shouldReply: false` nunca produz texto, cortesia, fallback nem reenvio.
 */
import { describe, expect, it } from "vitest";
import { runTurnChain, type ChainOutcome } from "@/lib/guest-ai/turn-chain";
import { ctx, currentRef, harness, history, silence, turn, v6 } from "./helpers/b23-chain";

const run = (output: unknown, over: Parameters<typeof harness>[1] = {}) => {
  const h = harness(output, over);
  return runTurnChain({ turn: turn(), traceId: "silence-1" }, h.deps).then((r) => ({ r, h }));
};
const textKeys = (o: ChainOutcome) => Object.keys(o).filter((k) => k === "text" || k === "reply" || k === "message");

describe("B2.3 · silêncio legítimo (sem pergunta, pedido, problema ou ação)", () => {
  it.each([
    ["agradecimento simples", "Obrigado!"],
    ["confirmação simples", "Combinado, perfeito."],
    ["informação sem pergunta", "Chegaremos por volta das 20h."],
  ])("%s ⇒ silence, sem texto e sem segunda geração", async (_n, msg) => {
    const { r, h } = await run(silence(), { loadHistory: async () => history(msg) });
    expect(r.kind).toBe("silence");
    expect(textKeys(r)).toEqual([]);
    expect(r).toMatchObject({ delivery: "not_sent", effectsExecuted: false });
    expect(h.calls.generate).toBe(1);
    // o silêncio preserva a classificação permitida (contexto), não ignora a mensagem
    if (r.kind === "silence") expect(r.situation.intents).toEqual(["acknowledgment"]);
    expect(h.calls.logs[0]).toMatchObject({ outcome: "silence", category: "silence", code: null });
  });
});

describe("B2.3 · silêncio NÃO permitido quando há necessidade", () => {
  it.each([
    ["pergunta acompanhada de agradecimento", ["acknowledgment", "informational_query"]],
    ["incidente acompanhado de cortesia", ["acknowledgment", "problem_report"]],
    ["solicitação implícita", ["operational_request"]],
    ["emergência", ["emergency"]],
    ["alteração contratual", ["formal_change_request"]],
  ])("%s: um silêncio é recusado (nunca vira resposta automática)", async (_n, intents) => {
    const extra = intents.includes("formal_change_request") ? { formalChangeRequests: ["dates"] } : {};
    const { r, h } = await run(silence({ intents, ...extra }));
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") {
      expect(r.stage).toBe("structural_validation");
      expect(r.audit.structuralBlocks).toContain("silence_not_allowed");
    }
    expect(textKeys(r)).toEqual([]);
    expect(h.calls.generate).toBe(1);
  });
  it("pergunta com agradecimento: a resposta à pergunta é aprovada", async () => {
    const { r } = await run(v6({ intents: ["acknowledgment", "informational_query"] }), { loadHistory: async () => history("Valeu! E o check-in é que horas?") });
    expect(r.kind).toBe("reply");
  });
  it("incidente com cortesia: tratado (resposta + encaminhamento), nunca silenciado", async () => {
    const { r } = await run(
      v6({ strategy: "answer_and_handoff", intents: ["acknowledgment", "problem_report"], reply: "Sinto muito! Já acionei a equipe para verificar o chuveiro.", handoff: { needed: true, question: "Chuveiro sem água quente", urgency: "normal" } }),
    );
    // B2.5: o texto é confrontado com a estrutura — "já acionei" (execução afirmada sem evidência) é
    // RECUSADO (antes era a limitação registrada na B2.3). Declarado como promessa, o repasse passa:
    expect(r.kind).toBe("refused");
    expect(r.audit.semanticBlocks).toContain("text_completion_without_evidence");
    const declared = await run(
      v6({ strategy: "answer_and_handoff", intents: ["problem_report"], reply: "Vou repassar à equipe agora.", commitments: ["repassar à equipe"], commitmentKinds: ["team_relay"], handoff: { needed: true, question: "Chuveiro sem água quente", urgency: "normal" } }),
    );
    expect(declared.r.kind).toBe("reply");
  });
  it("emergência: resposta com encaminhamento URGENTE; sem urgência alta é recusada", async () => {
    const ok = await run(v6({ strategy: "answer_and_handoff", intents: ["emergency"], reply: "Saiam do imóvel e liguem 193.", handoff: { needed: true, question: "Cheiro de gás relatado", urgency: "high" } }));
    expect(ok.r.kind).toBe("reply");
    if (ok.r.kind === "reply") expect(ok.r.situation).toMatchObject({ emergency: true, humanAction: { needed: true, urgency: "high" } });
    const low = await run(v6({ strategy: "answer_and_handoff", intents: ["emergency"], reply: "Vou avisar a equipe.", handoff: { needed: true, question: "Cheiro de gás relatado", urgency: "low" } }));
    expect(low.r.kind).toBe("refused");
    if (low.r.kind === "refused") expect(low.r.audit.semanticBlocks).toContain("emergency_without_escalation");
  });
});

describe("B2.3 · integridade de shouldReply:false", () => {
  it("silêncio com texto, com estratégia diferente ou com compromisso ⇒ recusa sem texto", async () => {
    for (const bad of [silence({ reply: "De nada!" }), silence({ strategy: "answer" }), silence({ commitments: ["x"], commitmentKinds: ["team_relay"] })]) {
      const { r, h } = await run(bad);
      expect(r.kind).toBe("refused");
      expect(textKeys(r)).toEqual([]);
      expect(h.calls.generate).toBe(1);
    }
  });
  it("falha em outro módulo nunca converte silêncio em resposta (validador quebrado ⇒ erro técnico, sem texto)", async () => {
    const { r } = await run(silence(), { validators: { semantic: () => { throw new Error("quebrou"); } } });
    expect(r.kind).toBe("technical_error");
    expect(textKeys(r)).toEqual([]);
  });
});

describe("B2.3 · marcos da estadia (evidência confiável, sem repetição)", () => {
  const arrival = v6({ intents: ["arrival_confirmation"], reply: "Que bom que chegaram! Encontraram tudo certinho?", groundedOn: [currentRef()], hospitalityMilestone: { kind: "checkin_confirmed", evidence: [currentRef()] } });
  const departure = v6({ intents: ["departure_confirmation"], reply: "Obrigado pela estadia e boa viagem!", groundedOn: [currentRef()], hospitalityMilestone: { kind: "checkout_confirmed", evidence: [currentRef()] } });
  const inStay = () => ctx({ phase: "in_stay", stay: { ...ctx().guest.stay!, phase: "in_stay" } });

  it("confirmação confiável de entrada (mensagem atual do hóspede) ⇒ boas-vindas aprovadas", async () => {
    const { r } = await run(arrival, { loadHistory: async () => history("Entramos, está tudo lindo!") });
    expect(r.kind).toBe("reply");
  });
  it("confirmação confiável de saída ⇒ despedida aprovada (fase de estadia)", async () => {
    const { r } = await run(departure, { loadContext: async () => inStay(), loadHistory: async () => history("Saímos e deixamos a chave no cofre.") });
    expect(r.kind).toBe("reply");
  });
  it("marco sem evidência da mensagem atual (só horário/credencial/histórico) ⇒ recusado", async () => {
    const noEvidence = v6({ intents: ["arrival_confirmation"], hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["ctx:checkin_oficial"] } });
    const { r } = await run(noEvidence);
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.audit.structuralBlocks).toContain("milestone_without_current_guest_evidence");
  });
  it("tentativa de repetir o ritual já reconhecido ⇒ recusada", async () => {
    const { r } = await run(arrival, { priorMilestones: { status: "known", acknowledged: ["checkin_confirmed"] } });
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.audit.semanticBlocks).toContain("milestone_repeated");
  });
  it("despedida antes da estadia (contradição com a fase do servidor) ⇒ recusada", async () => {
    const { r } = await run(departure);
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.audit.semanticBlocks).toContain("milestone_phase_incompatible");
  });
});
