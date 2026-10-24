/**
 * DECISÕES DA EQUIPE POR BOTÕES (18/10/2026, regra do anfitrião).
 *
 * Toda pergunta da IA à equipe sai com opções de escolha prontas — o humano
 * decide com um toque, sem digitar. Dois tipos:
 * - "operational": decisão pontual de uma estadia (ex.: liberar check-in
 *   antecipado). NUNCA vira conhecimento.
 * - "fact": dúvida sobre o imóvel (ex.: "tem ferro de passar?"). Depois da
 *   resposta, a equipe escolhe explicitamente — sem opção pré-marcada — se
 *   aquilo vira conhecimento DAQUELE imóvel.
 */
export type DecisionKind = "operational" | "fact";

/** Ação que o sistema executa quando a equipe escolhe a opção. */
export const DECISION_ACTIONS = ["checkin_done", "checkout_done", "none"] as const;
export type DecisionAction = (typeof DECISION_ACTIONS)[number];

export type DecisionSpec = {
  kind: DecisionKind;
  options: string[];
  /** Opção → ação no sistema (copiloto proativo). Ausente = só resposta. */
  actions?: Record<string, DecisionAction>;
};

/** Onde o conhecimento salvo vale: só neste imóvel ou em todos da conta. */
export type KnowledgeScope = "property" | "global";

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Limpeza concluída + hóspede quis antecipar (24/10/2026): a equipe decide se a
 * IA leva a notícia, se ela mesma avisa, ou se fica o horário oficial.
 */
export const EARLY_RELEASE_AI = "Sim, a IA pode avisar";
export const EARLY_RELEASE_SELF = "Liberar, eu mesmo aviso";
export const EARLY_RELEASE_KEEP = "Manter horário oficial";
export const EARLY_CHECKIN_OPTIONS = [EARLY_RELEASE_AI, EARLY_RELEASE_SELF, EARLY_RELEASE_KEEP] as const;

/** Respostas do cartão de antecipação que liberam a entrada agora. */
export function earlyReleaseApproved(answer: string): boolean {
  const a = answer.trim();
  return a === EARLY_RELEASE_AI || a === EARLY_RELEASE_SELF || a === "Liberar check-in agora";
}

/** Respostas em que a IA NÃO fala com o hóspede. */
export function earlyReleaseSilent(answer: string): boolean {
  const a = answer.trim();
  return a === EARLY_RELEASE_SELF || a === EARLY_RELEASE_KEEP || a === "Aguardar o horário oficial";
}

const AMENITY =
  /\b(tem|teria|possui|dispoe|disponibiliza|ha|existe|vem com|has|is there|do you have|hay|tiene)\b/;

/** Monta as opções de botão para a pergunta, a partir da fala do hóspede. */
export function buildDecisionSpec(guestMessage: string, kind?: DecisionKind): DecisionSpec {
  const m = norm(guestMessage ?? "");
  if (kind === "operational") return { kind, options: ["Sim, pode", "Não"] };
  if (OPEN_QUESTION.test(m)) return { kind: kind ?? "fact", options: [] };
  if (AMENITY.test(m)) {
    return {
      kind: "fact",
      options: ["Sim, tem no imóvel", "Não tem", "Disponível sob solicitação"],
    };
  }
  if (/\b(pode|posso|podemos|permitido|aceita|can i|may i|se puede)\b/.test(m)) {
    return { kind: "fact", options: ["Sim, é permitido", "Não é permitido", "Depende — eu assumo"] };
  }
  return { kind: kind ?? "fact", options: ["Sim", "Não", TAKEOVER_OPTION] };
}

/**
 * Pergunta ABERTA (dias, horários, onde, como, qual, senha…): "Sim/Não" não
 * responde nada. Sai sem botões → o cartão abre o campo de resposta livre.
 */
const OPEN_QUESTION =
  /\b(qua(l|is)|quando|onde|como|quanto|quantos?|que horas?|horarios?|dias?|endereco|senha|codigo|numero|telefone|contato|what|when|where|how|which|cual|cuando|donde|como)\b/;

/**
 * Opção "eu assumo": a equipe passa a responder direto ao hóspede (ex.: dúvida
 * aberta como senha do Wi-Fi). Nunca vira resposta da IA nem conhecimento.
 */
export const TAKEOVER_OPTION = "Eu assumo a conversa";
export function isTakeoverOption(option: string): boolean {
  return option.trim() === TAKEOVER_OPTION || option.trim() === "Depende — eu assumo";
}

/** Só dúvidas sobre o imóvel podem virar conhecimento — nunca decisões operacionais. */
export function canBecomeKnowledge(kind: DecisionKind | null | undefined): boolean {
  return kind !== "operational";
}

/** Lê a especificação gravada no escalonamento (context_snapshot.decision). */
export function readDecisionSpec(snapshot: unknown): DecisionSpec | null {
  const d = (snapshot as { decision?: { kind?: unknown; options?: unknown } } | null)?.decision;
  if (!d || !Array.isArray(d.options)) return null;
  const options = d.options.filter((o): o is string => typeof o === "string" && !!o.trim());
  if (!options.length) return null;
  const raw = (d as { actions?: unknown }).actions;
  const actions: Record<string, DecisionAction> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if ((DECISION_ACTIONS as readonly string[]).includes(String(v))) actions[k] = v as DecisionAction;
    }
  }
  return {
    kind: d.kind === "operational" ? "operational" : "fact",
    options,
    ...(Object.keys(actions).length ? { actions } : {}),
  };
}

/** Ação vinculada à opção escolhida ("none" quando não há). */
export function actionFor(spec: DecisionSpec | null, option: string): DecisionAction {
  return spec?.actions?.[option] ?? "none";
}

/** Escopo de conhecimento → escopo de aprendizado do backend. */
export function learningScopeOf(scope: KnowledgeScope): "property" | "owner_portfolio" {
  return scope === "global" ? "owner_portfolio" : "property";
}

/**
 * O hóspede manifestou EXPRESSAMENTE vontade de entrar antes do horário?
 * Pedido de antecipação, ou horário de chegada informado antes do check-in.
 */
export function guestWantsEarlyCheckin(guestMessages: string[], checkinHour = 15): boolean {
  for (const raw of guestMessages) {
    const m = norm(raw);
    if (/\b(antecipa\w*|mais cedo|early check-?in|check-?in antecipado|entrar antes|chegar antes)\b/.test(m)) return true;
    const re = /\b(?:cheg\w*|estar(?:emos)?\s+a[ií]|entrar|aterriss\w*|desembarc\w*)\b[^.!?\n]{0,40}?\b(\d{1,2})(?:[:h](\d{2}))?\s*(h|hs|horas)?\b/g;
    for (const x of m.matchAll(re)) {
      const h = Number(x[1]);
      if (Number.isFinite(h) && h >= 5 && h < checkinHour) return true;
    }
  }
  return false;
}
