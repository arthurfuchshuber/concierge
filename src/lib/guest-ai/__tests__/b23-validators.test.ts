/**
 * B2.3 · Validador estrutural (fortalecido) e Validador Semântico (camada independente).
 * Uma decisão estruturalmente válida pode ser semanticamente NÃO autorizada.
 * Sem censura lexical: humor, emoji, desculpas e informalidade passam intactos.
 */
import { describe, expect, it } from "vitest";
import { parseDecision } from "@/lib/guest-ai/orchestrator/decision";
import { COMMITMENT_KINDS, type CommitmentKind, type ModelDecision } from "@/lib/guest-ai/orchestrator/contracts";
import { resolveCaseOwnership } from "@/lib/guest-ai/orchestrator/case-ownership";
import { validateDecision } from "@/lib/guest-ai/validation/output-validator";
import {
  COMMITMENT_AUTHORIZATION,
  SEMANTIC_BLOCKS,
  deriveTurnAuthorizations,
  validateSemantics,
  type SemanticDossierView,
  type SemanticInput,
} from "@/lib/guest-ai/validation/semantic-validator";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import { ctx, v3 } from "./helpers/b23-chain";

function dec(over: Record<string, unknown> = {}): ModelDecision {
  const r = parseDecision(v3(over), { expectVersion: 3 });
  if (!r.ok) throw new Error(r.error.code);
  return r.decision;
}
function sem(d: ModelDecision, over: Partial<SemanticInput> = {}) {
  const context = over.context ?? ctx();
  return validateSemantics({
    decision: d,
    context,
    ownership: resolveCaseOwnership(context.guest.openCases, d.caseRelation),
    dossiers: null,
    priorMilestones: { status: "unknown" },
    guard: SECRET_SCRUBBER,
    ...over,
  });
}
function structural(d: ModelDecision, sourceIds: string[] = ["ctx:checkin_oficial", "ctx:fase", "hist:guest:h1"], policy: "allow" | "deny" = "deny") {
  return validateDecision({ decision: d, credentialPolicy: policy, ownership: resolveCaseOwnership([], d.caseRelation), sourceIds: new Set(sourceIds) });
}
const withCommitment = (kind: CommitmentKind, over: Record<string, unknown> = {}) => dec({ commitments: ["compromisso declarado"], commitmentKinds: [kind], ...over });

describe("B2.3 · validador estrutural — campos incompatíveis e coerência v3", () => {
  it("decisão válida e autorizada passa nas duas camadas", () => {
    const d = dec();
    expect(structural(d)).toEqual({ verdict: "pass", blocks: [] });
    expect(sem(d)).toEqual({ verdict: "pass", blocks: [], unauthorizedKinds: [], milestoneIdempotency: "not_applicable" });
  });
  it("pergunta ou urgência à equipe sem encaminhamento ⇒ handoff_fields_without_need", () => {
    expect(structural(dec({ handoff: { needed: false, question: "Pode verificar?", urgency: null } })).blocks).toContain("handoff_fields_without_need");
    expect(structural(dec({ handoff: { needed: false, question: null, urgency: "high" } })).blocks).toContain("handoff_fields_without_need");
  });
  it("tipos de compromisso incoerentes com a lista ⇒ commitment_kinds_inconsistent", () => {
    expect(structural(dec({ commitments: ["algo"], commitmentKinds: [] })).blocks).toContain("commitment_kinds_inconsistent");
    expect(structural(dec({ commitments: [], commitmentKinds: ["team_relay"] })).blocks).toContain("commitment_kinds_inconsistent");
    expect(structural(dec({ commitments: ["a"], commitmentKinds: ["team_relay", "resolution"] })).blocks).toContain("commitment_kinds_inconsistent");
    expect(structural(dec({ commitments: ["a", "b"], commitmentKinds: ["team_relay"], handoff: { needed: true, question: "q", urgency: "low" }, strategy: "answer_and_handoff" })).blocks).not.toContain("commitment_kinds_inconsistent");
  });
  it("credencial inventada no texto ⇒ bloqueio estrutural E semântico (saída sensível)", () => {
    const d = dec({ reply: "A senha da porta é 4821, pode entrar." });
    expect(structural(d).blocks).toContain("possible_fabricated_credential");
    expect(sem(d).blocks).toContain("output_sensitive_content");
  });
});

