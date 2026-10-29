/**
 * Repertório de precedentes — regras puras (testáveis, sem rede).
 *
 * Um precedente é uma CONDUTA que já deu certo numa situação, abstraída de
 * nomes, códigos e valores. A IA consulta precedentes parecidos antes de
 * responder e age por analogia, sem precisar de uma regra escrita para cada
 * jeito de falar. Camadas: global (ConciergeIA) → tenant (a conta) → imóvel.
 * Fatos físicos de um imóvel nunca viram precedente de outro.
 */

export type PrecedentScope = "global" | "tenant" | "property";

export type PrecedentMatch = {
  id: string;
  scope: PrecedentScope;
  propertyId: string | null;
  situation: string;
  conduct: string;
  exampleReply: string | null;
  why: string | null;
  source: string;
  confidence: number;
  successCount: number;
  failureCount: number;
  similarity: number;
};

/** Similaridade mínima para um precedente ser considerado "a mesma situação". */
export const MIN_PRECEDENT_SIMILARITY = 0.62;
/** Similaridade a partir da qual um novo caso reforça o precedente existente. */
export const SAME_PRECEDENT_SIMILARITY = 0.9;

/** Confiança efetiva: reforços sobem, falhas derrubam. */
export function effectiveConfidence(p: Pick<PrecedentMatch, "confidence" | "successCount" | "failureCount">): number {
  const s = Math.max(0, p.successCount);
  const f = Math.max(0, p.failureCount);
  const evidence = (s + 1) / (s + f + 2);
  return Math.min(1, Number((p.confidence * 0.5 + evidence * 0.5).toFixed(4)));
}

export function selectPrecedents(rows: PrecedentMatch[], limit = 3): PrecedentMatch[] {
  return rows
    .filter((r) => r.similarity >= MIN_PRECEDENT_SIMILARITY && effectiveConfidence(r) >= 0.5)
    .sort((a, b) => b.similarity * effectiveConfidence(b) - a.similarity * effectiveConfidence(a))
    .slice(0, limit);
}

const SCOPE_LABEL: Record<PrecedentScope, string> = {
  global: "boa prática global",
  tenant: "jeito desta empresa",
  property: "deste imóvel",
};

export function renderPrecedents(list: PrecedentMatch[]): string {
  if (!list.length) return "";
  const items = list
    .map(
      (p, i) =>
        `[P${i + 1}] (${SCOPE_LABEL[p.scope]}, deu certo ${p.successCount}x)\n` +
        `Situação: ${p.situation}\nConduta que funcionou: ${p.conduct}` +
        (p.why ? `\nPor quê: ${p.why}` : ""),
    )
    .join("\n\n");
  return (
    `\n\nREPERTÓRIO DE PRECEDENTES (casos parecidos que já deram certo — aja por analogia)\n` +
    `- Se a situação atual for a mesma, siga a CONDUTA com suas próprias palavras e com os fatos DESTE imóvel e DESTA reserva (capacidade, horários, regras vêm sempre das fontes oficiais, nunca do precedente).\n` +
    `- Precedente não autoriza preço, desconto, exceção de horário nem liberação de dado sensível; essas continuam com as regras acima.\n` +
    `- Se a situação só parecer igual mas tiver diferença relevante, ignore o precedente.\n\n${items}`
  );
}

/**
 * O turno anterior "deu certo"? Só vira precedente quando a IA respondeu
 * sozinha, a validação aprovou, não houve escalada e o hóspede seguiu a
 * conversa sem reclamar nem repetir a pergunta.
 */
export function previousTurnSucceeded(input: {
  previousEscalated: boolean;
  previousApproved: boolean;
  previousConfidence: number;
  currentSentiment: string | null | undefined;
  currentMessage: string;
}): boolean {
  if (input.previousEscalated || !input.previousApproved) return false;
  if (input.previousConfidence < 0.85) return false;
  if (input.currentSentiment === "negativo") return false;
  const m = input.currentMessage.toLowerCase();
  if (/(não entendi|nao entendi|não foi isso|nao foi isso|errad|não funciona|nao funciona|absurdo|reclama|péssim|pessim)/.test(m)) {
    return false;
  }
  return true;
}

/** Remove códigos, telefones, e-mails e links antes de guardar exemplos. */
export function scrubExample(text: string): string {
  return text
    .replace(/\bHM[A-Z0-9]{6,10}\b/g, "[código]")
    .replace(/https?:\/\/\S+/g, "[link]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-mail]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[número]")
    .slice(0, 600);
}
