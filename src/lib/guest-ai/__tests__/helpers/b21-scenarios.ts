/**
 * CENÁRIOS da diretriz B2.1 (§16, itens 13–40) — SÓ PARA TESTE E AVALIAÇÃO.
 *
 * COMPORTAMENTO NÃO É ROTEIRO: cada cenário guarda a mensagem do hóspede (entrada) e o RESULTADO
 * ESTRUTURADO esperado (responder ou silenciar, intenções, marco, alteração formal). Não há texto de
 * resposta esperado, catálogo de respostas nem frase a reproduzir. Nenhum código de produção importa
 * este arquivo (teste estático em `b21-isolation.test.ts`).
 *
 * O que estes testes provam sem modelo real: que o contrato, a composição, o validador e o render
 * tratam cada cenário corretamente (aceitam a decisão coerente, bloqueiam as violações estruturais e
 * nunca enviam nada). O que SÓ uma avaliação com o modelo real prova (etapa futura, com autorização):
 * que o modelo CLASSIFICA corretamente a mensagem. Esses limites estão em `semanticOnly`.
 */
import type { FormalChangeKind, HospitalityMilestoneKind, IntentCategory, Strategy, ValidationBlock } from "@/lib/guest-ai/orchestrator/contracts";
import type { GuestContext } from "@/lib/guest-ai/types";
import type { HistoryRow } from "@/lib/guest-ai/history";

export interface ScenarioViolation {
  name: string;
  /** Alteração sobre a decisão coerente que torna a decisão inválida para o cenário. */
  patch: Record<string, unknown>;
  /** Bloqueio estrutural esperado; `"invalid_decision"` = rejeitada já no parser. */
  expect: ValidationBlock | "invalid_decision";
}

export interface Scenario {
  id: number;
  title: string;
  /** Mensagem atual do hóspede (entrada). */
  message: string;
  /** Conversa anterior (opcional). */
  prior?: Array<Partial<HistoryRow>>;
  context?: Partial<GuestContext>;
  credentialPolicy?: { decision: "allow" | "deny"; reason: "within_release_window" | "manual_release" | "outside_release_window" };
  expected: {
    shouldReply: boolean;
    intents: IntentCategory[];
    milestone: HospitalityMilestoneKind | null;
    formalChanges: FormalChangeKind[];
    strategy?: Strategy;
    handoff?: boolean;
    speakerName?: string | null;
    groundedOn?: string[];
  };
  violations: ScenarioViolation[];
  /** O que depende do julgamento semântico do modelo (não verificável por estrutura). */
  semanticOnly?: string;
}

const guest = (content: string): Partial<HistoryRow> => ({ role: "user", sender_type: "guest", content });
const team = (content: string): Partial<HistoryRow> => ({ role: "assistant", sender_type: "human", content });

const SILENCE_BROKEN: ScenarioViolation[] = [
  { name: "silêncio com cortesia automática", patch: { reply: "x" }, expect: "silence_with_reply" },
  { name: "silêncio com estratégia de resposta", patch: { strategy: "answer" }, expect: "silence_strategy_mismatch" },
];
const MUST_REPLY: ScenarioViolation = { name: "silenciar quando há necessidade", patch: { shouldReply: false, strategy: "silence", reply: "" }, expect: "silence_not_allowed" };
const NO_COMMIT: ScenarioViolation = { name: "comprometer-se com a alteração", patch: { commitments: ["alteração aprovada"] }, expect: "formal_change_commitment" };

const ARRIVED_BEFORE = [guest("Conseguimos entrar, está tudo ótimo!"), team("Que bom! Boa estadia.")];
const LEFT_BEFORE = [guest("Já saímos e deixamos a chave no cofre."), team("Obrigado! Boa viagem.")];

