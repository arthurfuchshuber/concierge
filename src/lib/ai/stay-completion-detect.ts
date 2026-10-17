/**
 * Rede de segurança determinística: detecta quando o hóspede confirmou que
 * ENTROU (check-in) ou SAIU (check-out) do imóvel, para dar baixa no painel
 * mesmo se o modelo esquecer de chamar `register_guest_stay_event`.
 * Conservador de propósito: planos ("vamos sair amanhã") e chegada sem entrar
 * ("chegamos", "estamos aqui") nunca disparam.
 */
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const CHECKOUT_DONE =
  /\b(ja\s+(sai|saimos|deixamos|entregamos|fizemos\s+o\s+check-?out|fiz\s+o\s+check-?out)|fizemos\s+o\s+check-?out|fiz\s+o\s+check-?out|check-?out\s+(feito|realizado|concluido)|deixe[ia]\s+(a|as)\s+chaves?\s+(no|na|em)|chaves?\s+(deixadas?|devolvidas?)\s+(no|na)|acabamos\s+de\s+sair|saimos\s+(agora|ja|do\s+(apto|apartamento|imovel|studio)))/;
const CHECKOUT_PLAN = /\b(vamos|vou|iremos|vamos\s+sair|amanha|que\s+horas|posso|podemos|pretendo)\b/;
const CHECKIN_DONE =
  /\b(entramos|entrei|ja\s+estamos\s+dentro|estamos\s+dentro|estou\s+dentro|ja\s+estou\s+no\s+(apto|apartamento|imovel|studio)|estamos\s+no\s+(apto|apartamento|imovel|studio)|conseguimos\s+entrar|consegui\s+entrar|acessei\s+o\s+(apto|apartamento|imovel|studio))\b/;
const NEGATION = /\b(nao|ainda\s+nao|sem\s+conseguir)\b/;

export function detectStayCompletion(
  guestMessage: string,
  aiReply: string,
): "checkin" | "checkout" | null {
  const m = norm(guestMessage);
  const r = norm(aiReply);
  if (CHECKOUT_DONE.test(m) && !CHECKOUT_PLAN.test(m.replace(CHECKOUT_DONE, "")) && !NEGATION.test(m)) return "checkout";
  // Check-in: o hóspede disse que está dentro OU a IA já deu o encerramento
  // oficial de entrada (só enviado quando a entrada foi concluída).
  if (!NEGATION.test(m) && (CHECKIN_DONE.test(m) || r.includes("excelente estadia"))) return "checkin";
  return null;
}
