import { useState, type ReactNode } from "react";
import { CalendarDays } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { FilterDateCalendar, longDatePt } from "@/components/dashboard/filter-panel";
import { WIDE_WINDOW_CLASS } from "@/components/dashboard/wide-window";
import { WINDOW_TITLE_CLASS } from "@/components/dashboard/window-header";

/**
 * JANELA DE CALENDÁRIO PADRÃO DO SISTEMA (regra de 18/11/2026): a janela "Ir para" da Operação é o modelo
 * de TODA janela de calendário — cabeçalho com o título e, ao lado, os botões rápidos PRÓPRIOS da janela
 * (quando a janela não tem, fica sem), o mês com setas, a grade de dias e o campo do rodapé. Em data única
 * o campo mostra a data por extenso ("Quarta-feira, 18 de novembro de 2026"). Tocar no dia escolhe e fecha.
 *
 * Intervalos usam `FilterPeriodScreenHeader` + `FilterPeriodCalendar` (Período / Ir para); esta janela é
 * a versão de DATA ÚNICA, centralizada como as demais janelas.
 */

/** "yyyy-mm-dd" → Date local (meia-noite), sem fuso. */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
/** Date local → "yyyy-mm-dd". */
export function localDateToIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
/** Hoje em America/Sao_Paulo, como Date local. */
export function todaySaoPauloDate(): Date {
  return isoToLocalDate(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
  );
}

export function CalendarWindow({
  open,
  onOpenChange,
  title,
  value,
  onPick,
  min,
  max,
  shortcuts,
  fieldLabel = "Data",
  isDisabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Título com as iniciais maiúsculas (ex.: "Escolher Nova Data"). */
  title: string;
  value: Date | undefined;
  onPick: (d: Date) => void;
  min?: Date;
  max?: Date;
  /** Botões rápidos próprios desta janela, ao lado do título. */
  shortcuts?: ReactNode;
  fieldLabel?: string;
  /** Regra extra de dia indisponível. */
  isDisabled?: (d: Date) => boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(WIDE_WINDOW_CLASS, "sm:!p-0 sm:max-w-sm")}
      >
        <DialogHeader className="flex min-h-12 shrink-0 flex-row items-center gap-1.5 space-y-0 border-b border-[var(--panel-div)] py-1.5 pl-4 pr-14 text-left">
          <DialogTitle
            className={cn("min-w-0", shortcuts ? "flex-none" : "flex-1", WINDOW_TITLE_CLASS)}
          >
            {title}
          </DialogTitle>
          {shortcuts ? <span className="flex min-w-0 items-center gap-1">{shortcuts}</span> : null}
        </DialogHeader>
        <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto">
          {/* `key`: reabre sempre no mês do dia escolhido. */}
          <FilterDateCalendar
            key={open ? "open" : "closed"}
            value={value}
            onChange={(d) => {
              onPick(d);
              onOpenChange(false);
            }}
            today={todaySaoPauloDate()}
            min={min}
            max={max}
            hideQuick
            longDateLabel={fieldLabel}
            isDisabled={isDisabled}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Botão rápido do cabeçalho de uma janela de calendário (mesmo desenho das pílulas do "Ir para"). */
export function CalendarShortcut({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-2 py-[5px] text-[11px] font-semibold transition-colors ${
        active
          ? "bg-accent/[0.14] text-accent"
          : "bg-foreground/[0.06] text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * CAMPO DE DATA PADRÃO: substitui o `<input type="date">` nativo do navegador em todo o sistema. Mostra a
 * data (dd/mm/aaaa) e abre a janela de calendário padrão. Valor em "yyyy-mm-dd" (vazio = sem data).
 */
export function DateField({
  value,
  onChange,
  title = "Escolher Data",
  min,
  max,
  placeholder = "dd/mm/aaaa",
  disabled,
  className,
  id,
  ariaLabel,
  clearable,
}: {
  value: string | null | undefined;
  onChange: (next: string) => void;
  title?: string;
  min?: string | null;
  max?: string | null;
  placeholder?: string;
  disabled?: boolean;
  /** Classes do botão (por padrão imita o `Input` do sistema). */
  className?: string;
  id?: string;
  ariaLabel?: string;
  /** Mostra "Limpar" no cabeçalho da janela. */
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const iso = value ? value.slice(0, 10) : "";
  const shown = iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "";
  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-label={ariaLabel ?? title}
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm tabular-nums shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      >
        <span className={cn("min-w-0 truncate", !shown && "text-muted-foreground")}>
          {shown || placeholder}
        </span>
        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <CalendarWindow
        open={open}
        onOpenChange={setOpen}
        title={title}
        value={iso ? isoToLocalDate(iso) : undefined}
        min={min ? isoToLocalDate(min) : undefined}
        max={max ? isoToLocalDate(max) : undefined}
        onPick={(d) => onChange(localDateToIso(d))}
        shortcuts={
          clearable && iso ? (
            <CalendarShortcut
              label="Limpar"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
            />
          ) : undefined
        }
      />
    </>
  );
}
