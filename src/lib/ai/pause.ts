/**
 * A PAUSA DA IA — uma regra só, um lugar só (11/09/2026).
 *
 * Antes disto, "pausar" era escrever `ai_paused: true` em seis lugares
 * diferentes (assumir, transferir, reabrir, mandar mensagem, anexar arquivo,
 * enviar WhatsApp) e "despausar" era outra pessoa lembrar de clicar. Nenhum
 * deles tinha prazo. O resultado está no banco: conversa pausada desde 10/09
 * porque alguém clicou em "Assumir" e a vida seguiu. E como conversa pausada
 * nunca volta para a IA — nem quando o hóspede escreve de novo — o hóspede
 * seguinte fala com o silêncio.
 *
 * A regra, decidida com o produto:
 *
 *  · falar DIRETO com o hóspede pausa a IA por 30 minutos;
 *  · cada nova mensagem do atendente renova os 30 minutos, então uma conversa
 *    longa nunca é interrompida no meio;
 *  · passou o prazo, a IA volta sozinha — sem cron, sem ninguém clicar;
 *  · "Devolver agora" continua valendo a qualquer momento;
 *  · ASSUMIR a conversa não pausa nada. Assumir é dizer "esse caso é meu";
 *    silenciar a IA é outra decisão, e só acontece quando você de fato fala.
 *
 * A expiração é PREGUIÇOSA: lida no momento em que a conversa é usada. Não há
 * janela em que o banco diga "pausada" e o código pense o contrário, e não há
 * um relógio novo para alguém esquecer de agendar — erro que este projeto já
 * cometeu três vezes.
 */

/** Quanto tempo a IA fica em silêncio depois de uma fala direta do atendente. */
export const PAUSE_MINUTES = 30;

/** O carimbo de validade da pausa, a partir de agora. */
export function pausedUntilFromNow(minutes = PAUSE_MINUTES): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** O patch que pausa (ou renova a pausa) — use sempre este, nunca `ai_paused` solto. */
export function pausePatch(minutes = PAUSE_MINUTES): {
  ai_paused: true;
  paused_until: string;
} {
  return { ai_paused: true, paused_until: pausedUntilFromNow(minutes) };
}

/** O patch que devolve a conversa à IA. */
export function resumePatch(): { ai_paused: false; paused_until: null } {
  return { ai_paused: false, paused_until: null };
}

type ConvPause = { ai_paused?: boolean | null; paused_until?: string | null };

/**
 * A IA está calada AGORA?
 *
 * `paused_until` nulo com `ai_paused` verdadeiro é pausa sem prazo — o estado
 * das conversas anteriores a esta mudança, preservado de propósito para não
 * devolver de uma vez só conversas que alguém possa estar conduzindo.
 */
export function isPausedNow(conv: ConvPause | null | undefined, now = Date.now()): boolean {
  if (!conv?.ai_paused) return false;
  const ate = conv.paused_until ? new Date(conv.paused_until).getTime() : null;
  if (ate === null || Number.isNaN(ate)) return true;
  return ate > now;
}

/** Minutos que faltam para a IA voltar. `null` quando não há prazo. */
export function minutesLeft(conv: ConvPause | null | undefined, now = Date.now()): number | null {
  if (!conv?.ai_paused || !conv.paused_until) return null;
  const ate = new Date(conv.paused_until).getTime();
  if (Number.isNaN(ate)) return null;
  return Math.max(0, Math.ceil((ate - now) / 60_000));
}

/**
 * Lê o estado de pausa e, se tiver expirado, LIMPA no banco antes de seguir.
 *
 * É o único ponto que os caminhos de mensagem precisam chamar. Devolve `true`
 * quando a IA deve continuar calada.
 */
export async function resolvePause(
  // `unknown` de propósito: este helper é chamado com o client de serviço e
  // com o client do usuário, cujos tipos gerados são grandes o bastante para
  // estourar a inferência do TypeScript quando descritos estruturalmente.
  supabase: unknown,
  conversationId: string,
  conv: ConvPause | null | undefined,
): Promise<boolean> {
  if (!conv?.ai_paused) return false;
  if (isPausedNow(conv)) return true;

  // Expirou: devolve a conversa à IA agora, para que o próximo leitor —
  // inclusive a voz ativa — já a veja livre.
  const client = supabase as {
    from: (t: string) => {
      update: (p: Record<string, unknown>) => {
        eq: (c: string, v: string) => PromiseLike<unknown>;
      };
    };
  };
  try {
    await client.from("property_chat_conversations").update(resumePatch()).eq("id", conversationId);
  } catch {
    /* a expiração não pode derrubar o atendimento; na pior hipótese, o próximo
       leitor tenta de novo. */
  }
  return false;
}
