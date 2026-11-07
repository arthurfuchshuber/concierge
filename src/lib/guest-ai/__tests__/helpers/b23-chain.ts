/**
 * Fixtures da B2.3 (cadeia fail-closed, parser, validadores, silêncio).
 * Saídas de modelo são SINTÉTICAS e estruturadas; nenhum texto aqui é roteiro de resposta.
 * Valores com aparência de segredo são inventados (nunca de produção).
 */
import { issue } from "@/lib/guest-ai/trust";
import type { ValidatedTurn, GuestContext } from "@/lib/guest-ai/types";
import type { ComposedPrompt, ConversationContext } from "@/lib/guest-ai/orchestrator/contracts";
import { normalizeHistory, type HistoryRow } from "@/lib/guest-ai/history";
import { SECRET_SCRUBBER } from "@/lib/guest-ai/secret-scrub";
import type { ChainAudit, ChainDeps } from "@/lib/guest-ai/turn-chain";
import { CONV, MSG, conversationContext, row } from "./b21-fixtures";
import { validDecision } from "./decision-fixtures";

export { CONV, MSG };

export const TURN_FIELDS = {
  surface: "guide_chat",
  conversationId: CONV,
  messageId: MSG,
  propertyId: "p1",
  tenantId: "t1",
  guestSessionId: "wa:5511988887777",
  conversationStatus: "ai",
  reservationId: "r1",
  messageCreatedAt: null,
} as const;

export const turn = (over: Partial<ValidatedTurn> = {}) => issue("turn", { ...TURN_FIELDS, ...over }) as ValidatedTurn;

export const ctx = (over: Partial<GuestContext> = {}, cases: ConversationContext["humanOwnership"]["cases"] = []) => conversationContext(over, cases);

/** Histórico simples: uma mensagem anterior da equipe e a mensagem atual do hóspede. */
export function history(current = "Qual é o horário do check-in?", previous: Array<Partial<HistoryRow>> = []) {
  return normalizeHistory(
    [
      ...previous.map((p, i) => row({ created_at: `2026-11-03T09:${String(10 + i).padStart(2, "0")}:00Z`, role: "assistant", sender_type: "human", ...p })),
      row({ id: MSG, created_at: "2026-11-03T10:00:00Z", content: current }),
    ],
    { conversationId: CONV, currentMessageId: MSG },
  );
}

/** Ref da mensagem atual no histórico acima (`hist:guest:hN`). */
export const currentRef = (previousCount = 0) => `hist:guest:h${previousCount + 1}`;

/** Decisão v3 válida e autorizada (resposta informativa, fundamentada em fato do contexto). */
export const v3 = (over: Record<string, unknown> = {}) =>
  validDecision({
    reply: "O check-in começa às 15h, no horário do imóvel.",
    groundedOn: ["ctx:checkin_oficial"],
    shouldReply: true,
    intents: ["informational_query"],
    formalChangeRequests: [],
    hospitalityMilestone: null,
    speakerName: null,
    commitmentKinds: [],
    ...over,
  });

/**
 * B2.5: decisão v4 (= v3 + `promisedTimes`), a versão que o prompt atual pede e a cadeia exige.
 * Testes que exercitam a cadeia usam `v4`; testes do parser/validador que afirmam v3 seguem com `v3`.
 */
export const v4 = (over: Record<string, unknown> = {}) => v3({ promisedTimes: [], ...over });

/**
 * G2: decisão v5 (= v4 + `guestEtas` + `milestoneQuote`), a versão que o prompt atual pede e a cadeia exige.
 * Testes que exercitam a cadeia usam `v5`; testes de compatibilidade do parser seguem com v1–v4.
 */
export const v5 = (over: Record<string, unknown> = {}) => v4({ guestEtas: [], milestoneQuote: null, ...over });

/** Silêncio v5 válido. */
export const silence = (over: Record<string, unknown> = {}) =>
  v5({ strategy: "silence", reply: "", shouldReply: false, intents: ["acknowledgment"], groundedOn: [], ...over });

export interface ChainHarness {
  deps: ChainDeps;
  calls: { generate: number; prompts: ComposedPrompt[]; logs: ChainAudit[] };
}

/** Dependências falsas: contexto, histórico e gerador em memória; log capturado. */
export function harness(output: unknown, over: Partial<ChainDeps> = {}): ChainHarness {
  const calls = { generate: 0, prompts: [] as ComposedPrompt[], logs: [] as ChainAudit[] };
  const deps: ChainDeps = {
    loadContext: async () => ctx(),
    loadHistory: async () => history(),
    generate: async (prompt) => {
      calls.generate += 1;
      calls.prompts.push(prompt);
      return typeof output === "string" ? output : JSON.stringify(output);
    },
    guard: SECRET_SCRUBBER,
    log: (a) => calls.logs.push(a),
    ...over,
  };
  return { deps, calls };
}
