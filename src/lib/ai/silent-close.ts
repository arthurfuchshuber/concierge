/**
 * ENCERRAMENTO POR SILÊNCIO (pedido explícito, 16/10/2026).
 *
 * Hóspede confirma que um passo da entrada (ou da saída) deu certo, a IA
 * responde com o próximo passo e ele some. Passados 10 min sem nova fala, a
 * IA fecha com a mensagem calorosa e dá a baixa no painel.
 */
export const SILENT_CLOSE_AFTER_MS = 10 * 60 * 1000;

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const NEG = /\b(nao|nem|ainda nao|sem sucesso|nada)\b/;
const PLAN = /\b(amanha|mais tarde|depois|vou sair|vamos sair|vou fazer|pretendo)\b/;

/** O hóspede disse que um passo da ENTRADA funcionou? */
export function isEntryProgress(msg: string): boolean {
  const t = norm(msg);
  if (!t || NEG.test(t)) return false;
  return /\b(deu certo|funcionou|consegui|conseguimos|abriu|abri|abrimos|peguei|pegamos|achei|encontrei|entrei|entramos|acessei|estou dentro|estamos dentro)\b/.test(t);
}

/** O hóspede disse que está saindo / saiu / deixou a chave? */
export function isCheckoutProgress(msg: string): boolean {
  const t = norm(msg);
  if (!t || NEG.test(t) || PLAN.test(t)) return false;
  return /\b(ja sai|ja saimos|saimos|estamos saindo|estou saindo|deixei a chave|deixamos a chave|fiz o checkout|fizemos o checkout|check ?out feito|chave no cofre|fechei a porta|trancamos|tranquei)\b/.test(t);
}

/** Primeiro nome limpo para a saudação. */
export function firstName(name: string | null | undefined): string {
  const f = String(name ?? "").trim().split(/\s+/)[0] ?? "";
  return f ? f.charAt(0).toUpperCase() + f.slice(1).toLowerCase() : "";
}

export function silentCloseText(kind: "checkin" | "checkout", name: string | null | undefined): string {
  const n = firstName(name);
  const hi = n ? `${n}, ` : "";
  if (kind === "checkin") {
    return `${hi}como você não enviou novas mensagens, entendemos que deu tudo certo com a sua entrada. Nos confirme se encontrou o imóvel conforme o esperado. Caso haja alguma observação, avise-nos o quanto antes para que possamos auxiliar. Excelente estadia! 💜`;
  }
  return `${hi}como você não enviou novas mensagens, entendemos que deu tudo certo com o seu check-out. Muito obrigado pela estadia, foi um prazer receber você! Boa viagem e até a próxima! 💜`;
}
