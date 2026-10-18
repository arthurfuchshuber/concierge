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

