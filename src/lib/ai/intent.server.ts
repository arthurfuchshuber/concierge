/**
 * Sinal de intenção — DETERMINÍSTICO desde 19/09/2026.
 *
 * Isto era uma chamada de modelo barato que rotulava a mensagem ANTES do
 * concierge ler a conversa, e o rótulo mandava no resto do pipeline. Foi o que
 * transformou um "Ola, boa tarde" em "pós-estadia" e disparou um pedido de
 * avaliação para quem nem tinha chegado.
 *
 * Quem entende a mensagem agora é o concierge (modelo de raciocínio, com todas
 * as ferramentas). O que sobra aqui é só um sinal barato e previsível para
 * urgência, idioma e para decidir o modo exploração/limiares — nada disso
 * restringe o que o modelo pode fazer, e nenhuma linha aqui chama o gateway.
 */
import { EMPTY_USAGE, type Usage } from "./gateway.server";

export type Intent = {
  intent: string;
  category:
    | "acesso"
    | "residencia"
    | "reserva"
    | "cidade"
    | "recomendacao"
    | "operacional"
    | "financeiro"
    | "social"
    | "outro";
  language: string;
  sentiment: "positivo" | "neutro" | "negativo";
  urgency: "low" | "normal" | "high";
  priority: number;
  needsHuman: boolean;
  searchQuery: string;
};

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const EN = /\b(the|what|where|when|how|please|thanks|hello|hi|check.?in|check.?out|wifi password)\b/;
const ES = /\b(hola|gracias|donde|dónde|cuando|cuándo|qué|habitacion|habitación|llave|por favor)\b/;
const FR = /\b(bonjour|merci|où|quand|comment|s'il vous plaît|chambre)\b/;
const PT = /\b(ola|olá|obrigado|obrigada|onde|quando|como|por favor|quarto|chave|bom dia|boa tarde|boa noite)\b/;

/** Idioma provável da mensagem. Português é o padrão do produto. */
export function detectLanguage(message: string): string {
  const raw = (message ?? "").toLowerCase();
  if (PT.test(raw) || PT.test(norm(raw))) return "pt";
  if (ES.test(raw)) return "es";
  if (FR.test(raw)) return "fr";
  if (EN.test(raw)) return "en";
  return "pt";
}

const ACESSO = /(senha|codigo|chave|fechadura|portao|entrar|acesso|wi.?fi|endereco|como chego)/;
const RESERVA = /(reserva|check.?in|check.?out|entrada|saida|prorrog|estender|antecipar|cancel|quantas noites|horario de)/;
const OPERACIONAL = /(quebr|nao funciona|vazamento|entupi|sem agua|sem luz|sem energia|ar.?condicionado|chuveiro|geladeira|internet caiu|barulho|sujo|limpeza|faltando|problema)/;
const FINANCEIRO = /(pagar|pagamento|valor|preco|quanto custa|cobran|reembols|desconto|taxa|nota fiscal)/;
const RECOMENDACAO = /(recomend|sugest|indica|dica|o que fazer|passeio|restaurante|bar |praia|trilha|roteiro|onde comer|onde ir)/;
const CIDADE = /(cidade|clima|tempo|previsao|evento|feira|show|transporte|uber|taxi|aeroporto|mercado|farmacia|hospital)/;
const RESIDENCIA = /(casa|apartamento|imovel|piscina|churrasqueira|cozinha|maquina|tv|controle|toalha|roupa de cama)/;
const SOCIAL = /^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|obrigad[oa]|valeu|ok|certo|beleza|tchau|ate mais)\b/;
const URGENTE = /(urgente|emergencia|socorro|agora|imediat|vazando|incendio|fogo|assalt|invas|nao consigo entrar|trancad|passando mal|ambulancia|policia)/;
const NEGATIVO = /(reclama|insatisf|absurd|pessim|horrivel|inaceit|decep|revolt|procon|pior|nojent|ruim)/;
const POSITIVO = /(otim|excelent|maravilh|adorei|amei|perfeito|incrivel|obrigad)/;

function categoryOf(text: string): Intent["category"] {
  if (SOCIAL.test(text.trim()) && text.trim().split(/\s+/).length <= 4) return "social";
  if (OPERACIONAL.test(text)) return "operacional";
  if (ACESSO.test(text)) return "acesso";
  if (RESERVA.test(text)) return "reserva";
  if (FINANCEIRO.test(text)) return "financeiro";
  if (RECOMENDACAO.test(text)) return "recomendacao";
  if (CIDADE.test(text)) return "cidade";
  if (RESIDENCIA.test(text)) return "residencia";
  return "outro";
}

/**
 * Não chama modelo. A assinatura continua `async` e devolvendo `usage`/`model`
 * para não quebrar o orquestrador nem a observabilidade.
 */
export async function classifyIntent(
  message: string,
  _history: Array<{ role: string; content: string }> = [],
): Promise<{ intent: Intent; usage: Usage; model: string }> {
  const text = norm(message);
  const category = categoryOf(text);
  const urgent = URGENTE.test(text);
  const negative = NEGATIVO.test(text);

  return {
    intent: {
      intent: category === "social" ? "conversa social" : "pedido do hóspede",
      category,
      language: detectLanguage(message),
      sentiment: negative ? "negativo" : POSITIVO.test(text) ? "positivo" : "neutro",
      urgency: urgent ? "high" : category === "social" ? "low" : "normal",
      priority: urgent ? 5 : negative ? 4 : 3,
      needsHuman: false,
      searchQuery: (message ?? "").slice(0, 300),
    },
    usage: EMPTY_USAGE,
    model: "",
  };
}
