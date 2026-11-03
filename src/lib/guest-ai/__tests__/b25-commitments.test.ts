/**
 * B2.5 · Bloqueios críticos herdados: (1) promessa no TEXTO sem correspondência estruturada e
 * (2) horário prometido × autorização R6. O texto é confrontado com a decisão; o horário com o R6.
 * Sem censura de estilo: humor, emoji, desculpas e informalidade continuam passando.
 */
import { describe, expect, it } from "vitest";
import { analyzeReplyCommitments, checkReplyAgainstDecision } from "@/lib/guest-ai/validation/commitment-text";
import { parseDecision } from "@/lib/guest-ai/orchestrator/decision";
import { runTurnChain, type ChainOutcome } from "@/lib/guest-ai/turn-chain";
import { CONV, ctx, harness, turn, v4 } from "./helpers/b23-chain";
import { R6, ownershipRow, stayCard, staySource } from "./helpers/b25-fixtures";

const T0 = Date.parse("2026-11-03T12:00:00Z");
const OFFICIAL = { officialCheckin: "15:00", officialCheckout: "11:00" };
const run = (decision: Record<string, unknown>, over: Parameters<typeof harness>[1] = {}) => {
  const h = harness(decision, { now: () => T0, loadStayAuthorizationSource: async () => staySource([stayCard(R6)]), ...over });
  return runTurnChain({ turn: turn(), traceId: "c-1" }, h.deps);
};
const blocks = (r: ChainOutcome) => [...r.audit.structuralBlocks, ...r.audit.semanticBlocks];
const LATE = (time = "13:00", over: Record<string, unknown> = {}) => ({ kind: "late_checkout", date: "2026-11-07", time, timezone: "America/Sao_Paulo", ...over });

describe("B2.5 · leitura do texto (traços combinados, não lista de frases)", () => {
  it.each<[string, string, string | null]>([
    ["promessa concluída de entrada antecipada com horário", "Pode deixar, já confirmei sua entrada antecipada para as 12h.", "early_checkin/completed"],
    ["permissão com horário antes do check-in oficial (sem a palavra 'antecipada')", "Você pode entrar às 12h, sem problema!", "early_checkin/promise"],
    ["permissão com horário depois do checkout oficial", "Vocês podem ficar até as 13h.", "late_checkout/promise"],
    ["acionamento de equipe prometido", "Vou avisar a equipe agora.", "team_relay/promise"],
    ["contato prometido mesmo com condição sobre o resultado", "Vou verificar com a equipe se é possível.", "team_relay/promise"],
    ["execução concluída genérica", "Já providenciei tudo.", "action_completed/completed"],
    ["alteração de reserva", "Vou alterar as datas da sua reserva.", "reservation_change/promise"],
    ["disponibilidade do imóvel", "O apartamento está disponível nas suas datas.", "availability/promise"],
    ["liberação de credenciais afirmada", "Já liberei as senhas para você.", "credential_release/completed"],
    ["resolução de incidente afirmada", "O chuveiro foi consertado.", "resolution/completed"],
    ["benefício concedido", "Consegui um desconto para você!", "service_or_benefit/completed"],
    ["inglês", "I'll let the team know right away.", "team_relay/promise"],
    ["espanhol", "Le garantizo la salida tardia a las 14h.", "late_checkout/promise"],
    ["informação de horário oficial (sem promessa)", "O check-in é a partir das 15h e o checkout até as 11h.", null],
    ["linguagem condicional", "Se quiser, posso pedir à equipe para avaliar uma saída tardia.", null],
    ["dependência declarada", "A saída tardia depende de autorização da equipe.", null],
    ["negação", "Infelizmente não consigo liberar a entrada antecipada.", null],
    ["oferta (não promessa)", "Posso verificar com a equipe, se quiser.", null],
    ["informação sobre onde ficam as senhas", "As senhas ficam disponíveis no guia 24h antes do check-in.", null],
    ["humor/emoji/desculpa sem compromisso", "Puxa, desculpa a confusão! 😅 O check-in é às 15h.", null],
  ])("%s", (_n, text, expected) => {
    const a = analyzeReplyCommitments(text, OFFICIAL);
    expect(a.claims.map((c) => `${c.kind}/${c.modality}`)[0] ?? null).toBe(expected);
  });
  it("idioma sem léxico suportado ⇒ não classificável (fail-closed)", () => {
    const d = parseDecision(v4({ reply: "Bonjour, nous allons préparer votre arrivée avec plaisir demain." })) as unknown as { ok: true; decision: never };
    expect(checkReplyAgainstDecision(d.decision, OFFICIAL, { credentialReleaseAllowed: false, lateCheckoutAuthorizedTime: null, humanOwnershipActive: false }).blocks).toEqual(["text_commitment_unclassifiable"]);
  });
  it("conclusão em 1ª pessoa NUNCA é evidência, mesmo com D9 permitida e chamado ativo (a IA não executa nada)", () => {
    const ev = { credentialReleaseAllowed: true, lateCheckoutAuthorizedTime: "13:00", humanOwnershipActive: true };
    for (const reply of ["Já liberei as senhas para você.", "Já avisei a equipe."]) {
      const d = parseDecision(v4({ reply })) as unknown as { ok: true; decision: never };
      expect(checkReplyAgainstDecision(d.decision, OFFICIAL, ev).blocks, reply).toContain("text_completion_without_evidence");
    }
  });
  it("permissão com horário sem horário oficial conhecido ⇒ não classificável", () => {
    const d = parseDecision(v4({ reply: "Você pode entrar às 12h." })) as unknown as { ok: true; decision: never };
    expect(checkReplyAgainstDecision(d.decision, { officialCheckin: null, officialCheckout: null }, { credentialReleaseAllowed: false, lateCheckoutAuthorizedTime: null, humanOwnershipActive: false }).blocks).toContain("text_commitment_unclassifiable");
  });
});

