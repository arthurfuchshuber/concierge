/**
 * Economia de contexto: perguntas objetivas e autossuficientes (Wi-Fi,
 * horários, endereço, senha) não precisam do histórico da conversa.
 * Qualquer sinal de continuidade (referência ao que foi dito, mensagem curta
 * ambígua) mantém o histórico completo.
 */
const OBJECTIVE =
  /\b(wi-?fi|wifi|senha|password|rede|endere[cç]o|address|hor[aá]rio|que horas|check-?in|check-?out|estacionamento|garagem|toalha|lixo|ar[- ]condicionado|piscina|regras?)\b/i;
const CONTINUATION =
  /\b(isso|disso|nisso|esse|essa|esses|essas|aquilo|aquele|aquela|tamb[eé]m|ent[aã]o|mas|e se|como assim|sobre o que|combinamos|combinado|voc[eê] disse|falou|anterior|ainda|de novo|novamente|mesmo|outra vez|e para|e pra|e amanh[aã]|e hoje|ok|certo)\b/i;

export function needsHistory(message: string): boolean {
  const text = (message ?? "").trim();
  if (!text) return true;
  if (CONTINUATION.test(text)) return true;
  const words = text.split(/\s+/).length;
  if (OBJECTIVE.test(text) && words >= 3 && words <= 18) return false;
  return true;
}
