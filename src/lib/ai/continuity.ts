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
  // Frases curtas e diretas, sem justificativa ("prefiro a resposta certa à
  // rápida" etc.) — esse tipo de fala só cabe se o hóspede cobrar pressa, e aí
  // quem escreve é o modelo, com contexto.
  // 17/10/2026: nenhuma forma promete retorno ("vou confirmar e já te respondo").
  // São só reconhecimentos curtos; quem segue a conversa é a equipe acionada.
  confirming: {
    pt: ["Entendi, anotado por aqui.", "Certo, anotado.", "Combinado, já registrei aqui."],
    en: ["Got it, noted.", "Understood, noted here.", "Okay, I've noted that."],
    es: ["Entendido, anotado.", "Perfecto, lo anoté.", "De acuerdo, queda anotado."],
  },
  pending: {
    pt: ["Anotado por aqui.", "Entendi, registrado.", "Certo, anotei."],
    en: ["Noted here.", "Understood, logged.", "Okay, noted."],
    es: ["Anotado por aquí.", "Entendido, registrado.", "Perfecto, lo anoté."],
  },
  no_answer: {
    pt: ["Entendi.", "Certo, anotado.", "Anotado."],
    en: ["Understood.", "Got it, noted.", "Noted."],
    es: ["Entendido.", "Perfecto, anotado.", "Anotado."],
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