describe("B2.5 · promessas no texto × estrutura × autorização (cadeia completa)", () => {
  it("promessa sem commitmentKinds (o cenário que passava na B2.4) ⇒ recusa", async () => {
    const r = await run(v4({ reply: "Pode deixar, já confirmei sua entrada antecipada para as 12h." }));
    expect(r).toMatchObject({ kind: "refused", code: "semantic_block", delivery: "not_sent", effectsExecuted: false });
    expect(blocks(r)).toContain("text_completion_without_evidence");
    expect("text" in r).toBe(false);
  });
  it("promessa com tipo de compromisso INCORRETO (declara repasse, texto promete entrada antecipada) ⇒ recusa", async () => {
    const r = await run(v4({ reply: "Vou liberar sua entrada antecipada.", commitments: ["avisar equipe"], commitmentKinds: ["team_relay"], strategy: "answer_and_handoff", handoff: { needed: true, question: "q", urgency: "low" } }));
    expect(blocks(r)).toContain("text_commitment_undeclared");
    expect(r.audit.checks.text?.undeclaredKinds).toEqual(["early_checkin"]);
  });
  it("promessa declarada mas sem autorização (entrada antecipada, alteração de reserva, disponibilidade, benefício) ⇒ recusa", async () => {
    for (const [reply, kind] of [["Vou liberar sua entrada antecipada.", "early_checkin"], ["Vou alterar as datas da sua reserva.", "reservation_change"], ["O apartamento está disponível nas suas datas.", "availability"], ["Vou te dar um desconto.", "service_or_benefit"]] as const) {
      const r = await run(v4({ reply, commitments: ["x"], commitmentKinds: [kind] }));
      expect(r.kind, reply).toBe("refused");
      expect(r.audit.decision?.unauthorizedKinds, reply).toContain(kind);
    }
  });
  it("execução concluída sem evidência e liberação de credenciais afirmada com D9 negada ⇒ recusa", async () => {
    expect(blocks(await run(v4({ reply: "Já providenciei tudo para a sua chegada." })))).toContain("text_completion_without_evidence");
    expect(blocks(await run(v4({ reply: "Já liberei as senhas para você." })))).toContain("text_completion_without_evidence");
    expect(blocks(await run(v4({ reply: "As senhas já estão liberadas." })))).toContain("text_completion_without_evidence");
  });
  it("acionamento de equipe: prometido sem declarar ⇒ recusa; declarado com encaminhamento ⇒ aprovado; 'já avisei' (1ª pessoa) ⇒ recusa", async () => {
    expect(blocks(await run(v4({ reply: "Vou avisar a equipe agora." })))).toContain("text_commitment_undeclared");
    const ok = await run(v4({ reply: "Vou avisar a equipe agora.", commitments: ["avisar a equipe"], commitmentKinds: ["team_relay"], strategy: "answer_and_handoff", handoff: { needed: true, question: "Hóspede pede toalhas", urgency: "low" }, intents: ["operational_request"] }));
    expect(ok.kind).toBe("reply");
    expect(blocks(await run(v4({ reply: "Já avisei a equipe.", commitments: ["avisar"], commitmentKinds: ["team_relay"], strategy: "answer_and_handoff", handoff: { needed: true, question: "q", urgency: "low" } })))).toContain("text_completion_without_evidence");
  });
  it("afirmação retrospectiva COMPROVADA passa: 'a equipe já está cuidando' com chamado ativo; saída tardia aprovada igual ao R6", async () => {
    const withCase = await run(v4({ caseRelation: "related", reply: "A equipe já está cuidando do chuveiro.", groundedOn: ["case:c1"] }), {
      loadContext: async () => ctx({ openCases: [{ id: CONV, source: "conversation_status", topic: null, status: "needs_human" }] }, [{ caseId: CONV, status: "needs_human", handoffReason: null, handoffAt: null }]),
      loadConversationOwnership: async () => ownershipRow({ status: "needs_human", handoff_reason: "Chuveiro", handoff_at: "2026-11-03T10:00:00Z" }),
    });
    expect(withCase.kind).toBe("reply");
    const lateOk = await run(v4({ reply: "Sua saída tardia até as 13h está aprovada.", groundedOn: ["ctx:saida_tardia"] }));
    expect(lateOk.kind).toBe("reply");
  });
  it("afirmação retrospectiva SEM evidência ('a equipe já está cuidando' sem chamado; aprovação sem R6) ⇒ recusa", async () => {
    expect(blocks(await run(v4({ reply: "A equipe já está cuidando disso." })))).toContain("text_completion_without_evidence");
    expect(blocks(await run(v4({ reply: "Sua saída tardia até as 13h está aprovada." }), { loadStayAuthorizationSource: async () => staySource([]) }))).toContain("text_completion_without_evidence");
  });
  it("respostas informativas, condicionais e com estilo livre passam", async () => {
    for (const reply of ["O check-in é a partir das 15h e o checkout até as 11h.", "Se quiser, posso pedir à equipe para avaliar uma saída tardia.", "Kkk relaxa, dá tempo de sobra: entrada às 15h 🙂", "Lamento muito pelo transtorno — o horário de entrada é 15h."]) {
      expect((await run(v4({ reply }))).kind, reply).toBe("reply");
    }
  });
});

