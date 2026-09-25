import * as React from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarIcon, Loader2 } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { allowedWindowPhrase, buildHourGrid } from "@/lib/time-window";
import { submitPredictedTime } from "@/lib/guide-access.functions";

/**
 * SELETOR DE HORÁRIO PREVISTO DO HÓSPEDE (pedido explícito, 24/09/2026,
 * mockup aprovado "Previsão — seletor de horário do hóspede", 4 rodadas de
 * ajuste: pré-selecionado é o dia da própria reserva (nunca "hoje"), nenhum
 * horário vem pré-marcado, a frase "Permitido entre X e Y" fica centralizada
 * logo abaixo da grade).
 *
 * Data e horário na MESMA tela (pedido explícito: "ambos devem estar na
 * mesma tela para que o hóspede não fique tendo que navegar entre telas").
 *
 * Grava direto em `guest_arrival_status` via `submitPredictedTime` — a MESMA
 * tabela que o editor de previsão do painel usa, então o card da reserva
 * reflete o que o hóspede escolher aqui sem nenhuma sincronização extra
 * (pedido explícito: "a data/horário inserido pelo hóspede deverá ser
 * automaticamente inserida nos mesmos campos de previsão no card").
 *
 * A grade mostra as 24 horas do dia (não só uma janela de ~12h como no
 * mockup) para funcionar corretamente com QUALQUER configuração de horário
 * do imóvel, sem depender de uma janela "de exemplo" fixa — os horários fora
 * da janela permitida do imóvel continuam visíveis, só ficam desabilitados
 * (mesmo tratamento visual do mockup).
 */

