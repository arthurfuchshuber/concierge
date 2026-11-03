/**
 * F2-B · B2.4 — LLM MOCK determinístico para o Shadow Mode (B3), SÓ para avaliação passiva.
 *
 * Não é modelo comercial e nunca é registrado como tal: toda instância tem `modelMode: "mock"` e
 * id `llm-mock`. Não acessa rede, não importa o Gateway, não simula efeito externo nenhum (nada é
 * enviado, criado, alterado ou liberado) e não simula sucesso de integração: só devolve o TEXTO
 * que um modelo devolveria, para exercitar parser, validadores e decisão final.
 *
 * Determinismo: a saída depende só do cenário e de ids estruturais do prompt (`sourceIds`), nunca
 * do conteúdo das mensagens. Instâncias são emitidas por `createLlmMock` (registro WeakSet): o
 * harness passivo recusa qualquer gerador que não seja um mock emitido aqui.
 */
import type { ComposedPrompt } from "@/lib/guest-ai/orchestrator/contracts";
import { DECISION_TEXT_MAX_CHARS } from "@/lib/guest-ai/orchestrator/decision";

export const LLM_MOCK_ID = "llm-mock";
export const LLM_MOCK_VERSION = "llm-mock.2026-11-03.1";

export const MOCK_SCENARIOS = [
  "valid_reply",
  "silence",
  "handoff",
  "unauthorized_commitment",
  "invalid_json",
  "truncated_json",
  "unknown_field",
  "fabricated_credential",
  "emergency",
  "context_inconsistent",
  "natural_language_promise",
  "timeout",
  "technical_error",
  "over_budget",
] as const;
export type MockScenario = (typeof MOCK_SCENARIOS)[number];

export type LlmMockSpec = { scenario: MockScenario } | { scenario: "custom"; output: string | Record<string, unknown> };

export interface LlmMock {
  readonly modelMode: "mock";
  readonly id: typeof LLM_MOCK_ID;
  readonly version: string;
  readonly scenario: MockScenario | "custom";
  generate(prompt: ComposedPrompt, signal: AbortSignal): Promise<string>;
  /** Quantas vezes foi chamado (o harness nunca repete chamada). */
  calls(): number;
}

const issued = new WeakSet<object>();
export const isLlmMock = (v: unknown): v is LlmMock => typeof v === "object" && v !== null && issued.has(v);

export class MockTechnicalError extends Error {
  constructor() {
    super("mock_technical_error");
    this.name = "MockTechnicalError";
  }
}

/** Id estrutural da mensagem atual do hóspede (`hist:guest:hN` de maior N). */
function currentGuestRef(ids: ReadonlySet<string> | null): string | null {
  let best: { n: number; id: string } | null = null;
  for (const id of ids ?? []) {
    const m = /^hist:guest:h(\d+)$/.exec(id);
    if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), id };
  }
  return best?.id ?? null;
}

function decision(over: Record<string, unknown>, prompt: ComposedPrompt): Record<string, unknown> {
  const ground = prompt.sourceIds?.has("ctx:fase") ? ["ctx:fase"] : [];
  return {
    strategy: "answer",
    reply: "[mock] resposta simulada.",
    handoff: { needed: false, question: null, urgency: null },
    caseRelation: "no_open_case",
    groundedOn: ground,
    missingInformation: [],
    capabilityNeeds: [],
    credentialIntent: "none",
    commitments: [],
    shouldReply: true,
    intents: ["informational_query"],
    formalChangeRequests: [],
    hospitalityMilestone: null,
    speakerName: null,
    commitmentKinds: [],
    promisedTimes: [],
    ...over,
  };
}

function outputFor(scenario: MockScenario, prompt: ComposedPrompt): string {
  const cur = currentGuestRef(prompt.sourceIds);
  const hasCase = !!prompt.sourceIds?.has("case:c1");
  const relation = hasCase ? "independent" : "no_open_case";
  switch (scenario) {
    case "valid_reply":
      return JSON.stringify(decision({ caseRelation: relation }, prompt));
    case "silence":
      return JSON.stringify(decision({ strategy: "silence", reply: "", shouldReply: false, intents: ["acknowledgment"], groundedOn: [], caseRelation: relation }, prompt));
    case "handoff":
      return JSON.stringify(decision({ strategy: "handoff", reply: "", groundedOn: [], caseRelation: relation, handoff: { needed: true, question: "[mock] encaminhamento simulado", urgency: "normal" }, intents: ["operational_request"] }, prompt));
    case "unauthorized_commitment":
      return JSON.stringify(decision({ caseRelation: relation, reply: "[mock] compromisso simulado.", commitments: ["[mock] entrada antecipada"], commitmentKinds: ["early_checkin"], intents: ["operational_request"] }, prompt));
    case "invalid_json":
      return "{mock: sem aspas}";
    case "truncated_json":
      return '{"strategy":"answer","reply":"[mock] trunc';
    case "unknown_field":
      return JSON.stringify({ ...decision({ caseRelation: relation }, prompt), mockExtra: true });
    case "fabricated_credential":
      return JSON.stringify(decision({ caseRelation: relation, reply: "A senha da porta é 4812." }, prompt));
    case "emergency":
      return JSON.stringify(decision({ caseRelation: relation, strategy: "answer_and_handoff", intents: ["emergency"], reply: "[mock] orientação de segurança simulada.", handoff: { needed: true, question: "[mock] emergência simulada", urgency: "high" } }, prompt));
    case "context_inconsistent":
      // Marco de saída "confirmado" pela mensagem atual mesmo antes da estadia (contradiz a fase do servidor).
      return JSON.stringify(decision({ caseRelation: relation, intents: ["departure_confirmation"], groundedOn: cur ? [cur] : [], hospitalityMilestone: cur ? { kind: "checkout_confirmed", evidence: [cur] } : null }, prompt));
    case "natural_language_promise":
      // Promessa SÓ no texto, sem declaração estruturada: limitação conhecida (não detectável sem regra lexical).
      return JSON.stringify(decision({ caseRelation: relation, reply: "[mock] pode deixar, já resolvi isso para você." }, prompt));
    case "over_budget":
      return `{"strategy":"answer","reply":"${"x".repeat(DECISION_TEXT_MAX_CHARS + 10)}"}`;
    default:
      throw new MockTechnicalError();
  }
}

export function createLlmMock(spec: LlmMockSpec): LlmMock {
  let count = 0;
  const scenario = spec.scenario;
  const mock: LlmMock = {
    modelMode: "mock",
    id: LLM_MOCK_ID,
    version: LLM_MOCK_VERSION,
    scenario,
    calls: () => count,
    generate(prompt: ComposedPrompt, signal: AbortSignal): Promise<string> {
      count += 1;
      if (spec.scenario === "custom") {
        return Promise.resolve(typeof spec.output === "string" ? spec.output : JSON.stringify(spec.output));
      }
      if (spec.scenario === "timeout") {
        // Nunca responde; só termina quando a cadeia aborta por prazo.
        return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("mock_aborted")), { once: true }));
      }
      if (spec.scenario === "technical_error") return Promise.reject(new MockTechnicalError());
      try {
        return Promise.resolve(outputFor(spec.scenario, prompt));
      } catch (e) {
        return Promise.reject(e);
      }
    },
  };
  Object.freeze(mock);
  issued.add(mock);
  return mock;
}
