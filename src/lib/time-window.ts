/**
 * Lógica de janela de horário (check-in/check-out) usada pelo seletor de
 * horário do HÓSPEDE no guia (novo, 24/09/2026 — mockup "Previsão — seletor
 * de horário do hóspede").
 *
 * Espelha, de propósito, o mesmo algoritmo já usado no editor de previsão do
 * painel (`PredictedEditor` em `OperationWorkspace.tsx`: `allowedWindowPhrase`
 * / `isTimeWithin`) — inclusive o tratamento de janela que "vira a noite"
 * (ex.: checkout liberado às 23:00 da véspera, limite às 15:00). Vive num
 * arquivo à parte (em vez de importar direto do componente do painel) para
 * não acoplar uma tela pública ao arquivo do dashboard — mas qualquer ajuste
 * na regra de janela feito ali precisa ser espelhado aqui também.
 */

export function timeToMinutes(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * A janela permitida do imóvel, em frase ("entre 15:00 e 23:00"). A ordem dos
 * campos é invertida no checkout de propósito — é assim que o cadastro do
 * imóvel guarda: `standardTime` é o horário LIMITE de saída e
 * `standardTimeMax` o de abertura.
 */
export function allowedWindowPhrase(
  kind: "checkin" | "checkout",
  standardTime: string | null,
  standardTimeMax: string | null,
): string | null {
  const min = kind === "checkout" ? standardTimeMax : standardTime;
  const max = kind === "checkout" ? standardTime : standardTimeMax;
  if (min && max) return `entre ${min} e ${max}`;
  if (min) return `a partir das ${min}`;
  if (max) return `até as ${max}`;
  return null;
}

/**
 * `t` está dentro de [min, max], com 30 min de folga em cada ponta e
 * tratamento de janela que vira a noite: quando `min` > `max` em minutos
 * desde a meia-noite, o intervalo válido é a UNIÃO das duas pontas do
 * relógio, não a interseção.
 */
export function isTimeWithin(t: string, min: string, max: string | null): boolean {
  const v = timeToMinutes(t);
  if (v === null) return false;
  const a = (timeToMinutes(min) ?? 0) - 30;
  const b = (max ? (timeToMinutes(max) ?? 0) : (timeToMinutes(min) ?? 0) + 60) + 30;
  return a > b ? v >= a || v <= b : v >= a && v <= b;
}

/** As 24 horas cheias do dia — grade usada no seletor de horário do hóspede. */
export const HOUR_SLOTS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`);

/**
 * Cada horário cheio do dia, marcado com se cai dentro da janela permitida
 * do imóvel para este lado da estadia — os de fora ficam visíveis, só
 * desabilitados (mockup aprovado: "os fora da janela ficam apagados, mas
 * continuam visíveis" — nunca somem da grade).
 */
export function buildHourGrid(
  kind: "checkin" | "checkout",
  standardTime: string | null,
  standardTimeMax: string | null,
): Array<{ time: string; enabled: boolean }> {
  const min = kind === "checkout" ? standardTimeMax : standardTime;
  const max = kind === "checkout" ? standardTime : standardTimeMax;
  return HOUR_SLOTS.map((time) => ({
    time,
    enabled: min ? isTimeWithin(time, min, max) : true,
  }));
}
