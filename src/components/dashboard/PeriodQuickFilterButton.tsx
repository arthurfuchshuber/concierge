import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { CalendarRange } from "lucide-react";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_OFFSET,
  FilterHeaderClear,
  FilterIconBadge,
  FilterPeriodCalendar,
  FitPopoverContent,
} from "@/components/dashboard/filter-panel";
import { ACTION_BUTTON_TONE, ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";

export type QuickPeriod = { start: string; end: string };

/** Hoje em America/Sao_Paulo (yyyy-mm-dd) — a mesma referência do resto do Dashboard. */
function todaySP(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/**
 * FILTRO RÁPIDO DE PERÍODO — o botão de calendário da barra de ferramentas.
 *
 * Faz UMA coisa: filtrar a página por um intervalo de datas. Abre direto o
 * calendário (sem menu aninhado), 1º clique = início, 2º clique = fim; com o
 * intervalo completo o filtro da página atualiza na hora e a janela fecha.
 * Montado só com as peças de `filter-panel.tsx` (tokens `--panel*`).
 */
export function PeriodQuickFilterButton({
  value,
  onChange,
  min,
  max,
  defaultChip,
}: {
  value: QuickPeriod | null;
  onChange: (next: QuickPeriod | null) => void;
  /** Limites do calendário (yyyy-mm-dd), quando a tela só tem dados num intervalo. */
  min?: string | null;
  max?: string | null;
  /** Atalho "padrão" (ex.: "Últimos 7 dias") que limpa o período. */
  defaultChip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [draft, setDraft] = useState<DateRange | undefined>(
    value ? { from: toDate(value.start), to: toDate(value.end) } : undefined,
  );
  // O mês abre SEMPRE no de hoje (regra de 23/09/2026).
  const [month, setMonth] = useState<Date>(() => toDate(todaySP()));
  useEffect(() => {
    setDraft(value ? { from: toDate(value.start), to: toDate(value.end) } : undefined);
  }, [value]);

  const clear = () => {
    setDraft(undefined);
    onChange(null);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(toDate(todaySP()));
        setAnchor(null);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={value ? `Período ${ddmm(value.start)} a ${ddmm(value.end)}` : "Filtrar por período"}
          aria-label={value ? `Período ${ddmm(value.start)} a ${ddmm(value.end)}` : "Filtrar por período"}
          className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
        >
          <CalendarRange className={ACTION_ICON} />
          {value ? (
            <>
              <span className="lg:hidden">{`${ddmm(value.start)} a ${ddmm(value.end)}`}</span>
              <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent max-lg:hidden" />
            </>
          ) : null}
        </button>
      </PopoverTrigger>
      <FitPopoverContent
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        className={FILTER_PANEL_CLASS}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-[9px] px-3.5 py-[11px]">
          <FilterIconBadge icon={CalendarRange} size="sm" />
          <span className="ds-card-title min-w-0 flex-1">Período</span>
          {value || draft?.from ? <FilterHeaderClear onClick={clear} /> : null}
        </div>
        <FilterPeriodCalendar
          defaultChip={
            defaultChip
              ? { label: defaultChip, active: !draft?.from && !value, onSelect: () => { clear(); setOpen(false); } }
              : undefined
          }
          value={draft}
          month={month}
          onMonthChange={setMonth}
          today={toDate(todaySP())}
          min={min ? toDate(min) : undefined}
          max={max ? toDate(max) : undefined}
          onChange={(next, clicked) => {
            // Atalhos (sem dia clicado) aplicam direto.
            if (!clicked) {
              setAnchor(null);
              setDraft(next);
              if (next?.from && next?.to) {
                onChange({ start: toISO(next.from), end: toISO(next.to) });
                setOpen(false);
              }
              return;
            }
            // 1º clique = início (janela continua aberta); 2º clique = fim.
            if (!anchor) {
              setAnchor(clicked);
              setDraft({ from: clicked, to: undefined });
              return;
            }
            const [a, b] = anchor <= clicked ? [anchor, clicked] : [clicked, anchor];
            setAnchor(null);
            setDraft({ from: a, to: b });
            onChange({ start: toISO(a), end: toISO(b) });
            setOpen(false);
          }}
        />
      </FitPopoverContent>
    </Popover>
  );
}