function parseISODateLocal(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function dateToISOLocal(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

function fmtDiaMes(iso: string): string {
  return format(parseISODateLocal(iso), "dd/MM");
}

export type PredictedTimeCardProps = {
  kind: "checkin" | "checkout";
  slug: string;
  guestName: string;
  reservationCode?: string | null;
  /** Data confirmada da reserva para este lado (chegada ou saída). */
  confirmedDate: string;
  /** A OUTRA data confirmada da estadia (chegada quando kind=checkout, e
   * vice-versa) — só para validar limites, nunca aparece na tela deste lado. */
  otherConfirmedDate?: string | null;
  standardTime: string | null;
  standardTimeMax: string | null;
  /** Chip informativo fixo (usado na saída: "Chegada prevista: ..."). */
  contextChip?: React.ReactNode;
  /** Valor já salvo anteriormente (se o hóspede reabrir a tela). */
  initialDate?: string | null;
  initialTime?: string | null;
  onSaved?: (date: string, time: string) => void;
  /** Classe extra pro contêiner raiz (a tela que o hospeda já dá o cartão/
   * moldura — este componente nunca desenha a própria moldura). */
  className?: string;
};

export function PredictedTimeCard({
  kind,
  slug,
  guestName,
  reservationCode,
  confirmedDate,
  otherConfirmedDate,
  standardTime,
  standardTimeMax,
  contextChip,
  initialDate,
  initialTime,
  onSaved,
  className,
}: PredictedTimeCardProps) {
  const altLabel = kind === "checkin" ? "No dia seguinte" : "Na noite anterior";
  const altDate = kind === "checkin" ? addDaysISO(confirmedDate, 1) : addDaysISO(confirmedDate, -1);

  type DateChoice = "original" | "alt" | "custom";
  const initialChoice: DateChoice =
    initialDate && initialDate !== confirmedDate
      ? initialDate === altDate
        ? "alt"
        : "custom"
      : "original";

  const [dateChoice, setDateChoice] = React.useState<DateChoice>(initialChoice);
  const [customDate, setCustomDate] = React.useState<string | null>(
    initialChoice === "custom" ? (initialDate ?? null) : null,
  );
  const [calendarOpen, setCalendarOpen] = React.useState(false);
  // Nenhum horário vem pré-marcado na PRIMEIRA vez (pedido explícito) — só
  // pré-preenche se o hóspede já tinha salvo algo antes.
  const [selectedTime, setSelectedTime] = React.useState<string | null>(initialTime ?? null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  const effectiveDate =
    dateChoice === "original"
      ? confirmedDate
      : dateChoice === "alt"
        ? altDate
        : (customDate ?? confirmedDate);

  // A janela do imóvel só vale enquanto a previsão cai no MESMO dia da
  // reserva confirmada — mesma regra do editor do painel: mudou o dia,
  // qualquer horário passa a ser possível.
  const dayShifted = effectiveDate !== confirmedDate;
  const grid = React.useMemo(
    () =>
      dayShifted
        ? buildHourGrid(kind, null, null)
        : buildHourGrid(kind, standardTime, standardTimeMax),
    [dayShifted, kind, standardTime, standardTimeMax],
  );
  const allowedPhrase = allowedWindowPhrase(kind, standardTime, standardTimeMax);

  const minDate = kind === "checkin" ? undefined : parseISODateLocal(confirmedDate);
  const maxDate =
    kind === "checkout"
      ? undefined
      : otherConfirmedDate
        ? parseISODateLocal(otherConfirmedDate)
        : undefined;

  async function handleConfirm() {
    if (!selectedTime || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await submitPredictedTime({
        data: {
          slug,
          guest_name: guestName,
          reservation_code: reservationCode ?? null,
          checkin_date: kind === "checkin" ? effectiveDate : (otherConfirmedDate ?? confirmedDate),
          checkout_date: kind === "checkout" ? effectiveDate : (otherConfirmedDate ?? null),
          kind,
          date: effectiveDate,
          time: selectedTime,
        },
      });
      if (!res?.ok) {
        setError(
          res && "reason" in res && res.reason === "outside_window"
            ? "Esse horário está fora da janela permitida para este dia. Escolha outro horário ou outra data."
            : "Não deu para salvar agora. Tente de novo em instantes.",
        );
        return;
      }
      setSaved(true);
      onSaved?.(effectiveDate, selectedTime);
    } catch {
      setError("Não deu para salvar agora. Tente de novo em instantes.");
    } finally {
      setSaving(false);
    }
  }

  const eyebrowChegadaOuSaida = kind === "checkin" ? "chegada" : "saída";

  return (
    <div className={cn("flex flex-col", className)}>
      <p className="mb-2.5 text-[9.5px] font-black uppercase tracking-[0.16em] text-muted-foreground">
        Dia previsto de {eyebrowChegadaOuSaida}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            setDateChoice("original");
            setSaved(false);
          }}
          className={cn(
            "h-10 flex-[1.3] rounded-[10px] border text-[12.5px] font-extrabold transition-colors",
            dateChoice === "original"
              ? "border-[#e82dae]/50 bg-[#e82dae]/[0.14] text-[#ff8ade]"
              : "border-border/60 bg-foreground/[0.04] text-foreground/85",
          )}
        >
          Original · {fmtDiaMes(confirmedDate)}
        </button>
        <button
          type="button"
          onClick={() => {
            setDateChoice("alt");
            setSaved(false);
          }}
          className={cn(
            "h-10 flex-1 rounded-[10px] border text-[12.5px] font-bold transition-colors",
            dateChoice === "alt"
              ? "border-[#e82dae]/50 bg-[#e82dae]/[0.14] text-[#ff8ade]"
              : "border-border/60 bg-foreground/[0.04] text-foreground/85",
          )}
        >
          {altLabel}
        </button>
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Escolher outra data"
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                dateChoice === "custom"
                  ? "border-[#e82dae]/50 bg-[#e82dae]/[0.14] text-[#ff8ade]"
                  : "border-border/60 bg-foreground/[0.04] text-foreground/70",
              )}
            >
              <CalendarIcon className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <Calendar
              mode="single"
              locale={ptBR}
              selected={
                dateChoice === "custom" && customDate ? parseISODateLocal(customDate) : undefined
              }
              defaultMonth={parseISODateLocal(confirmedDate)}
              disabled={
                minDate || maxDate
                  ? (d: Date) => (minDate ? d < minDate : false) || (maxDate ? d > maxDate : false)
                  : undefined
              }
              onSelect={(d) => {
                if (!d) return;
                setCustomDate(dateToISOLocal(d));
                setDateChoice("custom");
                setCalendarOpen(false);
                setSaved(false);
              }}
              className="p-3"
            />
          </PopoverContent>
        </Popover>
      </div>

      {contextChip && <div className="mt-3.5">{contextChip}</div>}

      <p className="mb-2.5 mt-4 text-[9.5px] font-black uppercase tracking-[0.16em] text-muted-foreground">
        Horário previsto de {eyebrowChegadaOuSaida}
      </p>
      <div className="grid grid-cols-4 gap-1.5">
        {grid.map(({ time, enabled }) => (
          <button
            key={time}
            type="button"
            disabled={!enabled}
            onClick={() => {
              setSelectedTime(time);
              setSaved(false);
            }}
            className={cn(
              "h-[34px] rounded-[9px] text-xs font-bold tabular-nums transition-colors",
              !enabled
                ? "cursor-not-allowed bg-foreground/[0.03] text-muted-foreground/40"
                : selectedTime === time
                  ? "bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] text-white"
                  : "bg-foreground/[0.05] text-foreground hover:bg-foreground/[0.09]",
            )}
          >
            {time}
          </button>
        ))}
      </div>

      {allowedPhrase && (
        <div className="mt-3.5 flex justify-center px-1">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.04em] text-amber-600 dark:text-amber-500">
            Permitido {allowedPhrase}
          </span>
        </div>
      )}

      {error && <p className="mt-3 text-[12px] font-medium text-red-500">{error}</p>}

      <button
        type="button"
        disabled={!selectedTime || saving}
        onClick={handleConfirm}
        className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-[10px] bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE] text-sm font-extrabold text-white transition-opacity disabled:opacity-40"
      >
        {saving && <Loader2 className="size-4 animate-spin" />}
        {saved ? "Horário confirmado ✓" : "Confirmar horário"}
      </button>
    </div>
  );
}
