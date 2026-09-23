/**
 * AS CORES DAS INFORMAÇÕES DE UM CARD — um lugar só, para todos os cards.
 *
 * Pedido explícito (08/09/2026): "a cor das informações precisa ser replicada
 * em TODOS os demais cards... exemplo: proprietário no pink, período nas cores
 * dos status".
 *
 * O padrão nasceu no card do Kanban e é este:
 *
 *   · PROPRIETÁRIO — rosa da marca (`--accent`). É a única linha colorida por
 *     IDENTIDADE, não por estado: serve para achar o card do proprietário
 *     certo passando o olho por uma coluna inteira.
 *   · IMÓVEL — cor de texto cheia, com a tipografia de título do card. É o
 *     nome que a pessoa lê primeiro.
 *   · PERÍODO / DATAS — cor de ESTADO (ver `periodColorClass`): vermelho para
 *     atrasado, laranja para saída, verde para estadia em curso, azul para
 *     chegada pendente. É a cor que substituiu as antigas etiquetas
 *     "Atrasado"/"Data futura".
 *   · HÓSPEDE, CÓDIGO E DEMAIS APOIOS — cinza. Informação de contexto não
 *     compete com as três acima.
 *
 * Por que constantes e não classes escritas em cada tela: o padrão já existia
 * de fato no Kanban, mas só lá — nos outros cards cada linha tinha ganhado uma
 * cor por conta própria. Com o padrão vindo daqui, um card novo herda o
 * significado das cores em vez de reinventá-lo, e mudar o padrão é mudar UM
 * arquivo.
 */

/** Proprietário — rosa da marca. */
export const CARD_OWNER = "text-accent font-bold";

/** Nome do imóvel — tipografia de título do card, cor de texto cheia. */
export const CARD_PROPERTY = "ds-card-title";

/** Hóspede e demais linhas de apoio. */
export const CARD_MUTED = "text-muted-foreground";

/** Hóspede ainda não identificado (reserva sem formulário preenchido). */
export const CARD_PENDING_GUEST = "text-orange-500 font-medium";

/**
 * Cor do PERÍODO/data conforme o estado da estadia.
 *
 * `overdue` vence tudo: uma data que já passou sem a ação feita é o único
 * estado que precisa gritar. Depois disso, a cor diz em que ponto da esteira
 * o card está.
 */
/**
 * A BARRA LATERAL DE ETAPA — 3px na borda esquerda do card.
 *
 * Pedido explícito (08/09/2026, layout novo dos cards): a etapa sai do texto e
 * vira cor, sempre na mesma posição. É a única coisa do card que se lê sem
 * ler — passando o olho por uma coluna inteira dá para ver onde cada reserva
 * está sem parar em nenhuma.
 *
 * Atraso sobrepõe a etapa: uma data vencida sem a ação feita é o único estado
 * que precisa gritar mais alto que "em que fase estou".
 */
export type CardStage = "checkin" | "stay" | "checkout" | "cleaning" | "done" | "no_show" | "late";

const STAGE_BAR: Record<CardStage, string> = {
  checkin: "bg-sky-400",
  stay: "bg-emerald-400",
  checkout: "bg-orange-400",
  cleaning: "bg-amber-400",
  done: "bg-muted-foreground/40",
  no_show: "bg-muted-foreground/40",
  late: "bg-red-500",
};

export function stageBarClass(stage: CardStage): string {
  return STAGE_BAR[stage];
}

export function periodColorClass(state: {
  /** Data no passado e a ação ainda pendente. */
  overdue?: boolean;
  /** Lado da esteira: chegada ou saída. */
  kind?: "checkin" | "checkout";
  /** Etapa já concluída (check-in feito = estadia em curso). */
  done?: boolean;
}): string {
  if (state.overdue) return "text-red-800 dark:text-red-400";
  if (state.kind === "checkout") return "text-orange-600 dark:text-orange-400";
  if (state.done) return "text-emerald-700 dark:text-emerald-300";
  return "text-sky-700 dark:text-sky-300";
}