describe("B2.3 · semântico — compromissos só com autorização real do sistema", () => {
  const handoff = { strategy: "answer_and_handoff", handoff: { needed: true, question: "Pode verificar o pedido?", urgency: "normal" } };
  it.each(COMMITMENT_KINDS.filter((k) => !["team_relay", "information_followup", "credential_release", "availability"].includes(k)))(
    "%s: sem fonte de autorização nesta fase ⇒ unauthorized_commitment, mesmo com encaminhamento",
    (k) => {
      for (const d of [withCommitment(k), withCommitment(k, handoff)]) {
        const r = sem(d);
        expect(r.blocks).toContain("unauthorized_commitment");
        expect(r.unauthorizedKinds).toEqual([k]);
      }
    },
  );
  it("repasse à equipe / retorno posterior: só com encaminhamento estruturado", () => {
    for (const k of ["team_relay", "information_followup"] as const) {
      expect(sem(withCommitment(k)).blocks).toContain("unauthorized_commitment");
      expect(sem(withCommitment(k, handoff)).blocks).toEqual([]);
    }
  });
  it("liberação de credenciais: só com D9 = allow E intenção pelo marcador", () => {
    const deny = ctx();
    const allow = { ...ctx({ phase: "in_stay", stay: { ...ctx().guest.stay!, phase: "in_stay" } }), credentialPolicy: { decision: "allow" as const, reason: "within_release_window" as const } };
    const viaMarker = withCommitment("credential_release", { credentialIntent: "would_deliver", reply: "Aqui estão os acessos: [[CREDENCIAIS]]" });
    expect(sem(viaMarker, { context: deny }).unauthorizedKinds).toEqual(["credential_release"]);
    expect(sem(viaMarker, { context: allow }).blocks).toEqual([]);
    expect(sem(withCommitment("credential_release"), { context: allow }).unauthorizedKinds).toEqual(["credential_release"]);
  });
  it("disponibilidade não consultada ⇒ recusada; confirmada e citada para o MESMO imóvel ⇒ aceita", () => {
    const views = (a: SemanticDossierView["availability"]): SemanticDossierView[] => [
      { ref: "principal", role: "primary", availability: "not_consulted" },
      { ref: "alt1", role: "candidate", availability: a },
    ];
    const d = withCommitment("availability", { strategy: "suggest_alternatives", groundedOn: ["dos:alt1:listing:fact:capacidade"] });
    expect(sem(d, { dossiers: views("not_consulted") }).unauthorizedKinds).toEqual(["availability"]);
    expect(sem(d, { dossiers: views("confirmed_unavailable") }).unauthorizedKinds).toEqual(["availability"]);
    expect(sem(d, { dossiers: views("confirmed_available") }).blocks).toEqual([]);
    // confirmada para alt1, mas a resposta se apoia em outro imóvel
    const other = withCommitment("availability", { groundedOn: ["dos:principal:x"] });
    expect(sem(other, { dossiers: views("confirmed_available") }).unauthorizedKinds).toEqual(["availability"]);
  });
  it("compromisso sem tipo declarado (v2) não é verificável ⇒ commitment_kinds_undeclared", () => {
    const r = parseDecision({ ...v3({ commitments: ["Libero a entrada às 10h"] }), commitmentKinds: undefined });
    // JSON real não tem `undefined`: simula decisão v2 com compromisso
    const v2like = { ...dec({ commitments: ["Libero a entrada às 10h"], commitmentKinds: ["early_checkin"] }) } as ModelDecision;
    delete (v2like as Partial<ModelDecision>).commitmentKinds;
    expect(r.ok).toBe(false);
    expect(sem(v2like).blocks).toContain("commitment_kinds_undeclared");
  });
  it("a tabela de autorização cobre todos os tipos e nunca autoriza tipos sem fonte", () => {
    expect(Object.keys(COMMITMENT_AUTHORIZATION).sort()).toEqual([...COMMITMENT_KINDS].sort());
    const a = deriveTurnAuthorizations(ctx(), null);
    // B2.4: entrada antecipada/saída tardia vêm da verificação formal; sem ela, nada é autorizado.
    expect(a).toMatchObject({ earlyCheckin: { status: "not_authorized" }, lateCheckout: { status: "not_authorized" }, reservationChange: "no_authorization_source", actionsExecuted: "none", availabilityConfirmedRefs: [] });
  });
});