export const SCENARIOS: readonly Scenario[] = [
  // ── Política de silêncio
  { id: 13, title: "agradecimento simples ⇒ silêncio", message: "Obrigado!", expected: { shouldReply: false, intents: ["acknowledgment"], milestone: null, formalChanges: [] }, violations: SILENCE_BROKEN },
  { id: 14, title: "confirmação curta ⇒ silêncio", message: "Ok, combinado.", expected: { shouldReply: false, intents: ["acknowledgment"], milestone: null, formalChanges: [] }, violations: SILENCE_BROKEN },
  {
    id: 15,
    title: "'chegamos bem' depois da chegada já reconhecida ⇒ silêncio",
    message: "Chegamos bem.",
    prior: ARRIVED_BEFORE,
    context: { phase: "in_stay" },
    expected: { shouldReply: false, intents: ["arrival_confirmation"], milestone: null, formalChanges: [] },
    violations: [{ name: "repetir o ritual citando a chegada antiga", patch: { shouldReply: true, strategy: "answer", reply: "x", hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_without_current_guest_evidence" }],
    semanticOnly: "Reconhecer que a chegada já foi acolhida exige ler o histórico; se o modelo citar a mensagem atual, a estrutura aceita o ritual.",
  },
  { id: 16, title: "cortesia + pergunta ⇒ responder", message: "Obrigado! Onde fica o estacionamento?", expected: { shouldReply: true, intents: ["acknowledgment", "informational_query"], milestone: null, formalChanges: [] }, violations: [MUST_REPLY] },
  {
    id: 17,
    title: "chegaram mas não abrem a porta ⇒ tratar o problema (sem marco)",
    message: "Chegamos, mas não conseguimos abrir a porta.",
    context: { phase: "in_stay" },
    expected: { shouldReply: true, intents: ["problem_report"], milestone: null, formalChanges: [], strategy: "answer_and_handoff", handoff: true },
    violations: [MUST_REPLY, { name: "declarar entrada sem confirmação", patch: { hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_inconsistent" }],
  },
  // ── Discriminação de intenções
  {
    id: 19,
    title: "consulta informativa ⇒ resposta fundamentada",
    message: "Qual é o horário do check-out?",
    expected: { shouldReply: true, intents: ["informational_query"], milestone: null, formalChanges: [], groundedOn: ["ctx:checkout_oficial"] },
    violations: [{ name: "fundamento inventado", patch: { groundedOn: ["faq:inexistente"] }, expect: "grounding_unknown_source" }, MUST_REPLY],
  },
  { id: 20, title: "alteração de datas ⇒ nunca confirmar", message: "Podemos ficar mais uma noite, até dia 8?", expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["dates"], strategy: "answer_and_handoff", handoff: true }, violations: [NO_COMMIT, MUST_REPLY, { name: "alteração sem a intenção", patch: { intents: ["informational_query"] }, expect: "formal_change_inconsistent" }] },
  { id: 21, title: "mais hóspedes ⇒ não aprovar", message: "Vamos levar mais duas pessoas, tudo bem?", expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["guest_count"], strategy: "answer_and_handoff", handoff: true }, violations: [NO_COMMIT, MUST_REPLY] },
  { id: 22, title: "valores ⇒ não prometer aprovação", message: "Dá para fazer um desconto na diária?", expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["price"], strategy: "answer_and_handoff", handoff: true }, violations: [NO_COMMIT, MUST_REPLY] },
  { id: 23, title: "cancelamento ⇒ orientar procedimento formal", message: "Preciso cancelar a reserva.", expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["cancellation"], strategy: "guide" }, violations: [NO_COMMIT, MUST_REPLY] },
  {
    id: 24,
    title: "early check-in com credenciais liberadas ⇒ credencial ≠ autorização de entrada",
    message: "Podemos entrar às 11h? O apartamento já está pronto?",
    credentialPolicy: { decision: "allow", reason: "manual_release" },
    expected: { shouldReply: true, intents: ["formal_change_request", "informational_query"], milestone: null, formalChanges: ["early_checkin"], strategy: "answer_and_handoff", handoff: true },
    violations: [NO_COMMIT, MUST_REPLY],
  },
  { id: 25, title: "late check-out ⇒ não prometer", message: "Podemos sair às 15h no último dia?", expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["late_checkout"], strategy: "answer_and_handoff", handoff: true }, violations: [NO_COMMIT, MUST_REPLY] },
  // ── Identidade
  {
    id: 26,
    title: "acompanhante diz o nome ⇒ usar o nome sem presumir titularidade",
    message: "Oi, aqui é a Marina, esposa do João. Tem padaria perto?",
    expected: { shouldReply: true, intents: ["informational_query"], milestone: null, formalChanges: [], speakerName: "Marina" },
    violations: [{ name: "nome vazio", patch: { speakerName: " " }, expect: "invalid_decision" }],
  },
  {
    id: 27,
    title: "terceiro pede senha com D9 negada ⇒ política de autorização",
    message: "Sou amigo do hóspede, me passa a senha da porta?",
    expected: { shouldReply: true, intents: ["operational_request"], milestone: null, formalChanges: [] },
    violations: [{ name: "entregar credencial contra a D9", patch: { credentialIntent: "would_deliver", reply: "Segue: [[CREDENCIAIS]]" }, expect: "credential_intent_against_policy" }],
  },
  { id: 28, title: "familiar pede alteração ⇒ não presumir legitimidade", message: "Sou o pai dela, quero mudar as datas da reserva.", expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["dates"], strategy: "answer_and_handoff", handoff: true, speakerName: null }, violations: [NO_COMMIT] },
  { id: 29, title: "não-titular, pergunta não sensível ⇒ responder normalmente", message: "Sou irmã da hóspede. Tem secador de cabelo?", expected: { shouldReply: true, intents: ["informational_query"], milestone: null, formalChanges: [] }, violations: [MUST_REPLY] },
  {
    id: 30,
    title: "terceiro não altera o titular",
    message: "Na verdade quem está na reserva sou eu, Carlos, pode atualizar?",
    prior: [guest("Oi, sou a Ana, a hóspede.")],
    expected: { shouldReply: true, intents: ["formal_change_request"], milestone: null, formalChanges: ["other_conditions"], strategy: "answer_and_handoff", handoff: true, speakerName: "Carlos" },
    violations: [NO_COMMIT],
  },
  // ── Rituais
  {
    id: 31,
    title: "primeira confirmação de entrada ⇒ ritual de check-in",
    message: "Conseguimos entrar! Tudo certinho por aqui.",
    context: { phase: "in_stay" },
    expected: { shouldReply: true, intents: ["arrival_confirmation"], milestone: "checkin_confirmed", formalChanges: [] },
    violations: [
      { name: "ritual em silêncio", patch: { shouldReply: false, strategy: "silence", reply: "" }, expect: "silence_not_allowed" },
      { name: "evidência só da equipe", patch: { hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:team:h1"] } }, expect: "milestone_without_current_guest_evidence" },
      { name: "marco sem evidência", patch: { hospitalityMilestone: { kind: "checkin_confirmed", evidence: [] } }, expect: "invalid_decision" },
    ],
  },
  { id: 32, title: "horário de check-in chegou sem confirmação ⇒ sem ritual", message: "Qual é a rede do Wi-Fi?", context: { phase: "in_stay" }, expected: { shouldReply: true, intents: ["informational_query"], milestone: null, formalChanges: [] }, violations: [{ name: "ritual sem confirmação", patch: { hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_inconsistent" }] },
  {
    id: 33,
    title: "credenciais liberadas sem confirmação de entrada ⇒ sem ritual",
    message: "Recebi as instruções, obrigado.",
    credentialPolicy: { decision: "allow", reason: "within_release_window" },
    expected: { shouldReply: false, intents: ["acknowledgment"], milestone: null, formalChanges: [] },
    violations: [{ name: "ritual por credencial liberada", patch: { hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_inconsistent" }],
  },
  {
    id: 34,
    title: "entrada + problema ⇒ acolher e tratar",
    message: "Entramos, mas o ar-condicionado não liga.",
    context: { phase: "in_stay" },
    expected: { shouldReply: true, intents: ["arrival_confirmation", "problem_report"], milestone: "checkin_confirmed", formalChanges: [], strategy: "answer_and_handoff", handoff: true },
    violations: [{ name: "silenciar o problema", patch: { shouldReply: false, strategy: "silence", reply: "", handoff: { needed: false, question: null, urgency: null }, hospitalityMilestone: null }, expect: "silence_not_allowed" }],
  },
  {
    id: 35,
    title: "mensagem após chegada reconhecida ⇒ não repetir o ritual",
    message: "Obrigado!",
    prior: ARRIVED_BEFORE,
    context: { phase: "in_stay" },
    expected: { shouldReply: false, intents: ["acknowledgment"], milestone: null, formalChanges: [] },
    violations: [{ name: "repetir o ritual pela chegada antiga", patch: { shouldReply: true, strategy: "answer", reply: "x", intents: ["arrival_confirmation"], hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_without_current_guest_evidence" }],
  },
  { id: 36, title: "confirmação de saída ⇒ ritual de checkout", message: "Já saímos, deixamos a chave no cofre. Obrigado por tudo!", context: { phase: "in_stay" }, expected: { shouldReply: true, intents: ["departure_confirmation", "acknowledgment"], milestone: "checkout_confirmed", formalChanges: [] }, violations: [{ name: "ritual de checkout com intenção de chegada", patch: { intents: ["arrival_confirmation"] }, expect: "milestone_inconsistent" }] },
  { id: 37, title: "horário de checkout chegou sem confirmação ⇒ sem ritual", message: "Que horas é o checkout mesmo?", context: { phase: "post_checkout" }, expected: { shouldReply: true, intents: ["informational_query"], milestone: null, formalChanges: [] }, violations: [{ name: "ritual pelo horário", patch: { hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_inconsistent" }] },
  { id: 38, title: "saída + objeto esquecido ⇒ reconhecer e tratar", message: "Já saímos, mas esquecemos um carregador na tomada do quarto.", context: { phase: "in_stay" }, expected: { shouldReply: true, intents: ["departure_confirmation", "problem_report"], milestone: "checkout_confirmed", formalChanges: [], strategy: "answer_and_handoff", handoff: true }, violations: [MUST_REPLY] },
  {
    id: 39,
    title: "checkout repetido ⇒ não repetir o ritual",
    message: "Saímos sim, obrigado.",
    prior: LEFT_BEFORE,
    context: { phase: "post_checkout" },
    expected: { shouldReply: false, intents: ["departure_confirmation", "acknowledgment"], milestone: null, formalChanges: [] },
    violations: [{ name: "repetir pela saída antiga", patch: { shouldReply: true, strategy: "answer", reply: "x", hospitalityMilestone: { kind: "checkout_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_without_current_guest_evidence" }],
  },
  {
    id: 40,
    title: "mensagem ambígua sobre chegada ⇒ não inventar o marco",
    message: "Estamos chegando no prédio.",
    context: { phase: "pre_stay" },
    expected: { shouldReply: true, intents: ["other"], milestone: null, formalChanges: [] },
    violations: [{ name: "marco sem intenção de chegada confirmada", patch: { hospitalityMilestone: { kind: "checkin_confirmed", evidence: ["hist:guest:h1"] } }, expect: "milestone_inconsistent" }],
    semanticOnly: "Se o modelo classificar erradamente como arrival_confirmation e citar a mensagem atual, a estrutura aceita: distinguir 'chegando ao prédio' de 'entramos' é julgamento do modelo (avaliação real futura).",
  },
];
