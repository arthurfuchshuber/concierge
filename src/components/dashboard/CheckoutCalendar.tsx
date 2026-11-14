// Calendário da "Repetir › Personalizar…" (13/11/2026): escolhe UMA data específica e marca com uma
// bolinha laranja os dias que têm checkout em algum dos imóveis escolhidos. Datas em texto AAAA-MM-DD.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { listCheckoutDays } from "@/lib/recurrences.functions";
import { daysInMonth } from "@/lib/recurrence-dates";

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const pad = (n: number) => String(n).padStart(2, "0");

export function CheckoutCalendar({
  value,
  min,
  today,
  propertyIds,
  onChange,
}: {
  value: string;
  /** Primeiro dia que pode ser escolhido (hoje). */
  min: string;
  today: string;
  propertyIds: string[];
  onChange: (iso: string) => void;
}) {
  const [ym, setYm] = useState<[number, number]>(() => [Number(value.slice(0, 4)), Number(value.slice(5, 7))]);
  const [y, m] = ym;
  const first = `${y}-${pad(m)}-01`;
  const last = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`;
  const fetchDays = useServerFn(listCheckoutDays);
  const { data } = useQuery({
    queryKey: ["checkout-days", propertyIds.join(","), first],
    queryFn: () => fetchDays({ data: { propertyIds, from: first, to: last } }),
    enabled: propertyIds.length > 0,
    staleTime: 60_000,
  });
  const marked = new Set(data?.days ?? []);
  // Dia da semana do dia 1 (0 = domingo), sem fuso: conta de calendário.
  const offset = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const minMonth = Number(min.slice(0, 4)) * 12 + Number(min.slice(5, 7));
  const go = (delta: number) => {
    const t = y * 12 + (m - 1) + delta;
    setYm([Math.floor(t / 12), (t % 12) + 1]);
  };

  return (
    <div className="px-3 pb-2 pt-1.5">
      <div className="mb-0.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={y * 12 + m <= minMonth}
          aria-label="Mês anterior"
          className="p-1 text-muted-foreground disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-[13px] font-bold text-foreground">
          {MESES[m - 1]} {y}
        </span>
        <button type="button" onClick={() => go(1)} aria-label="Próximo mês" className="p-1 text-muted-foreground">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {["D", "S", "T", "Q", "Q", "S", "S"].map((w, i) => (
          <span key={i} className="text-[10px] font-bold leading-[18px] text-muted-foreground">
            {w}
          </span>
        ))}
        {Array.from({ length: offset }).map((_, i) => (
          <span key={`o${i}`} />
        ))}
        {Array.from({ length: daysInMonth(y, m) }).map((_, i) => {
          const d = i + 1;
          const iso = `${y}-${pad(m)}-${pad(d)}`;
          const past = iso < min;
          const sel = iso === value;
          const hasCheckout = marked.has(iso);
          return (
            <button
              key={iso}
              type="button"
              disabled={past}
              onClick={() => onChange(iso)}
              aria-label={`${pad(d)}/${pad(m)}/${y}${hasCheckout ? ", tem checkout" : ""}`}
              aria-pressed={sel}
              className={`relative mx-auto grid size-[26px] place-items-center rounded-full text-[12px] tabular-nums ${
                sel
                  ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] font-bold text-white"
                  : iso === today
                    ? "font-bold text-foreground ring-[1.5px] ring-foreground/35"
                    : past
                      ? "text-foreground opacity-30"
                      : "font-semibold text-foreground"
              }`}
            >
              {d}
              {hasCheckout && !past && (
                <span
                  aria-hidden="true"
                  className={`absolute bottom-[2px] left-1/2 size-1 -translate-x-1/2 rounded-full ${
                    sel ? "bg-white" : "bg-orange-400"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
        <span aria-hidden="true" className="inline-block size-[5px] rounded-full bg-orange-400" />
        Dia com checkout
      </div>
    </div>
  );
}
