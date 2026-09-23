import { X } from "lucide-react";
import type { CleaningDayItem } from "@/lib/dashboard.functions";

/**
 * A TABELA DO DIA (mockup aprovado, 17/09/2026).
 *
 * "ao selecionar uma barra do gráfico, linha, etc.. permitir clicar em cima e
 *  abrir um tooltip com as informações detalhadas em forma de tabela"
 *
 * Abre logo abaixo do gráfico, com uma seta apontando para a barra ou o ponto
 * tocado. Três formatos, um para cada leitura:
 *
 *   "done"      Limpezas por dia — uma linha por limpeza: imóvel, tipo e
 *               valor, com a hora e quem concluiu.
 *   "cost"      Custo por dia — uma linha por IMÓVEL (quantidade, tipo e
 *               soma), do maior valor para o menor.
 *   "forecast"  Próximos 7 dias — um checkout previsto por linha: imóvel,
 *               horário de saída + hóspede, e o valor estimado (limpeza
 *               normal).
 *
 * Completa aguardando aprovação aparece na tabela com "em análise", mas fica
 * fora do total — igual aos cards.
 */

export type CleaningForecastItem = {
  id: string;
  date: string;
  propertyName: string;
  ownerName: string | null;
  timeLabel: string | null;
  guestName: string | null;
  estimateCents: number;
};

export type DayDetailSource =
  | { mode: "done" | "cost"; items: CleaningDayItem[] }
  | { mode: "forecast"; items: CleaningForecastItem[] };

