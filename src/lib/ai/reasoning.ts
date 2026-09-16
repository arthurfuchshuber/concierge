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
 * O QUE MUDA
 *
 * O esforço passa a depender do que foi PERGUNTADO, e não só de urgência:
 *
 *   · alto   — a pessoa pediu comparação, recomendação, um porquê, um plano,
 *              ou mandou um texto longo com várias perguntas juntas. É o tipo
 *              de resposta que só fica boa se o modelo pensar antes.
 *   · médio  — o padrão de qualquer conversa de verdade. Vale também para todo
 *              pedido de AÇÃO: gravar a coisa errada custa mais caro do que os
 *              segundos a mais de raciocínio.
 *   · baixo  — só o que é genuinamente trivial: saudação, "ok", "obrigado",
 *              uma confirmação de uma linha.
 *
 * O CUSTO, DITO NA CARA
 *
 * Pensar mais custa mais tempo e mais tokens. A escolha aqui é deliberada:
 * pagar isso nas perguntas que merecem e não pagar nas que não merecem — em
 * vez de economizar em todas, que era o comportamento anterior e o motivo da
 * reclamação.
 */

export type ReasoningEffort = "low" | "medium" | "high";

/** Pede raciocínio de verdade: comparar, explicar, planejar, recomendar. */
const DEEP = [
  "por que",
  "porque",
  "porquê",
  "qual a diferença",
  "diferença entre",
  "compare",
  "comparar",
  "melhor",
  "pior",
  "vale a pena",
  "recomend",
  "sugest",
  "sugir",
  "o que fazer",
  "como faço",
  "como funciona",
  "explica",
  "explique",
  "motivo",
  "roteiro",
  "planej",
  "estratég",
  "analis",
  "análise",
  "resum",
  "quanto custa",
  "prefer",
];

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

function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

/**
 * Decide o esforço para uma mensagem.
 *
 * `isAction` cobre o caso em que a pessoa está mandando o sistema FAZER algo
 * (criar pendência, marcar não comparecimento): ali o piso é médio mesmo que a
 * frase seja curta, porque interpretar errado grava dado errado.
 */
export function reasoningFor(
  message: string,
  opts?: { isAction?: boolean; highRisk?: boolean },
): ReasoningEffort {
  if (opts?.highRisk) return "high";

  const text = norm(message);
  const words = text.split(/\s+/).filter(Boolean);

  // Saudação solta e afins: só quando a mensagem inteira é isso, para "ok, mas
  // por que a limpeza mudou de dia?" não cair aqui por começar com "ok".
  // A pontuação final sai antes da comparação — "obrigado!" e "oi?" são a
  // mesma coisa que "obrigado" e "oi", e um teste pegou justamente isso.
  const bare = text.replace(/[!?.…,;:]+$/, "").trim();
  if (words.length <= 3 && TRIVIAL.map(norm).some((k) => bare === k || bare.startsWith(`${k} `))) {
    return opts?.isAction ? "medium" : "low";
  }

  const questions = (message.match(/\?/g) ?? []).length;
  // As palavras-chave também passam por norm(): o texto já vem sem acento,
  // então comparar com "análise" cru nunca casaria.
  const deep = DEEP.some((k) => text.includes(norm(k)));

  // Texto longo, várias perguntas na mesma mensagem ou pedido que exige
  // julgamento: é onde a diferença entre pensar e não pensar aparece.
  if (deep || questions >= 2 || message.length > 180) return "high";

  return "medium";
}

/**
 * Passos de ferramenta disponíveis. Seis passos obrigavam o agente a responder
 * com o que tivesse em mãos assim que a conversa exigisse duas ou três
 * consultas encadeadas ("acha o imóvel" → "vê a agenda" → "confere a
 * pendência") — o teto chegava antes da resposta. Uma pergunta que merece
 * raciocínio também merece espaço para investigar.
 */
export function maxStepsFor(effort: ReasoningEffort): number {
  return effort === "high" ? 10 : effort === "medium" ? 8 : 5;
}
