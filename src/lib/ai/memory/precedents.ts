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

/** Camada situacional: fase da estadia em que a conduta vale ("" / vazio = qualquer). */
export type StayPhase = "no_booking" | "pre_checkin" | "checkin_day" | "in_stay" | "checkout_day" | "post_checkout";
export const STAY_PHASES: StayPhase[] = ["no_booking", "pre_checkin", "checkin_day", "in_stay", "checkout_day", "post_checkout"];

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
  /** Assunto canônico (slug); precedentes do mesmo assunto competem e só o vigente vale. */
  topic?: string | null;
  /** Fases da estadia em que vale; vazio = todas. */
  phases?: string[];
  /** Última atualização (ISO): desempate por recência. */
  updatedAt?: string | null;
};

/** Similaridade mínima para um precedente ser considerado "a mesma situação". */
export const MIN_PRECEDENT_SIMILARITY = 0.58;
/** Similaridade a partir da qual um novo caso reforça o precedente existente. */
export const SAME_PRECEDENT_SIMILARITY = 0.9;
/** Acima disso, dois precedentes sem assunto explícito são tratados como o mesmo assunto. */
export const SAME_TOPIC_SIMILARITY = 0.8;

const SCOPE_RANK: Record<PrecedentScope, number> = { property: 3, tenant: 2, global: 1 };

/** Normaliza o assunto para comparação (slug minúsculo, sem acento). */
export function normalizeTopic(topic: string | null | undefined): string | null {
  if (!topic) return null;
  const s = topic
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return s || null;
}

export function normalizePhases(list: unknown): StayPhase[] {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(String).filter((p): p is StayPhase => (STAY_PHASES as string[]).includes(p)))];
}

/** Camada situacional: o precedente vale na fase atual? Fase desconhecida só aceita precedente sem fase. */
export function phaseMatches(p: Pick<PrecedentMatch, "phases">, current: StayPhase | null): boolean {
  const phases = p.phases ?? [];
  if (!phases.length) return true;
  return current ? phases.includes(current) : false;
}

/** Confiança efetiva: reforços sobem, falhas derrubam. */
export function effectiveConfidence(p: Pick<PrecedentMatch, "confidence" | "successCount" | "failureCount">): number {
  const s = Math.max(0, p.successCount);
  const f = Math.max(0, p.failureCount);
  const evidence = (s + 1) / (s + f + 2);
  return Math.min(1, Number((p.confidence * 0.5 + evidence * 0.5).toFixed(4)));
}

function ts(p: PrecedentMatch): number {
  const t = p.updatedAt ? Date.parse(p.updatedAt) : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** Vence o mais específico (imóvel > conta > global); na mesma camada, o mais recente. */
function wins(a: PrecedentMatch, b: PrecedentMatch): boolean {
  const ra = SCOPE_RANK[a.scope] ?? 0;
  const rb = SCOPE_RANK[b.scope] ?? 0;
  if (ra !== rb) return ra > rb;
  return ts(a) >= ts(b);
}

/**
 * Seleciona precedentes para o prompt. Filtra por parecença, confiança e fase
 * da estadia; depois deixa UM só por assunto (mais específico, depois mais
 * recente), para a IA nunca receber duas condutas concorrentes.
 */
export function selectPrecedents(rows: PrecedentMatch[], limit = 3, currentPhase: StayPhase | null = null): PrecedentMatch[] {
  const eligible = rows.filter(
    (r) => r.similarity >= MIN_PRECEDENT_SIMILARITY && effectiveConfidence(r) >= 0.5 && phaseMatches(r, currentPhase),
  );
  const winners: PrecedentMatch[] = [];
  for (const r of eligible) {
    const key = normalizeTopic(r.topic);
    const idx = winners.findIndex((w) => {
      const wk = normalizeTopic(w.topic);
      if (key && wk) return key === wk;
      // Sem assunto explícito: mesma situação se ambos casam quase igual com a mensagem.
      return Math.abs(w.similarity - r.similarity) < 0.03 && Math.min(w.similarity, r.similarity) >= SAME_TOPIC_SIMILARITY;
    });
    if (idx < 0) winners.push(r);
    else if (wins(r, winners[idx])) winners[idx] = r;
  }
  return winners
    .sort((a, b) => b.similarity * effectiveConfidence(b) - a.similarity * effectiveConfidence(a))
    .slice(0, limit);
}

/** Um novo caso do mesmo assunto e camada substitui o vigente quando a conduta mudou. */
export function shouldSupersede(input: { sameTopic: boolean; sameLayer: boolean; similarity: number }): boolean {
  return input.sameTopic && input.sameLayer && input.similarity < SAME_PRECEDENT_SIMILARITY;
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