describe("B2.5 · horário prometido × R6 (determinístico, fail-closed)", () => {
  const late = (time = "13:00", ptOver: Record<string, unknown> = {}, reply = `Pode sair às ${time.replace(":00", "h")}.`) =>
    v4({ reply, commitments: ["saída tardia"], commitmentKinds: ["late_checkout"], groundedOn: ["ctx:saida_tardia"], promisedTimes: [LATE(time, ptOver)] });
  it("igual ao R6 (data, hora e fuso) ⇒ aprovado, com fonte da autorização registrada", async () => {
    const r = await run(late());
    expect(r.kind).toBe("reply");
    expect(r.audit.checks.promisedTimes).toEqual([{ kind: "late_checkout", result: "valid", authorizationSource: "guest_arrival_status.late_checkout" }]);
  });
  it.each<[string, Record<string, unknown>]>([
    ["posterior ao autorizado", late("14:00")],
    ["anterior ao autorizado (diverge; regra literal da diretriz)", late("12:00")],
    ["data diferente", late("13:00", { date: "2026-11-08" })],
    ["fuso diferente", late("13:00", { timezone: "America/Manaus" })],
  ])("%s ⇒ invalid_commitment_time", async (_n, d) => {
    const r = await run(d);
    expect(r.kind).toBe("refused");
    expect(blocks(r)).toContain("invalid_commitment_time");
    expect(r.audit.checks.promisedTimes[0]?.result).toBe("invalid_commitment_time");
  });
  it("horário ambíguo ou inválido no campo estruturado ⇒ parser recusa", async () => {
    for (const time of ["13h", "1pm", "25:00", "13:5"]) {
      expect(await run(late("13:00", { time })), time).toMatchObject({ kind: "refused", code: "parse_invalid_promised_times" });
    }
    expect(await run(late("13:00", { timezone: "-03:00" }))).toMatchObject({ code: "parse_invalid_promised_times" });
  });
  it("texto com horário diferente do campo ⇒ text_time_mismatch; promessa temporal sem promisedTimes ⇒ promised_time_missing", async () => {
    expect(blocks(await run(late("13:00", {}, "Pode sair às 14h.")))).toContain("text_time_mismatch");
    expect(blocks(await run(v4({ reply: "Pode sair às 13h.", commitments: ["s"], commitmentKinds: ["late_checkout"] })))).toContain("promised_time_missing");
    expect(blocks(await run(v4({ reply: "Vocês podem ficar até as 13h." })))).toContain("text_commitment_undeclared");
  });
  it("horário prometido com tipo não declarado ⇒ bloqueio estrutural", async () => {
    const r = await run(v4({ promisedTimes: [LATE()] }));
    expect(r.audit.structuralBlocks).toContain("promised_time_kind_undeclared");
  });
  it.each<[string, ReturnType<typeof stayCard>[]]>([
    ["R6 inexistente", []],
    ["R6 incompleto (sem autor)", [stayCard({ ...R6, late_checkout_by: null })]],
    ["R6 revogado (colunas limpas — revogação e ausência são indistinguíveis no schema atual)", [stayCard({ late_checkout_time: null, late_checkout_approved_at: null, late_checkout_by: null })]],
    ["R6 conflitante", [stayCard(R6), stayCard({ ...R6, late_checkout_time: "15:00" })]],
    ["aprovação futura", [stayCard({ ...R6, late_checkout_approved_at: "2026-11-05T00:00:00Z" })]],
    ["outra reserva", [stayCard({ ...R6, reservation_id: "r9" })]],
    ["outro imóvel", [stayCard({ ...R6, property_id: "p9" })]],
    ["checkout já confirmado", [stayCard({ ...R6, status: "done" })]],
    ["no-show", [stayCard({ kind: "checkin", status: "no_show" }), stayCard(R6)]],
  ])("%s ⇒ horário recusado (igualdade de horário não prova autorização)", async (_n, cards) => {
    const r = await run(late(), { loadStayAuthorizationSource: async () => staySource(cards) });
    expect(r.kind).toBe("refused");
    expect(blocks(r)).toContain("invalid_commitment_time");
  });
  it("entrada antecipada com data e hora IGUAIS às do R6 de saída tardia continua inválida (cada tipo tem sua própria fonte)", async () => {
    const r = await run(v4({ reply: "Pode entrar às 13h.", commitments: ["e"], commitmentKinds: ["early_checkin"], promisedTimes: [{ kind: "early_checkin", date: "2026-11-07", time: "13:00", timezone: "America/Sao_Paulo" }] }));
    expect(blocks(r)).toContain("invalid_commitment_time");
    expect(r.audit.checks.promisedTimes[0]).toMatchObject({ kind: "early_checkin", result: "invalid_commitment_time" });
  });
  it("reserva irmã comprovada da mesma estadia ⇒ R6 válido", async () => {
    const src = { ...staySource([stayCard({ ...R6, reservation_id: "r1b" })]), stayReservationIds: ["r1b"] };
    expect((await run(late(), { loadStayAuthorizationSource: async () => src })).kind).toBe("reply");
  });
  it("entrada antecipada nunca: nem com D13 válida, nem com horário 'igual' a algo", async () => {
    const d13 = staySource([stayCard({ kind: "checkin", credentials_released_at: "2026-11-02T10:00:00Z", credentials_released_by: "u" })]);
    const r = await run(v4({ reply: "Pode entrar às 12h.", commitments: ["entrada"], commitmentKinds: ["early_checkin"], promisedTimes: [{ kind: "early_checkin", date: "2026-11-04", time: "12:00", timezone: "America/Sao_Paulo" }] }), { loadStayAuthorizationSource: async () => d13 });
    expect(r.kind).toBe("refused");
    expect(blocks(r)).toEqual(expect.arrayContaining(["unauthorized_commitment", "invalid_commitment_time"]));
    expect(r.audit.checks.stayAuthorizations).toEqual({ earlyCheckin: "no_authorization_source", lateCheckout: "absent" });
  });
});
