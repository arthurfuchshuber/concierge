/**
 * AS FRASES DE QUEM NÃO SAI DA CONVERSA (11/09/2026).
 *
 * Regra do produto, dita por você: "vocês não têm a opção de transferir para
 * um humano — têm que conversar com o humano até o fim". Do ponto de vista do
 * hóspede existe UMA pessoa falando com ele, do começo ao fim.
 *
 * O código contradizia isso em três lugares diferentes, cada um com seu texto:
 *
 *  · `HANDOFF_FALLBACK` (prompts.ts) — "Consulte as instruções do guia e a
 *    EQUIPE RESPONSÁVEL seguirá com o atendimento por aqui." É literalmente o
 *    anúncio de transferência que o próprio prompt proíbe na seção IDENTIDADE.
 *  · `pendingNotice` (escalations.server.ts) — "Estou confirmando isso com a
 *    EQUIPE DO ANFITRIÃO". Mesma quebra, em tom mais gentil.
 *  · `handoffFallback` (confidence.ts) — esta estava certa no conteúdo, e
 *    errada no formato: uma frase fixa, repetida a cada ocorrência. Duas
 *    seguidas e o hóspede percebe o script.
 *
 * Aqui as três viram uma coisa só, com duas decisões deliberadas:
 *
 * 1. NINGUÉM É MENCIONADO. Nem equipe, nem anfitrião, nem atendente, nem
 *    transferência. "Vou confirmar" é verdade — há uma consulta interna real
 *    acontecendo — e é tudo que o hóspede precisa saber.
 * 2. VARIAÇÃO DETERMINÍSTICA. Cada tipo tem três formas, escolhidas por uma
 *    semente que vem da conversa (quantas vezes a IA já falou). Duas
 *    ocorrências seguidas nunca saem iguais, e a mesma conversa reproduz o
 *    mesmo texto se for reprocessada — nada de aleatoriedade, que quebraria
 *    teste e auditoria.
 */

export type ContinuityKind =
  /** Havia uma resposta, mas ela não passou na checagem: dizer pouco e verdadeiro. */
  | "confirming"
  /** A IA perguntou a um humano e está esperando a decisão. */
  | "pending"
  /** Escalou sem conseguir produzir nada aproveitável. */
  | "no_answer";

type Trio = [string, string, string];
type ByLanguage = { pt: Trio; en: Trio; es: Trio };

const LINES: Record<ContinuityKind, ByLanguage> = {
  confirming: {
    pt: [
      "Vou confirmar isso direitinho e já te respondo.",
      "Prefiro checar esse ponto antes de te dar um número errado — volto aqui rapidinho.",
      "Deixa eu confirmar esse detalhe para não te passar nada furado. Já te falo.",
    ],
    en: [
      "Let me confirm this properly and come right back to you.",
      "I'd rather double-check this before giving you the wrong detail — back in a moment.",
      "Let me make sure of this one so I don't tell you something inaccurate. One moment.",
    ],
    es: [
      "Voy a confirmarlo bien y te respondo enseguida.",
      "Prefiero verificar ese punto antes de darte un dato equivocado — vuelvo en un momento.",
      "Déjame confirmar ese detalle para no pasarte nada incorrecto. Ya te aviso.",
    ],
  },
  pending: {
    pt: [
      "Estou confirmando esse ponto para te passar a informação certa — já te retorno aqui mesmo.",
      "Esse caso eu preciso confirmar antes de responder. Assim que tiver a resposta, te falo por aqui.",
      "Já estou checando isso. Volto aqui com a resposta certa, não precisa perguntar de novo.",
    ],
    en: [
      "I'm confirming this so I can give you the right answer — I'll come back to you right here.",
      "This one I need to confirm before answering. As soon as I have it, I'll tell you here.",
      "I'm checking this now. I'll come back with the right answer — no need to ask again.",
    ],
    es: [
      "Estoy confirmando este punto para darte la información correcta — te respondo aquí mismo.",
      "Este caso necesito confirmarlo antes de responder. En cuanto lo tenga, te aviso por aquí.",
      "Ya lo estoy verificando. Vuelvo con la respuesta correcta, no hace falta preguntar de nuevo.",
    ],
  },
  no_answer: {
    pt: [
      "Não quero te responder isso por cima. Vou confirmar e te falo aqui mesmo.",
      "Esse ponto eu não consigo confirmar agora sem risco de errar — estou verificando e volto para você.",
      "Prefiro te dar a resposta certa a te dar uma resposta rápida. Estou checando e já te retorno.",
    ],
    en: [
      "I don't want to answer this off the top of my head. Let me confirm and tell you right here.",
      "I can't confirm this one right now without risking a mistake — I'm checking and I'll come back to you.",
      "I'd rather give you the right answer than a fast one. Checking now, back shortly.",
    ],
    es: [
      "No quiero responderte esto a la ligera. Voy a confirmarlo y te cuento aquí mismo.",
      "Ese punto no puedo confirmarlo ahora sin riesgo de equivocarme — lo estoy verificando y vuelvo.",
      "Prefiero darte la respuesta correcta antes que una rápida. Lo estoy revisando y ya te aviso.",
    ],
  },
};

function trioFor(kind: ContinuityKind, language: string | null | undefined): Trio {
  const set = LINES[kind];
  if (language?.startsWith("en")) return set.en;
  if (language?.startsWith("es")) return set.es;
  return set.pt;
}

/**
 * A frase de continuidade.
 *
 * `seed` deve ser algo que MUDA a cada ocorrência dentro da mesma conversa —
 * o número de mensagens até aqui serve bem. Sem semente, sai sempre a
 * primeira forma, que é a mais curta.
 */
export function continuityLine(
  kind: ContinuityKind,
  language: string | null | undefined,
  seed = 0,
): string {
  const trio = trioFor(kind, language);
  const i = Math.abs(Math.trunc(seed)) % trio.length;
  return trio[i];
}

/**
 * Todas as formas de um tipo — usado pelos testes e por quem precisa checar se
 * um texto JÁ é uma frase de continuidade (para não empilhar duas).
 */
export function continuityVariants(kind: ContinuityKind, language?: string): string[] {
  if (language) return [...trioFor(kind, language)];
  const set = LINES[kind];
  return [...set.pt, ...set.en, ...set.es];
}

/** O texto enviado já é uma dessas frases? Evita duplicar a mesma ideia. */
export function isContinuityLine(text: string): boolean {
  const alvo = text.trim();
  if (!alvo) return false;
  return (Object.keys(LINES) as ContinuityKind[]).some((k) =>
    continuityVariants(k).some((v) => alvo === v || alvo.endsWith(v)),
  );
}
