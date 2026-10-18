import type { ArrivalRow } from "@/lib/dashboard.functions";

/**
 * HORÁRIO DE ORDENAÇÃO DE UM CARD (regra do anfitrião, 17/10/2026).
 *
 * Um só relógio para ordenar qualquer lista de chegadas/saídas:
 *  1) o horário PREVISTO informado (pela equipe, pelo hóspede ou pela IA);
 *  2) se não há previsão: o horário LIMITE do imóvel — o do check-out para
 *     saídas, o de início (a partir de) para chegadas.
 *
 * O limite entra SÓ na ordenação: nunca é gravado no campo de previsão nem
 * aparece como "previsto" no card (pedido explícito: "SEM COLOCAR nos campos
 * de previsão").
 *
 * Por que antes quebrava: para SAÍDAS a função usava `guestArrivalTime` como
 * se fosse previsão — é a hora em que o hóspede CHEGA, não a hora em que ele
 * sai —, e o horário padrão do imóvel nunca entrava. Resultado: checkout sem
 * previsão era ordenado pela hora de chegada da estadia e vinha fora de ordem.
 */
function forecastTimeOf(r: ArrivalRow, kind: "checkin" | "checkout"): string | null {
  if (r.arrivalTimeOverride) return r.arrivalTimeOverride;
  // O horário informado pelo hóspede no formulário é de CHEGADA: só vale para chegadas.
  return kind === "checkin" ? (r.guestArrivalTime ?? null) : null;
}
function limitTimeOf(r: ArrivalRow, kind: "checkin" | "checkout"): string | null {
  return (kind === "checkin" ? r.propertyCheckinTime : r.propertyCheckoutTime) ?? r.standardTime ?? null;
}
/** "HH:MM" normalizado (ex.: "9:30" → "09:30") para comparar como texto. */
function normTime(t: string | null | undefined): string | null {
  const m = (t ?? "").match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}
export function sortingTimeOf(r: ArrivalRow, kind: "checkin" | "checkout"): string | null {
  return normTime(forecastTimeOf(r, kind)) ?? normTime(limitTimeOf(r, kind));
}


/**
 * ATRASADO + DIA (mesma regra para TODAS as listas de chegada/saída).
 * Atrasado = ainda não concluído com a data já passada: fica no topo, o mais
 * antigo primeiro (quanto mais tempo esperando, mais em cima). Depois vem o
 * dia, do mais próximo para o mais distante. Só então entra o horário.
 * Sem isto, uma lista que cobre vários dias misturava "ontem" e "hoje" só pela
 * hora do relógio.
 */
export function isLateRow(r: Pick<ArrivalRow, "status" | "date">, today: string): boolean {
  return r.status !== "done" && r.date < today;
}
export function compareLateThenDay(a: Pick<ArrivalRow, "status" | "date">, b: Pick<ArrivalRow, "status" | "date">, today: string): number {
  const la = isLateRow(a, today);
  const lb = isLateRow(b, today);
  if (la !== lb) return la ? -1 : 1;
  return a.date.localeCompare(b.date);
}

/** Compara dois horários "HH:MM": o mais cedo primeiro; sem horário vai por último. */
export function compareTimesNullLast(ta: string | null, tb: string | null): number {
  if (ta === tb) return 0;
  if (!ta) return 1;
  if (!tb) return -1;
  return ta.localeCompare(tb);
}

/**
 * Ordem base do SERVIDOR (o painel reordena as listas pendentes com a regra
 * completa, que ainda inclui giro e proximidade). Grupos: atrasado → pendente →
 * concluído. Atrasado e pendente: dia e horário do mais cedo para o mais tarde.
 * Concluído: o mais recente primeiro. Empate: nome do imóvel A→Z.
 */
export function compareArrivalRowsServer(a: ArrivalRow, b: ArrivalRow, kind: "checkin" | "checkout", today: string): number {
  const rank = (r: ArrivalRow) => (isLateRow(r, today) ? 0 : r.status === "done" ? 2 : 1);
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 2) {
    const d = b.date.localeCompare(a.date);
    if (d !== 0) return d;
    const t = compareTimesNullLast(sortingTimeOf(b, kind), sortingTimeOf(a, kind));
    if (t !== 0) return t;
  } else {
    const d = a.date.localeCompare(b.date);
    if (d !== 0) return d;
    const t = compareTimesNullLast(sortingTimeOf(a, kind), sortingTimeOf(b, kind));
    if (t !== 0) return t;
  }
  return (a.propertyName ?? "").localeCompare(b.propertyName ?? "", "pt-BR");
}
