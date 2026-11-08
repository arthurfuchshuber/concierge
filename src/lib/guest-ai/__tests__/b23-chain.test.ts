/**
 * B2.3 · Encadeamento fail-closed: cada etapa crítica recusa por política ou falha tecnicamente,
 * NUNCA aprova por omissão. Política definitiva do FreeTextGuard (§6.1) e falhas de contexto,
 * decisão e saída. Gerador do modelo é sempre falso (nada chama o Gateway).
 */
import { describe, expect, it } from "vitest";
import { CHAIN_STAGES, CHAIN_STAGE_IDS, checkContextIntegrity, checkDossierScope, checkHistoryScope, runTurnChain, type ChainOutcome } from "@/lib/guest-ai/turn-chain";
import { GUARD_POLICY, type FreeTextGuard } from "@/lib/guest-ai/composer";
import { SECRET_MARKER, SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { CONV, MSG, TURN_FIELDS, ctx, harness, history, turn, v6 } from "./helpers/b23-chain";
import { OTHER_CONV } from "./helpers/b21-fixtures";
import { v2 } from "./helpers/b21-fixtures";
import { normalizeHistory } from "@/lib/guest-ai/history";
import { row } from "./helpers/b21-fixtures";

const run = (output: unknown, over: Parameters<typeof harness>[1] = {}, t = turn(), traceId = "chain-1") => {
  const h = harness(output, over);
  return runTurnChain({ turn: t, traceId }, h.deps).then((r) => ({ r, h }));
};
const refusedAt = (r: ChainOutcome, stage: string, code: string) => {
  expect(r.kind).toBe("refused");
  if (r.kind === "refused") expect({ stage: r.stage, code: r.code }).toEqual({ stage, code });
  expect("text" in r).toBe(false);
  expect(r).toMatchObject({ delivery: "not_sent", effectsExecuted: false });
};

describe("B2.3 · cadeia declarada", () => {
  it("11 etapas críticas, em ordem, cada uma com pré-condições, resultado e recusas", () => {
    expect(CHAIN_STAGES.map((s) => s.id)).toEqual([...CHAIN_STAGE_IDS]);
    expect(CHAIN_STAGES.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    for (const s of CHAIN_STAGES) {
      expect(s.critical).toBe(true);
      expect(s.preconditions.length).toBeGreaterThan(0);
      expect(s.result.length).toBeGreaterThan(0);
      expect(s.refusals.length).toBeGreaterThan(0);
    }
  });
  it("caminho feliz: reply aprovado, não enviado, auditoria com versões e etapas", async () => {
    const { r, h } = await run(v6());
    expect(r.kind).toBe("reply");
    // B2.5: contrato da decisão avançou para v4 (v3 + promisedTimes)
    expect(r.audit).toMatchObject({ outcome: "reply", contractVersion: 6, decisionVersion: 6, stage: "final_decision", code: null, guard: { id: "secret-scrub" } });
    expect(r.audit.stagesCompleted).toEqual([...CHAIN_STAGE_IDS]);
    expect(h.calls.generate).toBe(1);
  });
});

describe("B2.3 · política do FreeTextGuard (§6.1)", () => {
  it("tabela de política: só safe e sanitized seguem", () => {
    expect(GUARD_POLICY).toMatchObject({ safe: "proceed", sanitized: "proceed_with_sanitized_text_after_rescan", ambiguous: "refuse", blocked: "refuse", missing: "refuse", exception: "refuse", invalid_result: "refuse", canary_failed: "refuse", rescan_failed: "refuse" });
  });
  it("safe ⇒ segue", async () => {
    expect((await run(v6())).r.kind).toBe("reply");
  });
  it("sanitized ⇒ segue SÓ com o texto saneado (o modelo nunca recebe o original)", async () => {
    const { r, h } = await run(v6(), { loadHistory: async () => history("Qual o horário?", [{ content: "A senha da porta é 4821." }]) });
    expect(r.kind).toBe("reply");
    const sent = JSON.stringify(h.calls.prompts);
    expect(sent).not.toContain("4821");
    expect(sent).toContain(SECRET_MARKER);
  });
  it("ambiguous ⇒ recusa da composição; o modelo não é chamado", async () => {
    const { r, h } = await run(v6(), { loadHistory: async () => history("ok", [{ content: "A senha do cofre é" }, { content: "7351" }]) });
    refusedAt(r, "guard", "guard_ambiguous");
    expect(h.calls.generate).toBe(0);
    expect(JSON.stringify(r)).not.toContain("7351");
  });
  it("blocked ⇒ recusa da composição (sem tag de contenção no lugar)", async () => {
    const key = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEAsynthetic\n-----END RSA PRIVATE KEY-----";
    expect(SECRET_SCRUBBER.scan(key).status).toBe("blocked");
    const { r, h } = await run(v6(), { loadHistory: async () => history("segue a chave", [{ content: key }]) });
    refusedAt(r, "guard", "guard_blocked");
    expect(h.calls.generate).toBe(0);
  });
  it.each<[string, FreeTextGuard | null, string]>([
    ["guard ausente", null, "guard_missing"],
    ["guard que lança", { id: "x", version: "1", scan: () => { throw new Error("boom"); } }, "guard_failed"],
    ["retorno inválido", { id: "x", version: "1", scan: () => ({ status: "ok" }) as never }, "guard_failed"],
    ["canário reprovado (guard identidade)", { id: "x", version: "1", scan: (t) => ({ status: "safe", text: t, findings: [] }) }, "guard_failed"],
    [
      "re-varredura reprovada",
      { id: "x", version: "1", scan: (t) => { const r = SECRET_SCRUBBER.scan(t); return t.includes(SECRET_MARKER) ? { ...r, status: "sanitized" } : r; } },
      "guard_failed",
    ],
    ["sanitized sem alterar o texto", { id: "x", version: "1", scan: (t) => (t.includes("CANARIO") ? SECRET_SCRUBBER.scan(t) : { status: "sanitized", text: t, findings: [{ category: "x", detector: "x" }] }) }, "guard_failed"],
  ])("%s ⇒ recusa (%s)", async (_n, guard, code) => {
    // histórico com um segredo: exercita a re-varredura do texto saneado
    const { r, h } = await run(v6(), { guard, loadHistory: async () => history("Qual o horário?", [{ content: "A senha da porta é 4821." }]) });
    refusedAt(r, "guard", code);
    expect(h.calls.generate).toBe(0);
  });
});

describe("B2.3 · falhas de turno e contexto", () => {
  it("turno não emitido pelo escopo (forjado ou copiado) ⇒ turn_not_validated; nada é lido", async () => {
    let loads = 0;
    const { r, h } = await run(v6(), { loadContext: async () => { loads++; return ctx(); } }, { ...TURN_FIELDS } as never);
    refusedAt(r, "turn", "turn_not_validated");
    expect(loads).toBe(0);
    expect(h.calls.generate).toBe(0);
  });
  it("traceId inválido ⇒ trace_invalid", async () => {
    refusedAt((await run(v6(), {}, turn(), "com espaço")).r, "turn", "trace_invalid");
  });
  it.each<[string, () => unknown, string]>([
    ["tenant desconhecido", () => ctx({ property: { ...ctx().guest.property, tenantId: "" } }), "tenant_unknown"],
    ["tenant divergente", () => ctx({ property: { ...ctx().guest.property, tenantId: "t2" } }), "property_tenant_mismatch"],
    ["imóvel divergente", () => ctx({ property: { ...ctx().guest.property, id: "p9" } }), "property_identity_mismatch"],
    ["outra conversa", () => ctx({ interlocutor: { ...ctx().guest.interlocutor, conversationId: OTHER_CONV } }), "conversation_identity_mismatch"],
    ["reserva incompatível com a conversa", () => ctx({ stay: { ...ctx().guest.stay!, reservationId: "r9" } }), "reservation_conversation_mismatch"],
    ["contexto com credenciais", () => ctx({ credentials: { wifiPassword: "sintetico" } as never }), "credentials_present"],
    ["audiência interna", () => ctx({ audiences: ["P", "G", "I"] as never }), "internal_audience"],
    ["contexto incompleto (sem política)", () => ({ ...ctx(), credentialPolicy: undefined }), "context_incomplete"],
    ["contexto incompleto (sem imóvel)", () => ({ ...ctx(), guest: { ...ctx().guest, property: undefined } }), "context_incomplete"],
    ["fonte crítica inválida (fase fora do enum)", () => ctx({ phase: "staying" as never }), "context_incomplete"],
    ["dados divergentes (fase da estadia ≠ fase)", () => ctx({ stay: { ...ctx().guest.stay!, phase: "in_stay" } }), "context_inconsistent"],
    ["política de credenciais incoerente com a fase", () => ({ ...ctx({ phase: "inquiry", stay: null }), credentialPolicy: { decision: "allow", reason: "manual_release" } }), "credential_policy_inconsistent"],
  ])("%s ⇒ %s; o modelo não é chamado", async (_n, make, code) => {
    const { r, h } = await run(v6(), { loadContext: async () => make() as never });
    refusedAt(r, "context", code);
    expect(h.calls.generate).toBe(0);
  });
  it("checkContextIntegrity é pura e aceita o contexto íntegro", () => {
    expect(checkContextIntegrity(turn(), ctx())).toBeNull();
    expect(checkContextIntegrity(turn(), null)).toBe("context_incomplete");
    // conversa sem reserva comprovada (stay null) é legítima
    expect(checkContextIntegrity(turn(), ctx({ phase: "inquiry", stay: null, audiences: ["P"] }))).toBeNull();
  });
  it("falha de leitura ⇒ erro técnico (stage_failed); timeout ⇒ stage_timeout com sinal abortado", async () => {
    const failed = await run(v6(), { loadContext: async () => { throw new Error("db"); } });
    expect(failed.r).toMatchObject({ kind: "technical_error", stage: "context", code: "stage_failed", delivery: "not_sent" });
    let aborted = false;
    const slow = await run(v6(), {
      stageTimeoutMs: 20,
      loadHistory: (_t, s) => new Promise(() => { s.addEventListener("abort", () => { aborted = true; }); }),
    });
    expect(slow.r).toMatchObject({ kind: "technical_error", stage: "history", code: "stage_timeout" });
    expect(aborted).toBe(true);
    expect(slow.h.calls.generate).toBe(0);
  });
  it("teto TOTAL do turno (15 s): etapa que começa sem prazo restante nem é chamada", async () => {
    let t = 0;
    let historyCalls = 0;
    const { r, h } = await run(v6(), {
      now: () => t,
      loadContext: async () => { t += 15_001; return ctx(); },
      loadHistory: async () => { historyCalls++; return history(); },
    });
    expect(r).toMatchObject({ kind: "technical_error", stage: "history", code: "stage_timeout" });
    expect(historyCalls).toBe(0);
    expect(h.calls.generate).toBe(0);
  });
  it("prazo da etapa limitado ao restante do turno", async () => {
    let t = 0;
    const scheduled: number[] = [];
    await run(v6(), {
      now: () => t,
      schedule: (fn, ms) => { scheduled.push(ms); const x = setTimeout(fn, 1_000_000); return () => clearTimeout(x); },
      loadContext: async () => { t += 12_000; return ctx(); },
    });
    expect(scheduled[0]).toBe(5_000);
    expect(scheduled.slice(1).every((ms) => ms <= 3_000)).toBe(true);
  });
  it("histórico indisponível ou de outra conversa ⇒ recusa", async () => {
    refusedAt((await run(v6(), { loadHistory: async () => ({ status: "unavailable", reason: "over_limit" }) as never })).r, "history", "history_unavailable");
    const other = normalizeHistory([row({ id: MSG, conversation_id: OTHER_CONV })], { conversationId: OTHER_CONV, currentMessageId: MSG });
    refusedAt((await run(v6(), { loadHistory: async () => other })).r, "history", "history_scope_mismatch");
    void CONV;
  });
});

describe("B2.3 · dossiês fora do escopo", () => {
  const forged = (over: Record<string, unknown>) => ({ primary: { propertyId: "p1", tenantId: "t1", role: "primary", audiences: ["P", "G"], availability: { status: "not_consulted" }, ...over } }) as never;
  it("audiência interna ⇒ dossier_internal_audience", async () => {
    refusedAt((await run(v6(), { loadDossiers: async () => forged({ audiences: ["P", "I"] }) })).r, "dossier", "dossier_internal_audience");
  });
  it("tenant divergente ⇒ dossier_out_of_scope", async () => {
    refusedAt((await run(v6(), { loadDossiers: async () => forged({ tenantId: "t2" }) })).r, "dossier", "dossier_out_of_scope");
  });
  it("dossiê não emitido pelo loader (mesmo com escopo certo) ⇒ recusado na composição", async () => {
    refusedAt((await run(v6(), { loadDossiers: async () => forged({}) })).r, "dossier", "dossier_out_of_scope");
  });
});

describe("B2.3 · falhas de saída, parser e validadores", () => {
  it("gerador que lança ⇒ erro técnico model_call_failed", async () => {
    const { r } = await run(v6(), { generate: async () => { throw new Error("x"); } });
    expect(r).toMatchObject({ kind: "technical_error", stage: "model_output", code: "model_call_failed" });
  });
  it.each<[string, unknown, string]>([
    ["JSON malformado", "não é json", "parse_malformed_json"],
    ["JSON truncado", '{"strategy":"answer","reply":"O ch', "parse_truncated_json"],
    ["saída vazia", "", "parse_empty_output"],
    ["contrato antigo (v2)", JSON.stringify(v2({ groundedOn: ["ctx:fase"] })), "parse_version_mismatch"],
    ["tentativa de alterar o imóvel", JSON.stringify({ ...v6(), propertyId: "p2" }), "parse_scope_field_forbidden"],
    ["campo extra", JSON.stringify({ ...v6(), approved: true }), "parse_unexpected_field"],
  ])("%s ⇒ %s", async (_n, out, code) => {
    refusedAt((await run(out)).r, "parse", code);
  });
  it("validador estrutural que devolve lixo ⇒ recusa; que lança ⇒ erro técnico", async () => {
    refusedAt((await run(v6(), { validators: { structural: () => ({ verdict: "pass", blocks: ["x"] }) as never } })).r, "structural_validation", "structural_validator_invalid");
    refusedAt((await run(v6(), { validators: { structural: () => null as never } })).r, "structural_validation", "structural_validator_invalid");
    expect((await run(v6(), { validators: { structural: () => { throw new Error("x"); } } })).r).toMatchObject({ kind: "technical_error", stage: "structural_validation", code: "validator_exception" });
  });
  it("validador semântico que devolve lixo ⇒ recusa", async () => {
    refusedAt((await run(v6(), { validators: { semantic: () => ({ verdict: "pass", blocks: [] }) as never } })).r, "semantic_validation", "semantic_validator_invalid");
  });
  it("compromisso não autorizado (entrada antecipada) ⇒ semantic_block com o tipo na auditoria", async () => {
    const { r } = await run(v6({ reply: "Pode chegar às 10h, sem problema!", commitments: ["entrada às 10h"], commitmentKinds: ["early_checkin"] }));
    refusedAt(r, "semantic_validation", "semantic_block");
    // B2.5: além do tipo não autorizado, o texto ("pode chegar às 10h") e a falta de promisedTimes também recusam
    expect(r.audit.semanticBlocks).toContain("unauthorized_commitment");
    expect(r.audit.decision?.unauthorizedKinds).toEqual(["early_checkin"]);
  });
  it("credencial inventada ⇒ bloqueio estrutural (antes da camada semântica)", async () => {
    const { r } = await run(v6({ reply: "A senha do portão é 2468." }));
    refusedAt(r, "structural_validation", "structural_block");
    expect(r.audit.structuralBlocks).toContain("possible_fabricated_credential");
  });
  it("fundamento fora do contexto composto ⇒ bloqueio estrutural", async () => {
    refusedAt((await run(v6({ groundedOn: ["dos:alt1:qualquer"] }))).r, "structural_validation", "structural_block");
  });
});

describe("B2.3 · separação: recusa ≠ erro técnico ≠ ação humana ≠ chamado existente", () => {
  it("só encaminhamento ⇒ human_action (sem texto ao hóspede)", async () => {
    const { r } = await run(v6({ strategy: "handoff", reply: "", groundedOn: [], handoff: { needed: true, question: "Hóspede pede falar com alguém", urgency: "normal" } }));
    expect(r.kind).toBe("human_action");
    expect("text" in r).toBe(false);
  });
  it("chamado aberto não bloqueia a conversa: assunto independente é atendido; assunto da equipe sem compromisso", async () => {
    const cases = [{ caseId: "c1", status: "needs_human", handoffReason: null, handoffAt: null }];
    const withCase = () => ctx({ openCases: [{ caseId: "c1", source: "conversation_status", topic: null, status: "needs_human" } as never] }, cases);
    const indep = await run(v6({ caseRelation: "independent" }), { loadContext: async () => withCase() });
    expect(indep.r.kind).toBe("reply");
    if (indep.r.kind === "reply") expect(indep.r.situation.existingCase).toBe("independent");
    const related = await run(v6({ caseRelation: "related", strategy: "answer_and_handoff", handoff: { needed: true, question: "q", urgency: "low" }, commitments: ["repassar"], commitmentKinds: ["team_relay"] }), { loadContext: async () => withCase() });
    refusedAt(related.r, "structural_validation", "structural_block");
    expect(related.r.audit.structuralBlocks).toContain("human_owned_topic_commitment");
  });
  it("recusa e erro técnico nunca carregam decisão nem texto (não autorizam outra ação)", async () => {
    const outs = [(await run("lixo")).r, (await run(v6(), { generate: async () => { throw new Error(); } })).r];
    for (const o of outs) {
      expect(["refused", "technical_error"]).toContain(o.kind);
      expect("decision" in o).toBe(false);
      expect("text" in o).toBe(false);
      expect(o.effectsExecuted).toBe(false);
    }
  });
});

describe("B2.3 · defesa em profundidade: verificações próprias da cadeia (independentes do composer)", () => {
  // O composer também recusa estes casos; aqui se prova que a CADEIA não depende dele.
  it("checkContextIntegrity: cada recusa isoladamente", () => {
    const t = turn();
    expect(checkContextIntegrity(t, ctx({ credentials: { lockCode: "x" } as never }))).toBe("credentials_present");
    expect(checkContextIntegrity(t, ctx({ access: { ...ctx().guest.access, credentialsAllowed: true } }))).toBe("credentials_present");
    expect(checkContextIntegrity(t, ctx({ interlocutor: { ...ctx().guest.interlocutor, surface: "airbnb" } }))).toBe("conversation_identity_mismatch");
    expect(checkContextIntegrity(t, ctx({ interlocutor: { ...ctx().guest.interlocutor, messageId: "00000000-0000-4000-8000-000000000123" } }))).toBe("conversation_identity_mismatch");
  });
  it("checkDossierScope: tenant, imóvel, papel e audiência", () => {
    const t = turn();
    const p = (over: Record<string, unknown> = {}) => ({ propertyId: "p1", tenantId: "t1", role: "primary", audiences: ["P", "G"], ...over }) as never;
    expect(checkDossierScope(t, null)).toBeNull();
    expect(checkDossierScope(t, { primary: p() })).toBeNull();
    expect(checkDossierScope(t, { primary: p({ tenantId: "t2" }) })).toBe("dossier_out_of_scope");
    expect(checkDossierScope(t, { primary: p(), candidates: [p({ propertyId: "p2", role: "candidate", tenantId: "t2", audiences: ["P"] })] })).toBe("dossier_out_of_scope");
    expect(checkDossierScope(t, { primary: p({ propertyId: "p2" }) })).toBe("dossier_out_of_scope");
    expect(checkDossierScope(t, { primary: p({ role: "candidate" }) })).toBe("dossier_out_of_scope");
    expect(checkDossierScope(t, { primary: p({ audiences: ["P", "I"] }) })).toBe("dossier_internal_audience");
  });
  it("checkHistoryScope: outra conversa ou outra mensagem atual", () => {
    const t = turn();
    expect(checkHistoryScope(t, history())).toBeNull();
    expect(checkHistoryScope(t, { ...history(), conversationId: OTHER_CONV } as never)).toBe("history_scope_mismatch");
    expect(checkHistoryScope(t, { ...history(), currentMessageId: "00000000-0000-4000-8000-000000000123" } as never)).toBe("history_scope_mismatch");
    expect(checkHistoryScope(t, null)).toBe("history_unavailable");
  });
  it("guard incoerente: 'sanitized' sem alterar ou 'safe' alterando o texto ⇒ guard_failed", async () => {
    const viaHint = (first: (t: string) => { status: "safe" | "sanitized"; text: string }): FreeTextGuard => ({
      id: "x",
      version: "1",
      // canário passa pelo scrubber real; 1ª varredura (com hint) incoerente; re-varredura (sem hint) "safe"
      scan: (t, hint) => (t.includes("CANARIO") ? SECRET_SCRUBBER.scan(t) : hint === undefined ? { status: "safe", text: t, findings: [] } : { ...first(t), findings: [] }),
    });
    const lazy = await run(v6(), { guard: viaHint((t) => ({ status: "sanitized", text: t })) });
    refusedAt(lazy.r, "guard", "guard_failed");
    const silentEdit = await run(v6(), { guard: viaHint((t) => ({ status: "safe", text: `${t} ` })) });
    refusedAt(silentEdit.r, "guard", "guard_failed");
  });
});
