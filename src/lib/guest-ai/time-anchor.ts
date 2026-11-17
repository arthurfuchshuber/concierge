/**
 * Âncora de tempo do turno (17/11/2026, titular: "o tempo precisa ser visto em toda e qualquer situação").
 * O modelo só via instantes em UTC (mensagens, check-in); agora recebe o "agora" no fuso do imóvel e quantos dias
 * faltam para a entrada (ou passaram da saída) da reserva ou do período consultado, para acertar o tempo verbal.
 * Puro: o instante chega por parâmetro.
 */
import { localDate } from "@/lib/guest-ai/calendar-occupancy";

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"] as const;

export interface TimeAnchor {
  localDate: string;
  localTime: string;
  weekday: string;
}

export function timeAnchor(nowIso: string, timeZone: string | null): TimeAnchor | null {
  const date = localDate(nowIso, timeZone);
  if (!date || !timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(nowIso));
    const h = parts.find((p) => p.type === "hour")?.value;
    const m = parts.find((p) => p.type === "minute")?.value;
    if (!h || !m) return null;
    const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]!;
    return { localDate: date, localTime: `${h}:${m}`, weekday };
  } catch {
    return null;
  }
}

/** Dias entre duas datas locais (AAAA-MM-DD); `null` se alguma for inválida. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86_400_000) : null;
}

/**
 * Fato `ctx:agora`: data, hora e dia da semana no fuso do imóvel e a distância até a entrada/saída da reserva (ou do
 * período consultado). `dias_ate_entrada` > 0 = ainda vai chegar; `dias_desde_saida` > 0 = estadia encerrada.
 */
export function timeAnchorFact(
  anchor: TimeAnchor,
  p: { timeZone: string | null; checkInAt?: string | null; checkOutAt?: string | null; inquiryCheckin?: string | null; inquiryCheckout?: string | null },
): Record<string, unknown> {
  const entrada = p.checkInAt ? localDate(p.checkInAt, p.timeZone) : (p.inquiryCheckin ?? null);
  const saida = p.checkOutAt ? localDate(p.checkOutAt, p.timeZone) : (p.inquiryCheckout ?? null);
  const ateEntrada = daysBetween(anchor.localDate, entrada);
  const desdeSaida = daysBetween(saida, anchor.localDate);
  return {
    data_local: anchor.localDate,
    hora_local: anchor.localTime,
    dia_da_semana: anchor.weekday,
    ...(entrada ? { data_de_entrada: entrada, dias_ate_entrada: ateEntrada } : {}),
    ...(saida ? { data_de_saida: saida, dias_desde_saida: desdeSaida } : {}),
  };
}
