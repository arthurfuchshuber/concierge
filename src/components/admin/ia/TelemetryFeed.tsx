import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";
import {
  FEED_FILTERS,
  SURFACE_LABEL,
  formatClock,
  formatMs,
  formatRowCost,
  modelLabel,
  modelShortLabel,
  type FeedFilter,
} from "@/lib/admin-ia-telemetry";
import type { TelemetryFeedRow } from "@/lib/admin-ia-telemetry.functions";
import { OutcomeChip } from "./OutcomeChip";

/**
 * Feed "linha a linha": tabela no desktop (com rolagem horizontal própria, nada cortado na
 * margem) e cartões empilhados no celular. Tocar numa linha abre o Raio-X.
 */
export function TelemetryFeed({
  rows,
  filter,
  onFilter,
  onOpen,
  updatedLabel,
  total,
}: {
  rows: TelemetryFeedRow[];
  filter: FeedFilter;
  onFilter: (f: FeedFilter) => void;
  onOpen: (id: string) => void;
  updatedLabel: string;
  total: number;
}) {
  return (
    <section className={`${PANEL_SHELL} min-w-0`}>
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="font-display text-[15px] font-bold">Linha a linha</h2>
          <span className="truncate text-xs text-muted-foreground">
            {updatedLabel} · {total} hoje
          </span>
        </div>
        <Tabs
          value={filter}
          onValueChange={(v) => onFilter(v as FeedFilter)}
          className="min-w-0 lg:max-w-[520px]"
        >
          <TabsList aria-label="Filtro do feed">
            {FEED_FILTERS.map((f) => (
              <TabsTrigger key={f.key} value={f.key}>
                {f.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {rows.length === 0 ? (
        <p className="border-t border-foreground/[0.06] px-4 py-10 text-center text-sm text-muted-foreground">
          Nenhuma inferência neste filtro nos últimos 14 dias.
        </p>
      ) : (
        <>
          {/* Desktop: tabela com rolagem horizontal contida */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead>
                <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                  <th className="px-3 py-2.5 font-bold">Horário</th>
                  <th className="px-3 py-2.5 font-bold">Imóvel</th>
                  <th className="px-3 py-2.5 font-bold">Canal</th>
                  <th className="px-3 py-2.5 font-bold">Gatilho</th>
                  <th className="px-3 py-2.5 font-bold">Desfecho</th>
                  <th className="px-3 py-2.5 font-bold">Modelo</th>
                  <th className="px-3 py-2.5 text-right font-bold">Latência</th>
                  <th className="px-3 py-2.5 text-right font-bold">Custo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => onOpen(r.id)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.id)}
                    tabIndex={0}
                    className="cursor-pointer border-t border-foreground/[0.06] align-top text-[13px] transition-colors hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.04] focus-visible:outline-none"
                  >
                    <td className="px-3 py-3 tabular-nums text-muted-foreground">
                      {formatClock(r.startedAt)}
                    </td>
                    <td className="max-w-[220px] px-3 py-3">
                      <div className="ds-card-title truncate leading-tight">{r.propertyName}</div>
                      <OwnerLine
                        name={r.ownerName}
                        phone={r.ownerPhone}
                        country={r.ownerPhoneCountry}
                        phonePosition="adjacent"
                        className="mt-1"
                      />
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">{SURFACE_LABEL[r.surface]}</td>
                    <td className="max-w-[280px] px-3 py-3 text-muted-foreground">
                      <span className="line-clamp-2">{r.triggerPreview}</span>
                    </td>
                    <td className="px-3 py-3">
                      <OutcomeChip outcome={r.outcome} code={r.outcomeCode} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                      {modelLabel(r.modelId)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {formatMs(r.latencyMs)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      {formatRowCost(r.costUsd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: cartões, nada passa da margem */}
          <ul className="flex flex-col gap-2.5 border-t border-foreground/[0.06] p-3 md:hidden">
            {rows.map((r) => (
              <li key={r.id} className="min-w-0">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(r.id)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.id)}
                  className="flex w-full cursor-pointer min-w-0 flex-col gap-1.5 rounded-[12px] bg-foreground/[0.025] p-3 text-left shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]"
                >
                  <span className="flex justify-between gap-2 text-[11.5px] text-muted-foreground">
                    <span className="tabular-nums">{formatClock(r.startedAt)}</span>
                    <span>{SURFACE_LABEL[r.surface]}</span>
                  </span>
                  <span className="ds-card-title block truncate leading-tight">
                    {r.propertyName}
                  </span>
                  <OwnerLine
                    name={r.ownerName}
                    phone={r.ownerPhone}
                    country={r.ownerPhoneCountry}
                    phonePosition="adjacent"
                  />
                  <span className="line-clamp-2 text-[13px] text-muted-foreground">
                    {r.triggerPreview}
                  </span>
                  <span className="mt-0.5 flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 shrink">
                      <OutcomeChip outcome={r.outcome} code={r.outcomeCode} />
                    </span>
                    <span className="shrink-0 truncate text-[11.5px] tabular-nums text-muted-foreground">
                      {modelShortLabel(r.modelId)} · {formatMs(r.latencyMs)} ·{" "}
                      {formatRowCost(r.costUsd)}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
