/**
 * Quais cartões pendentes da equipe podem calar a IA com o hóspede.
 *
 * Caso Rafael (29/10/2026): um cartão de "salvar regra do imóvel" de 9 dias
 * antes silenciou o agradecimento de check-out. Regra: só uma decisão
 * operacional RECENTE cala a IA; aprendizado/conhecimento nunca.
 */
export const SILENCE_WINDOW_MS = 2 * 60 * 60 * 1000;

export type PendingCard = {
  reason?: string | null;
  created_at: string;
  context_snapshot?: Record<string, unknown> | null;
};

export function isKnowledgeCard(card: PendingCard): boolean {
  const snap = card.context_snapshot ?? {};
  const decision = (snap.decision ?? null) as { kind?: string } | null;
  return Boolean(snap.host_learning) || decision?.kind === "fact";
}

/** O cartão ainda deve impedir a IA de responder ao hóspede agora? */
export function cardSilencesAi(card: PendingCard, now = Date.now()): boolean {
  if (isKnowledgeCard(card)) return false;
  const at = new Date(card.created_at).getTime();
  if (Number.isNaN(at)) return false;
  return now - at < SILENCE_WINDOW_MS;
}
