/**
 * Quanto a IA pensa antes de responder — política única das duas IAs.
 *
 * Pedido explícito (07/09/2026): "quero que ela seja altamente inteligente,
 * como se o usuário estivesse conversando com o ChatGPT, com o Gemini".
 *
 * O QUE ESTAVA ERRADO
 *
 * Os dois agentes rodavam com `reasoningEffort: "low"` em praticamente toda
 * conversa — o atendimento só subia para "medium" quando a mensagem era urgente
 * ou arriscada, e o assistente do painel estava fixo em "low". Num modelo de
 * raciocínio, "low" não é uma economia inofensiva: é a diferença entre pensar
 * no problema e responder de bate-pronto. Era o que fazia as respostas
 * parecerem rasas mesmo com todo o contexto certo na mão — não faltava
 * informação, faltava pensar.
 *
 * O QUE MUDA (19/09/2026 — pedido: "a IA SEMPRE com o máximo esforço, mas com
 * poder de decisão para reduzir quando achar pertinente")
 *
 * O padrão passa a ser o TOPO ("max"). A redução é a exceção, e só acontece
 * quando a própria mensagem não deixa dúvida de que não há o que pensar:
 *
 *   · max    — padrão de tudo. Qualquer pergunta, pedido, reclamação, ação.
 *   · xhigh  — pergunta objetiva e curta de um dado só ("que horas é o
 *              checkout?"), onde o topo só adicionaria espera.
 *   · medium — saudação/agradecimento solto ("oi", "obrigado", "ok").
 *
 * O CUSTO, DITO NA CARA
 *
 * Pensar mais custa mais tempo e mais tokens. A escolha aqui é deliberada:
 * o padrão é pagar para pensar; economizar é a exceção justificada.
 */

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Trivial de verdade — não vale gastar raciocínio. */
const TRIVIAL = [
  "oi",
  "olá",
  "ola",
  "bom dia",
  "boa tarde",
  "boa noite",
  "ok",
  "okay",
  "certo",
  "obrigado",
  "obrigada",
  "valeu",
  "tudo bem",
  "beleza",
  "sim",
  "não",
  "nao",
  "tchau",
  "até mais",
];

/** Pede julgamento de verdade — nunca reduz o esforço. */
const DEEP = [
  "por que",
  "porque",
  "diferenca",
  "compar",
  "melhor",
  "pior",
  "vale a pena",
  "recomend",
  "sugest",
  "explica",
  "explique",
  "motivo",
  "roteiro",
  "planej",
  "estrateg",
  "analis",
  "resum",
  "prefer",
];

/** Pergunta objetiva de um dado só: um "qual/que horas/onde" curto e único. */
const FACTUAL_START = [
  "qual",
  "quais",
  "que horas",
  "onde",
  "quando",
  "quanto",
  "tem ",
  "existe",
];

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/**
 * Decide o esforço para uma mensagem. O padrão é o máximo; só reduz quando a
 * mensagem é comprovadamente trivial ou uma consulta pontual de um dado.
 *
 * `isAction` cobre o caso em que a pessoa está mandando o sistema FAZER algo:
 * ali nunca reduzimos, porque interpretar errado grava dado errado.
 */
export function reasoningFor(
  message: string,
  opts?: { isAction?: boolean; highRisk?: boolean },
): ReasoningEffort {
  if (opts?.highRisk || opts?.isAction) return "max";
  if (looksLikeAction(message) || TOUCHY.some((k) => norm(message).includes(norm(k)))) return "max";

  const text = norm(message);
  const words = text.split(/\s+/).filter(Boolean);
  const bare = text.replace(/[!?.…,;:]+$/, "").trim();

  // Saudação solta e afins: só quando a mensagem inteira é isso, para "ok, mas
  // por que a limpeza mudou de dia?" não cair aqui por começar com "ok".
  if (words.length <= 3 && TRIVIAL.map(norm).some((k) => bare === k || bare.startsWith(`${k} `))) {
    return "medium";
  }

  const questions = (message.match(/\?/g) ?? []).length;
  const deep = DEEP.some((k) => text.includes(norm(k)));
  const factual =
    !deep &&
    questions <= 1 &&
    words.length <= 8 &&
    message.length <= 80 &&
    FACTUAL_START.some((k) => bare.startsWith(norm(k)));
  if (factual) return "xhigh";
  if (deep) return "max";

  /**
   * PERGUNTA INFORMATIVA (20/09/2026 — "não pode demorar tanto para responder,
   * nem para a equipe nem para hóspedes").
   *
   * "Como faço para anexar um vídeo?" não manda o sistema fazer nada, não
   * envolve dinheiro nem hóspede e não pede julgamento — e estava pensando no
   * topo, 90 segundos. "high" é o mesmo modelo, com a mesma documentação na
   * mão, respondendo em uma fração do tempo. O topo continua sendo o padrão de
   * tudo que DECIDE ou GRAVA algo.
   */
  return "high";
}

/**
 * Passos de ferramenta disponíveis. Uma pergunta que merece raciocínio também
 * merece espaço para investigar.
 */
export function maxStepsFor(effort: ReasoningEffort): number {
  if (effort === "max" || effort === "xhigh") return 12;
  return effort === "high" ? 10 : effort === "medium" ? 8 : 5;
}