describe("B2.3 · semântico — alteração contratual, alternativas e contexto", () => {
  it("alteração contratual sem rota (só 'answer') ⇒ formal_change_without_route; com encaminhamento, orientação ou esclarecimento ⇒ ok", () => {
    const base = { intents: ["formal_change_request"], formalChangeRequests: ["dates"] };
    expect(sem(dec(base)).blocks).toContain("formal_change_without_route");
    expect(sem(dec({ ...base, strategy: "guide" })).blocks).toEqual([]);
    expect(sem(dec({ ...base, strategy: "clarify" })).blocks).toEqual([]);
    expect(sem(dec({ ...base, strategy: "answer_and_handoff", handoff: { needed: true, question: "Hóspede pede mudar datas", urgency: "normal" } })).blocks).toEqual([]);
  });
  it("sugerir alternativas sem candidatos autorizados, ou sem citá-los ⇒ recusa", () => {
    const d = dec({ strategy: "suggest_alternatives", groundedOn: ["dos:principal:a"] });
    expect(sem(d).blocks).toContain("alternatives_without_candidates");
    const views: SemanticDossierView[] = [
      { ref: "principal", role: "primary", availability: "not_consulted" },
      { ref: "alt1", role: "candidate", availability: "not_consulted" },
    ];
    expect(sem(d, { dossiers: views }).blocks).toContain("alternatives_not_grounded");
    expect(sem(dec({ strategy: "suggest_alternatives", groundedOn: ["dos:alt1:a"] }), { dossiers: views }).blocks).toEqual([]);
  });
  it("contradição com o contexto: marco de saída antes da estadia; marco sem reserva", () => {
    const out = dec({ intents: ["departure_confirmation"], hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] } });
    expect(sem(out).blocks).toContain("milestone_phase_incompatible");
    const inq = ctx({ phase: "inquiry", stay: null });
    const arrival = dec({ intents: ["arrival_confirmation"], hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } });
    expect(sem(arrival, { context: inq }).blocks).toContain("milestone_without_stay");
    expect(sem(arrival).blocks).toEqual([]);
  });
  it("ritual: repetido quando o sistema sabe; novo verificado; desconhecido fica registrado como não verificado", () => {
    const arrival = dec({ intents: ["arrival_confirmation"], hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } });
    expect(sem(arrival, { priorMilestones: { status: "known", acknowledged: ["checkin_confirmed"] } }).blocks).toContain("milestone_repeated");
    expect(sem(arrival, { priorMilestones: { status: "known", acknowledged: [] } }).milestoneIdempotency).toBe("verified_new");
    expect(sem(arrival).milestoneIdempotency).toBe("unverified");
  });
  it("emergência nunca sem encaminhamento urgente", () => {
    const e = { intents: ["emergency"] };
    expect(sem(dec(e)).blocks).toContain("emergency_without_escalation");
    expect(sem(dec({ ...e, strategy: "answer_and_handoff", handoff: { needed: true, question: "Vazamento de gás relatado", urgency: "normal" } })).blocks).toContain("emergency_without_escalation");
    expect(sem(dec({ ...e, strategy: "answer_and_handoff", handoff: { needed: true, question: "Vazamento de gás relatado", urgency: "high" } })).blocks).toEqual([]);
  });
});

describe("B2.3 · semântico — saída sensível (FreeTextGuard na SAÍDA)", () => {
  it.each([
    [{ reply: "Use o código do cofre 7391 para pegar a chave." }],
    [{ handoff: { needed: true, question: "Hóspede diz que a senha 5530 não abre", urgency: "normal" }, strategy: "answer_and_handoff" }],
    [{ missingInformation: ["confirmar se o PIN 4417 ainda vale"] }],
    [{ commitments: ["enviar token sk-live-ABCDEFGH1234567890abcdef"], commitmentKinds: ["team_relay"], strategy: "answer_and_handoff", handoff: { needed: true, question: "q", urgency: "low" } }],
  ])("segredo em qualquer campo de texto ⇒ output_sensitive_content (%#)", (over) => {
    expect(sem(dec(over)).blocks).toContain("output_sensitive_content");
  });
  it("marcador de credenciais não é tratado como segredo", () => {
    const allow = { ...ctx({ phase: "in_stay", stay: { ...ctx().guest.stay!, phase: "in_stay" } }), credentialPolicy: { decision: "allow" as const, reason: "within_release_window" as const } };
    expect(sem(dec({ credentialIntent: "would_deliver", reply: "Senhas e códigos: [[CREDENCIAIS]]" }), { context: allow }).blocks).toEqual([]);
  });
  it("guard ausente, que lança ou que devolve lixo ⇒ output_guard_failed (fail-closed)", () => {
    expect(sem(dec(), { guard: null }).blocks).toEqual(["output_guard_failed"]);
    expect(sem(dec(), { guard: { scan: () => { throw new Error("x"); } } }).blocks).toEqual(["output_guard_failed"]);
    expect(sem(dec(), { guard: { scan: () => ({ status: "safe" }) as never } }).blocks).toEqual(["output_guard_failed"]);
    // guard que diz "safe" mas altera o texto não é confiável
    expect(sem(dec(), { guard: { scan: (t: string) => ({ status: "safe", text: `${t}.`, findings: [] }) } }).blocks).toEqual(["output_sensitive_content"]);
  });
  it("sem censura lexical: humor, emoji, desculpa e informalidade passam", () => {
    for (const reply of ["Puxa, desculpa a confusão! 😅 O check-in é às 15h.", "kkk relaxa, dá tempo de sobra: entrada às 15h 🙂", "Lamento muito pelo transtorno — o horário de entrada é 15h."]) {
      const d = dec({ reply });
      expect(structural(d).blocks).toEqual([]);
      expect(sem(d).blocks).toEqual([]);
    }
  });
  it("os códigos semânticos são de lista fechada", () => {
    expect(new Set(SEMANTIC_BLOCKS).size).toBe(SEMANTIC_BLOCKS.length);
  });
});
