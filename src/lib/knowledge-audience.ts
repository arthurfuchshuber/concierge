/**
 * SUGESTÃO AUTOMÁTICA DE PÚBLICO (01/11/2026) ao ensinar algo à IA. Só SUGERE — quem decide é o usuário, que
 * precisa escolher antes de salvar (nada vem pré-selecionado).
 *   G = Reserva Ativa · P = Público (qualquer pessoa) · I = Equipe Interna (equipes e usuários internos)
 */
export type KnowledgeAudience = "G" | "P" | "I";

export const AUDIENCE_NAME: Record<KnowledgeAudience, string> = { G: "Reserva Ativa", P: "Público", I: "Equipe Interna" };

const fold = (t: string) =>
  t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const RULES: Array<{ aud: KnowledgeAudience; reason: string; re: RegExp }> = [
  {
    aud: "I",
    reason: "fala de valores, pagamentos, prestadores ou contatos da equipe",
    re: /\b(uso interno|nao (informar|passar|repassar|contar)|so para (a )?equipe|equipe interna|faxineir|diarista|prestador|comissao|repasse|pagamento (a|da|do)|quanto (pago|paga|custa para)|salario|margem|telefone (pessoal|do (dono|proprietario|sindico|zelador))|whatsapp (do|da) (dono|proprietari|equipe|zelador)|senha (do|da) (sistema|painel|app)|login|painel)/,
  },
  {
    aud: "G",
    reason: "fala de acesso e instruções da estadia (só quem tem reserva ativa deve receber)",
    re: /\b(senha|codigo|wi-?fi|fechadura|portao|cadeado|caixa de chave|chave|como entrar|check-?in|check-?out|endereco exato|numero do apartamento|vaga (numero|n[o°]?)|controle (do|da) (portao|garagem)|interfone|elevador de servico|lixo|coleta|ar-?condicionado|manual (do|da)|como (usar|ligar|funciona))/,
  },
  {
    aud: "P",
    reason: "é informação geral, útil também para quem ainda não reservou",
    re: /\b(aceita|pets?|animais|fumar|festas?|criancas?|capacidade|hospedes|quartos?|camas?|comodidades?|estacionamento|garagem|piscina|academia|localizacao|perto de|proximo|regras? da casa|politica|cancelamento|silencio|restaurantes?|mercado|passeios?|recomendac)/,
  },
];

/** Sugere um público a partir do texto. Sem pista clara, devolve `null` (o usuário escolhe sem sugestão). */
export function suggestAudience(text: string): { audience: KnowledgeAudience; reason: string } | null {
  const t = fold(text ?? "");
  if (t.trim().length < 8) return null;
  for (const r of RULES) if (r.re.test(t)) return { audience: r.aud, reason: r.reason };
  return null;
}
