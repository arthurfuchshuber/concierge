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

const EN = /\b(the|what|where|when|how|please|thanks|thank you|hello|hi|hey|is|are|can|could|we|you|my|our|check.?in|check.?out|wifi|password|door|key|there|with|not|working)\b/;
const ES = /\b(hola|gracias|donde|cuando|habitacion|llave|por favor|buenos dias|buenas tardes|buenas noches|puerta|estamos|esta|esta funcionando|tenemos|quiero|necesito|nuestro|nosotros|usted|el|los|las|una|un|con)\b/;
const FR = /\b(bonjour|bonsoir|merci|ou|quand|comment|s'il vous plait|chambre|clef|nous|vous|est|les|des|une|avec|pour)\b/;
const PT = /\b(ola|olá|obrigado|obrigada|onde|quando|como|por favor|quarto|chave|bom dia|boa tarde|boa noite|consigo|posso|voce|você|nao|não|sim|tem|mesmo|nossa|nosso|antes|depois|horario|horário|dia|verdade|queria|queriamos|gostaria|perto|proximo|próximo|casa|entrar|chegada|saida|saída|almoçar|almocar|aliás|alias|tudo|bem|até|ate|para|pra|uma|um|de|do|da|que|e|é)\b/;

/**
 * Idioma provável da mensagem, por PONTUAÇÃO (17/10/2026). Antes, bastava uma
 * palavra comum ("como", "sim", "dia", "tem") para travar em português, mesmo
 * numa frase inteira em espanhol/inglês. Agora cada idioma soma as palavras
 * que reconhece e vence o maior placar; empate ou nenhum sinal = português.
 */
export function detectLanguage(message: string): string {
  const raw = (message ?? "").toLowerCase();
  const n = norm(raw);
  const count = (re: RegExp) => (n.match(new RegExp(re.source, "g")) ?? []).length;
  const score = { pt: count(PT) + (/[ãõç]/.test(raw) ? 1 : 0), es: count(ES) + (/[ñ¿¡]/.test(raw) ? 2 : 0), fr: count(FR), en: count(EN) };
  let best: "pt" | "es" | "fr" | "en" = "pt";
  for (const k of ["es", "fr", "en"] as const) if (score[k] > score[best]) best = k;
  return best;
}

const ACESSO = /(senha|codigo|chave|fechadura|portao|entrar|acesso|wi.?fi|endereco|como chego)/;
const RESERVA = /(reserva|check.?in|check.?out|entrada|saida|prorrog|estender|antecipar|cancel|quantas noites|horario de)/;
const OPERACIONAL = /(\bquebr\w*|nao funciona|nao esta funcionando|vazamento|entupi\w*|sem agua|sem luz|sem energia|ar.?condicionado|chuveiro|geladeira|internet caiu|barulho|\bsujo|\bsuja|limpeza|faltando|\bproblema\b)/;
const FINANCEIRO = /(\bpagar\b|pagamento|\bvalor\b|\bpreco|quanto custa|cobran\w*|reembols\w*|desconto|\btaxa\b|nota fiscal)/;
const RECOMENDACAO = /(recomend\w*|sugest\w*|\bindica\w*|\bdicas?\b|o que fazer|passeio|restaurante|\bbar\b|praia|trilha|roteiro|onde comer|onde ir)/;
const CIDADE = /\b(cidade|clima|previsao do tempo|evento|feira|show|transporte|uber|taxi|aeroporto|mercado|farmacia|hospital)\b/;
const RESIDENCIA = /\b(casa|apartamento|imovel|piscina|churrasqueira|cozinha|maquina|tv|controle|toalha|roupa de cama)\b/;
const SOCIAL = /^(oi|ola|bom dia|boa tarde|boa noite|tudo bem|obrigad[oa]|valeu|ok|certo|beleza|tchau|ate mais)\b/;
const URGENTE = /\b(urgente|emergencia|socorro|imediat\w*|vazando|incendio|fogo|assalt\w*|invas\w*|nao consigo entrar|trancad[oa]|passando mal|ambulancia|policia)\b/;
const NEGATIVO = /(reclama\w*|insatisf\w*|absurd\w*|pessim\w*|horrivel|inaceit\w*|decep\w*|revolt\w*|procon|\bpior\b|nojent\w*|\bruim\b)/;
const POSITIVO = /(otim|excelent|maravilh|adorei|amei|perfeito|incrivel|obrigad)/;

/** "sem problema(s)", "nenhum problema" não são relato de problema. */
const NO_PROBLEM = /\b(?:sem|nenhum|nao (?:tem|ha|teve|houve)(?: nenhum)?) problemas?\b/g;

function categoryOf(rawText: string): Intent["category"] {
  const text = rawText.replace(NO_PROBLEM, " ");
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