const WEEKDAY = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function brl(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dayTitle(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] ?? "";
  return `${wd}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function timeSP(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TH = "pb-2 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground";
const TD = "border-t border-border py-2 align-top text-[12px]";

function PropertyCell({ name, owner }: { name: string; owner: string | null }) {
  return (
    <td className={`${TD} pr-2`}>
      <span className="block max-w-[150px] truncate font-bold sm:max-w-[220px]" title={name}>
        {name}
      </span>
      {owner && (
        <span className="mt-px block truncate text-[10.5px] font-bold text-accent">{owner}</span>
      )}
    </td>
  );
}

function TypeLabel({ type, pending }: { type: "normal" | "completa" | null; pending?: boolean }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <span
        className={`block font-bold ${type === "completa" ? "text-violet-500 dark:text-violet-400" : "text-sky-500 dark:text-sky-400"}`}
      >
        {type === "completa" ? "Completa" : "Normal"}
      </span>
      {pending && (
        <span className="mt-0.5 block text-[9.5px] font-extrabold text-amber-500 dark:text-amber-400">
          em análise
        </span>
      )}
    </>
  );
}

export function CleaningDayDetail({
  date,
  source,
  caretX,
  onClose,
}: {
  date: string;
  source: DayDetailSource;
  /** Posição da seta, em px a partir da borda esquerda do cartão. */
  caretX: number | null;
  onClose: () => void;
}) {
  let subtitle = "";
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (source.mode === "forecast") {
    const rows = source.items.filter((i) => i.date === date);
    const total = rows.reduce((n, r) => n + r.estimateCents, 0);
    subtitle =
      rows.length === 0
        ? "Nenhum checkout previsto"
        : `${rows.length} ${rows.length === 1 ? "checkout previsto" : "checkouts previstos"}`;
    body = rows.length > 0 && (
      <table className="w-full border-collapse tabular-nums">
        <thead>
          <tr>
            <th className={`${TH} text-left`}>Imóvel</th>
            <th className={`${TH} text-left`}>Saída</th>
            <th className={`${TH} text-right`}>Estimado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <PropertyCell name={r.propertyName} owner={r.ownerName} />
              <td className={`${TD} pr-2`}>
                <span className="block font-bold">{r.timeLabel ?? "—"}</span>
                {r.guestName && (
                  <span className="block max-w-[110px] truncate text-[10.5px] text-muted-foreground">
                    {r.guestName}
                  </span>
                )}
              </td>
              <td className={`${TD} text-right font-bold`}>{brl(r.estimateCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
    footer = rows.length > 0 && (
      <>
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Estimativa · limpeza normal
        </span>
        <span className="font-display text-[15px] font-bold tabular-nums">{brl(total)}</span>
      </>
    );
  } else {
    const rows = source.items.filter((i) => i.date === date);
    const counted = rows.filter((r) => !r.pending);
    const pending = rows.filter((r) => r.pending);
    const total = counted.reduce((n, r) => n + (r.priceCents ?? 0), 0);
    const pendingTotal = pending.reduce((n, r) => n + (r.priceCents ?? 0), 0);

    if (source.mode === "done") {
      subtitle =
        rows.length === 0
          ? "Nenhuma limpeza concluída"
          : `${rows.length} ${rows.length === 1 ? "limpeza concluída" : "limpezas concluídas"}`;
      body = rows.length > 0 && (
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Imóvel</th>
              <th className={`${TH} text-left`}>Tipo</th>
              <th className={`${TH} text-right`}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = [timeSP(r.concludedAt), r.doneByName].filter(Boolean).join(" · ");
              return (
                <tr key={r.id}>
                  <PropertyCell name={r.propertyName} owner={r.ownerName} />
                  <td className={`${TD} pr-2`}>
                    <TypeLabel type={r.cleaningType} pending={r.pending} />
                  </td>
                  <td className={`${TD} text-right`}>
                    <span className="block font-bold">{brl(r.priceCents)}</span>
                    {meta && (
                      <span className="block whitespace-nowrap text-[10.5px] text-muted-foreground">
                        {meta}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    } else {
      // Uma linha por imóvel, do maior valor para o menor. O tipo resume o
      // que houve ali ("Normal", "Completa" ou os dois).
      type Agg = {
        key: string;
        name: string;
        owner: string | null;
        count: number;
        cents: number;
        types: Set<string>;
        pending: boolean;
      };
      const byProp = new Map<string, Agg>();
      for (const r of counted) {
        const cur = byProp.get(r.propertyId) ?? {
          key: r.propertyId,
          name: r.propertyName,
          owner: r.ownerName,
          count: 0,
          cents: 0,
          types: new Set<string>(),
          pending: false,
        };
        cur.count += 1;
        cur.cents += r.priceCents ?? 0;
        if (r.cleaningType) cur.types.add(r.cleaningType);
        byProp.set(r.propertyId, cur);
      }
      for (const r of pending) {
        byProp.set(`pending:${r.id}`, {
          key: `pending:${r.id}`,
          name: r.propertyName,
          owner: r.ownerName,
          count: 1,
          cents: r.priceCents ?? 0,
          types: new Set(["completa"]),
          pending: true,
        });
      }
      const aggs = Array.from(byProp.values()).sort(
        (a, b) => Number(a.pending) - Number(b.pending) || b.cents - a.cents,
      );
      subtitle =
        rows.length === 0
          ? "Nenhum custo neste dia"
          : `${rows.length} ${rows.length === 1 ? "limpeza" : "limpezas"} · do maior para o menor valor`;
      body = aggs.length > 0 && (
        <table className="w-full border-collapse tabular-nums">
          <thead>
            <tr>
              <th className={`${TH} text-left`}>Imóvel</th>
              <th className={`${TH} px-2 text-center`}>Qtd</th>
              <th className={`${TH} text-left`}>Tipo</th>
              <th className={`${TH} text-right`}>Valor</th>
            </tr>
          </thead>
          <tbody>
            {aggs.map((a) => (
              <tr key={a.key}>
                <PropertyCell name={a.name} owner={a.owner} />
                <td className={`${TD} px-2 text-center font-bold`}>{a.count}</td>
                <td className={`${TD} pr-2`}>
                  {a.types.size > 1 ? (
                    <span className="block font-bold text-muted-foreground">Normal + completa</span>
                  ) : (
                    <TypeLabel
                      type={(Array.from(a.types)[0] as "normal" | "completa" | undefined) ?? null}
                      pending={a.pending}
                    />
                  )}
                </td>
                <td className={`${TD} text-right font-bold`}>{brl(a.cents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    footer = rows.length > 0 && (
      <>
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          {source.mode === "done" && pending.length > 0
            ? `Total · ${counted.length} no custo`
            : "Total do dia"}
        </span>
        <span className="text-right">
          <span className="block font-display text-[15px] font-bold tabular-nums">
            {brl(total)}
          </span>
          {pending.length > 0 && (
            <span className="block text-[10.5px] font-bold text-amber-500 dark:text-amber-400">
              +{brl(pendingTotal)} em análise
            </span>
          )}
        </span>
      </>
    );
  }

  return (
    <div
      role="dialog"
      aria-label={`Detalhe de ${dayTitle(date)}`}
      className="relative mt-3 rounded-[0.6rem] border border-border bg-popover text-popover-foreground shadow-[0_24px_48px_-20px_rgba(0,0,0,0.6)] animate-in fade-in-0 zoom-in-95 duration-150"
    >
      {caretX != null && (
        <span
          aria-hidden
          className="absolute -top-[6px] size-[10px] rotate-45 border-l border-t border-border bg-popover"
          style={{ left: Math.max(12, caretX - 5) }}
        />
      )}
      <div className="flex items-start justify-between gap-2.5 px-3.5 pb-2 pt-3">
        <div className="min-w-0">
          <p className="font-display text-[14px] font-bold">{dayTitle(date)}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          aria-label="Fechar detalhe"
          onClick={onClose}
          className="grid size-[30px] shrink-0 place-items-center rounded-md bg-secondary/60 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="size-3.5" strokeWidth={2.2} />
        </button>
      </div>
      {body && <div className="max-h-[320px] overflow-y-auto px-3.5 pt-1">{body}</div>}
      {footer && (
        <div className="mt-0.5 flex items-baseline justify-between gap-3 border-t border-border px-3.5 pb-3 pt-2.5">
          {footer}
        </div>
      )}
    </div>
  );
}
