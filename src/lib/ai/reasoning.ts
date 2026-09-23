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
 * quando a própria mensagem não deixa dúvida de que não há o que pensar.
 *
 * CALIBRAGEM DE CUSTO (21/09/2026 — o app sozinho consumiu 303 chamadas e ~56
 * créditos num único dia, a maior parte em raciocínio máximo sobre mensagens
 * que não pediam nada disso)
 *
 * A escada continua a mesma; o que muda é o degrau de cada tipo de mensagem:
 *
 *   · max    — tudo que DECIDE, GRAVA ou JULGA: ação, dinheiro, hóspede,
 *              cancelamento, comparação, texto longo, várias perguntas, risco.
 *   · high   — pergunta informativa comum ("como faço para anexar um vídeo?").
 *   · medium — pergunta objetiva e curta de um dado só ("que horas é o
 *              checkout?"): o mesmo modelo, a mesma documentação, sem gastar
 *              milhares de tokens de raciocínio para ler uma linha.
 *   · low    — saudação/agradecimento solto ("oi", "obrigado", "ok"). Não há
 *              o que pensar; pensar aqui é só conta.
 *
 * O que NUNCA desce: risco, ação, dinheiro e julgamento continuam no topo. A
 * economia sai das mensagens triviais, não da qualidade das difíceis.
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
  "explica",
  "explique",
  "motivo",
  "roteiro",
  "planej",
  "estrateg",
  "analis",
  "resum",
];

/**
 * PEDIDO DE INDICAÇÃO (22/09/2026).
 *
 * "Melhor restaurante para jantar perto daqui?" caía em DEEP e ia para o topo
 * com 12 idas a ferramenta: três minutos de espera para a pergunta mais comum
 * que um hóspede faz — e, na prática, resposta nenhuma. Indicar lugar é buscar
 * e escolher, não deliberar: "high" dá a mesma resposta em uma fração do tempo.
 */
const ADVICE = ["melhor", "pior", "vale a pena", "recomend", "sugest", "prefer"];


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

/** Assuntos em que errar custa caro — nunca reduzem o esforço. */
const TOUCHY = [
  "reembols",
  "cobran",
  "pagamento",
  "cancel",
  "multa",
  "estorno",
  "hospede",
  "hóspede",
  "reclama",
];

/**
 * A mensagem manda o sistema FAZER algo? (20/09/2026)
 *
 * Até aqui o painel marcava TODA mensagem como ação, o que travava o topo do
 * raciocínio até em "como faço para anexar um vídeo?". Quem decide agora é o
 * verbo escrito: pedido de gravação continua no máximo, pergunta não.
 *
 * Só conta verbo no IMPERATIVO/INFINITIVO de pedido. "Como eu crio uma
 * pendência?" é pergunta — por isso a frase que começa com "como", "o que",
 * "onde", "quando", "por que" ou "qual" não é tratada como ação.
 */
const ACTION_VERBS = [
  "cria",
  "criar",
  "crie",
  "abre",
  "abrir",
  "abra",
  "exclu",
  "apaga",
  "apagar",
  "apague",
  "remov",
  "delet",
  "arquiv",
  "conclu",
  "finaliza",
  "encerra",
  "marca",
  "marcar",
  "marque",
  "define",
  "definir",
  "defina",
  "altera",
  "alterar",
  "altere",
  "muda",
  "mudar",
  "mude",
  "atualiza",
  "reabr",
  "adiciona",
  "adicionar",
  "agenda",
  "agendar",
  "envia",
  "enviar",
  "confirma",
  "confirmar",
  "faz ",
  "faça",
  "avanc",
  "avanç",
];

const QUESTION_START = ["como", "o que", "oque", "onde", "quando", "por que", "porque", "qual", "quais", "quem"];

export function looksLikeAction(message: string): boolean {
  const text = norm(message);
  if (QUESTION_START.some((k) => text.startsWith(norm(k)))) return false;
  return ACTION_VERBS.some((v) => text.includes(norm(v)));
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
    return "low";
  }

  const questions = (message.match(/\?/g) ?? []).length;
  const deep = DEEP.some((k) => text.includes(norm(k)));
  const advice = ADVICE.some((k) => text.includes(norm(k)));
  const factual =
    !deep &&
    !advice &&

    questions <= 1 &&
    words.length <= 8 &&
    message.length <= 80 &&
    FACTUAL_START.some((k) => bare.startsWith(norm(k)));
  if (factual) return "medium";
  // Julgamento, várias perguntas de uma vez ou um texto longo: é aí que a
  // pessoa realmente escreveu algo que exige pensar.
  if (deep || questions > 1 || message.length > 160) return "max";

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
  // Consulta pontual e saudação não precisam de uma dúzia de idas a ferramenta:
  // cada passo é uma chamada paga a mais sobre a mesma pergunta simples.
  return effort === "high" ? 10 : effort === "medium" ? 5 : 2;
}
