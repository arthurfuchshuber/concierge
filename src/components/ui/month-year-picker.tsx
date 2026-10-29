import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { clampMonthInYear, monthBounds, monthOptions, yearOptions } from "@/lib/month-year-options";
import { cn } from "@/lib/utils";

/**
 * SELETOR RÁPIDO DE MÊS E ANO (29/10/2026, mockup aprovado "Seletor de mês e ano nos
 * calendários"): tocar em "novembro 2026" abre uma lista com o MÊS na coluna da esquerda e o
 * ANO na da direita. Escolher o ano já leva o calendário para ele (mantendo o mês, ou o mais
 * próximo que exista); escolher o mês leva e fecha. As colunas só trazem o que existe de
 * verdade entre `min` e `max` (ver `month-year-options.ts`).
 */
export function MonthYearPicker({
  month,
  onMonthChange,
  min,
  max,
  className,
}: {
  /** Mês que está na tela. */
  month: Date;
  onMonthChange: (next: Date) => void;
  /** Primeiro/último mês navegáveis (qualquer dia dentro do mês). Sem eles, janela livre em volta de hoje. */
  min?: Date | null;
  max?: Date | null;
  /** Aparência do botão (cada calendário mantém a sua tipografia). */
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(month.getFullYear());
  const bounds = monthBounds(month, min, max);
  const years = yearOptions(bounds);
  const months = monthOptions(year, bounds);
  const curMonth = month.getMonth();
  const curYear = month.getFullYear();
  const monthSelRef = useRef<HTMLButtonElement | null>(null);
  const yearSelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) setYear(month.getFullYear());
  }, [open, month]);

  // Lista longa: abre já com o item atual à vista.
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      monthSelRef.current?.scrollIntoView({ block: "nearest" });
      yearSelRef.current?.scrollIntoView({ block: "nearest" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const monthName = (m: number) => format(new Date(2000, m, 1), "MMMM", { locale: ptBR });
  const Chevron = open ? ChevronUp : ChevronDown;

  const row = (selected: boolean) =>
    cn(
      "flex h-8 w-full items-center justify-between rounded-[10px] border px-2.5 text-left text-[13px] capitalize transition-colors",
      selected
        ? "border-accent/35 bg-accent/[0.14] font-semibold text-foreground"
        : "border-transparent font-normal text-foreground hover:bg-foreground/[0.06]",
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Escolher mês e ano"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-[10px] px-2.5 text-sm font-medium transition-colors hover:bg-foreground/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            open && "bg-foreground/[0.07]",
            className,
          )}
        >
          <span>{format(month, "MMMM yyyy", { locale: ptBR })}</span>
          <Chevron className="size-3.5 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={6} className="w-[248px] rounded-[14px] p-2">
        <div role="listbox" aria-label="Escolher mês e ano" className="flex">
          <div className="min-w-0 flex-1">
            <div className="px-2.5 pb-1.5 pt-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">Mês</div>
            <div className="sg-elegant-scroll flex max-h-[202px] flex-col gap-0.5 overflow-y-auto">
              {months.map((m) => {
                const selected = year === curYear && m === curMonth;
                return (
                  <button
                    key={m}
                    ref={selected ? monthSelRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={row(selected)}
                    onClick={() => {
                      onMonthChange(new Date(year, m, 1));
                      setOpen(false);
                    }}
                  >
                    <span>{monthName(m)}</span>
                    {selected ? <Check className="size-[13px] text-accent" strokeWidth={2.4} aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div aria-hidden className="mx-1.5 w-px shrink-0 bg-foreground/[0.07]" />
          <div className="min-w-0 flex-1">
            <div className="px-2.5 pb-1.5 pt-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">Ano</div>
            <div className="sg-elegant-scroll flex max-h-[202px] flex-col gap-0.5 overflow-y-auto">
              {years.map((y) => {
                const selected = y === year;
                return (
                  <button
                    key={y}
                    ref={selected ? yearSelRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={row(selected)}
                    onClick={() => {
                      setYear(y);
                      onMonthChange(new Date(y, clampMonthInYear(y, curMonth, bounds), 1));
                    }}
                  >
                    <span>{y}</span>
                    {selected ? <Check className="size-[13px] text-accent" strokeWidth={2.4} aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
