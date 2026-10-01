import { useEffect, useState, type ReactNode } from "react";
import { BarChart, Bar, XAxis, CartesianGrid, Cell, LabelList, Tooltip } from "recharts";
import { Loader2, X } from "lucide-react";
import { useAntiClipColumns } from "@/hooks/useAntiClipColumns";
import { PANEL_SHELL, PanelHeading } from "@/components/dashboard/panel-chrome";

/**
 * CARTÃO DE GRÁFICO POR DIA — o mesmo desenho de "Limpezas por dia":
 * ponto + título em caixa alta com "(N DIAS)", "role para o lado" só quando
 * há dias escondidos, barras com o número em cima e colunas que nunca ficam
 * cortadas na borda (`useAntiClipColumns`). Tocar numa barra abre a tabela do
 * dia logo abaixo, com a seta apontando para ela.
 *
 * Quem chama entrega a série já recortada (primeiro ao último dia com dado).
 */
export type DailyPoint = { date: string; count: number };

const DAY_MIN_PX = 56;
const DEFAULT_TONE = "#7fb79a";

function dayTick(v: string): string {
  const [, m, d] = v.split("-");
  return `${d}/${m}`;
}

const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
export function dayTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${wd}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

export function DailyBarChartCard({
  title,
  data,
  loading,
  tone = DEFAULT_TONE,
  unitLabel,
  renderDetail,
}: {
  title: string;
  data: DailyPoint[] | undefined;
  loading: boolean;
  tone?: string;
  /** Rótulo do tooltip (sem tabela do dia). */
  unitLabel?: string;
  /** Tabela do dia. Recebe a data; devolve { subtitle, body }. */
  renderDetail?: (date: string) => { subtitle: string; body: ReactNode };
}) {
  const days = data?.length ?? 0;
  const anti = useAntiClipColumns(days, DAY_MIN_PX);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickX, setPickX] = useState<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const hasHiddenDays =
    days > 0 &&
    anti.scrolls &&
    anti.viewportWidth != null &&
    anti.contentWidth != null &&
    scrollLeft + anti.viewportWidth < anti.contentWidth - 2;

  const dayKey = data?.map((d) => d.date).join(",") ?? "";
  useEffect(() => {
    setSelected((cur) => (cur && dayKey.split(",").includes(cur) ? cur : null));
  }, [dayKey]);

  const detail = selected && renderDetail ? renderDetail(selected) : null;

  return (
    <div className={`${PANEL_SHELL} w-full px-3.5 py-3.5`}>
      <PanelHeading
        title={days > 0 ? `${title} (${days} ${days === 1 ? "dia" : "dias"})` : title}
        dotColor={tone}
        className="mb-2.5"
        right={
          <span
            className="text-[10px] text-muted-foreground"
            style={hasHiddenDays ? undefined : { visibility: "hidden" }}
            aria-hidden={hasHiddenDays ? undefined : true}
          >
            role para o lado
          </span>
        }
      />
      {loading ? (
        <div className="grid h-32 place-items-center text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : days === 0 ? (
        <p className="grid h-24 place-items-center text-[12px] text-muted-foreground">Nenhum registro no período.</p>
      ) : (
        <>
          <div ref={anti.ref} className="flex w-full">
            <div
              className="sg-elegant-scroll overflow-x-auto overflow-y-hidden"
              style={{ width: anti.viewportWidth }}
              onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
            >
              <div className={`h-32 ${renderDetail ? "cursor-pointer" : ""}`} style={{ width: anti.contentWidth }}>
                {anti.contentWidth ? (
                  <BarChart
                    width={anti.contentWidth}
                    height={128}
                    data={data}
                    margin={{ top: 14, right: 8, left: 8, bottom: 0 }}
                    onClick={(state: { activeLabel?: string | number; activeCoordinate?: { x: number } } | null) => {
                      if (!renderDetail) return;
                      const label = state?.activeLabel != null ? String(state.activeLabel) : null;
                      if (!label) return;
                      if (label === selected) return setSelected(null);
                      setSelected(label);
                      setPickX(state?.activeCoordinate?.x ?? null);
                    }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={dayTick}
                      tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                      content={renderDetail ? () => null : undefined}
                      formatter={(v: number) => [`${v}`, unitLabel ?? title]}
                    />
                    <Bar dataKey="count" fill={tone} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
                      {(data ?? []).map((d) => (
                        <Cell key={d.date} fillOpacity={selected && selected !== d.date ? 0.32 : 1} />
                      ))}
                      <LabelList
                        dataKey="count"
                        position="top"
                        offset={4}
                        style={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                      />
                    </Bar>
                  </BarChart>
                ) : null}
              </div>
            </div>
            {anti.spacer > 0 && <span aria-hidden className="shrink-0" style={{ width: anti.spacer }} />}
          </div>
          {selected && detail && (
            <div
              role="dialog"
              aria-label={`Detalhe de ${dayTitle(selected)}`}
              className="relative mt-3 rounded-[0.6rem] border border-border bg-popover text-popover-foreground shadow-[0_24px_48px_-20px_rgba(0,0,0,0.6)] animate-in fade-in-0 zoom-in-95 duration-150"
            >
              {pickX != null && (
                <span
                  aria-hidden
                  className="absolute -top-[6px] size-[10px] rotate-45 border-l border-t border-border bg-popover"
                  style={{ left: Math.max(12, pickX - scrollLeft - 5) }}
                />
              )}
              <div className="flex items-start justify-between gap-2.5 px-3.5 pb-2 pt-3">
                <div className="min-w-0">
                  <p className="font-display text-[14px] font-bold">{dayTitle(selected)}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{detail.subtitle}</p>
                </div>
                <button
                  type="button"
                  aria-label="Fechar detalhe"
                  onClick={() => setSelected(null)}
                  className="grid size-[30px] shrink-0 place-items-center rounded-md bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3.5" strokeWidth={2.2} />
                </button>
              </div>
              <div className="max-h-[320px] overflow-y-auto px-3.5 pb-3 pt-1">{detail.body}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Classes da tabela do dia — as mesmas da tabela da Limpeza. */
export const DAY_TH = "pb-2 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground";
export const DAY_TD = "border-t border-border py-2 align-top text-[12px]";
