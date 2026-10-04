import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToReaisInput, parseReaisInputToCents } from "@/components/ui/money-input";
import { CleaningProviderAvatar } from "@/components/dashboard/CleaningProviderAvatar";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { setCleaningPriceOverride, setCleaningType } from "@/lib/cleaning-price.functions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ownerLabel } from "@/components/dashboard/card-colors";
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

const TH = "pb-2.5 text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground";
const TD = "border-t border-border/60 py-3 align-top text-[12.5px]";

function PropertyCell({ name, owner }: { name: string; owner: string | null }) {
  return (
    <td className={`${TD} pr-2`}>
      <span className="block break-words font-bold" title={name}>
        {name}
      </span>
      {ownerLabel(owner) && (
        <span className="mt-0.5 block break-words text-[11.5px] font-semibold text-foreground/80">
          {ownerLabel(owner)}
        </span>
      )}
    </td>
  );
}

function TypeLabel({ type, pending }: { type: "normal" | "completa" | null; pending?: boolean }) {
  if (!type) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <span
        className={`block font-semibold whitespace-nowrap ${type === "completa" ? "text-foreground" : "text-muted-foreground"}`}
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

export function CleaningDayDetail(props: Parameters<typeof CleaningDayDetailContent>[0]) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) props.onClose(); }}>
      <DialogContent
        aria-label="Detalhe do dia"
        className="w-[calc(100vw-2rem)] sm:max-w-md gap-0 p-0 overflow-hidden rounded-[18px] border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] [&>button.absolute]:hidden"
      >
        <DialogTitle className="sr-only">Detalhe do dia</DialogTitle>
        <CleaningDayDetailContent {...props} />
      </DialogContent>
    </Dialog>
  );
}

export function CleaningDayDetailContent({
  date,
  source,
  caretX,
  onClose,
  title,
  icon: HeaderIcon = CalendarDays,
}: {
  /** "all" = todas as limpezas do período (janela dos cards do topo). */
  date: string;
  title?: string;
  icon?: React.ElementType;
  source: DayDetailSource;
  /** Posição da seta, em px a partir da borda esquerda do cartão. */
  caretX: number | null;
  onClose: () => void;
}) {
  void caretX;
  let subtitle = "";
  let body: React.ReactNode = null;
  let footer: React.ReactNode = null;

  if (source.mode === "forecast") {
    const rows = source.items.filter((i) => date === "all" || i.date === date);
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
    const rows = source.items.filter((i) => date === "all" || i.date === date);
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
                    <TypeToggle statusId={r.id} type={r.cleaningType} pending={r.pending} title={r.propertyName} />
                    {(r.logId || r.reservationId) && (
                      <span className="mt-1.5 block">
                        <CleaningProviderAvatar propertyId={r.propertyId} logId={r.logId ?? ""} reservationId={r.reservationId} />
                      </span>
                    )}
                  </td>
                  <td className={`${TD} text-right`}>
                    <EditablePrice statusId={r.id} cents={r.priceCents} title={r.propertyName} />
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
    <div aria-label={`Detalhe de ${title ?? dayTitle(date)}`}>
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground/[0.06] text-muted-foreground">
          <HeaderIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold leading-tight break-words">{title ?? dayTitle(date)}</p>
          <p className="ds-meta mt-0.5">{subtitle}</p>
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
      {body && (
        /* ANTI-CORTE vertical: nenhuma linha termina seca contra o rodapé.
           As linhas encaixam no topo ao rolar (snap), a borda de baixo
           esmaece em vez de cortar, e a folga final garante que a última
           linha apareça inteira quando a rolagem chega ao fim. */
        <div
          className="sg-elegant-scroll max-h-[60vh] snap-y snap-proximity overflow-y-auto overflow-x-hidden px-5 pb-5 pt-1 [&_tbody_tr]:snap-start"
          style={{
            maskImage: "linear-gradient(to bottom, #000 calc(100% - 20px), transparent)",
            WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 20px), transparent)",
          }}
        >
          {body}
        </div>
      )}
      {footer && (
        <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-border bg-foreground/[0.03] px-5 py-3.5">
          {footer}
        </div>
      )}
    </div>
  );
}

/** Troca normal ↔ completa com confirmação. */
function TypeToggle({
  statusId,
  type,
  pending,
  title,
}: {
  statusId: string;
  type: "normal" | "completa" | null;
  pending?: boolean;
  title: string;
}) {
  const [target, setTarget] = useState<"normal" | "completa" | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(setCleaningType);
  const qc = useQueryClient();
  if (!type) return <TypeLabel type={type} pending={pending} />;
  const next = type === "completa" ? "normal" : "completa";
  async function doSave() {
    if (!target) return;
    setBusy(true);
    try {
      await save({ data: { statusId, type: target } });
      toast.success(`Limpeza de ${title} alterada para ${target === "completa" ? "completa" : "normal"}.`);
      setTarget(null);
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o tipo.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => setTarget(next)}
        title={`Mudar para ${next === "completa" ? "Completa" : "Normal"}`}
        className="-mx-1 rounded px-1 text-left transition-colors hover:bg-secondary/60"
      >
        <TypeLabel type={type} pending={pending} />
      </button>
      <AlertDialog open={!!target} onOpenChange={(v) => !v && setTarget(null)}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar alteração?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              A limpeza de {title} vai passar de {type === "completa" ? "Completa" : "Normal"} para{" "}
              {next === "completa" ? "Completa" : "Normal"}. O valor passa a ser o cadastrado no imóvel para esse tipo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void doSave();
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Valor clicável: edita no mesmo lugar, com a MESMA letra, e SEMPRE pede
 * confirmação antes de gravar. */
function EditablePrice({ statusId, cents, title }: { statusId: string; cents: number | null; title: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(setCleaningPriceOverride);
  const qc = useQueryClient();
  const value = parseReaisInputToCents(text);

  async function doSave() {
    if (value == null) return;
    setBusy(true);
    try {
      await save({ data: { statusId, cents: value, reason: null } });
      toast.success(`Valor de ${title} alterado para ${brl(value)}.`);
      setConfirm(false);
      setEditing(false);
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o valor.");
    } finally {
      setBusy(false);
    }
  }

  const same = "font-bold text-[12.5px] tabular-nums text-foreground";
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(centsToReaisInput(cents));
          setEditing(true);
        }}
        title="Alterar valor"
        className={`-mx-1 rounded px-1 transition-colors hover:bg-secondary/60 ${same}`}
      >
        {brl(cents)}
      </button>
    );
  }
  return (
    <div className="ml-auto flex flex-col items-end gap-1">
      <span className={`inline-flex items-baseline rounded bg-secondary/60 px-1 -mx-1 ${same}`}>
        R$&nbsp;
        <input
          autoFocus
          inputMode="decimal"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value != null && value !== cents) setConfirm(true);
            if (e.key === "Escape") setEditing(false);
          }}
          style={{ width: `${Math.max(text.length, 3)}ch` }}
          className={`min-w-0 bg-transparent p-0 text-right outline-none ${same}`}
        />
      </span>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={value == null || value === cents}
          onClick={() => setConfirm(true)}
        >
          OK
        </Button>
      </div>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar alteração?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              O valor da limpeza de {title} vai passar de {brl(cents)} para {brl(value)}. Vale só para esta limpeza.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void doSave();
              }}
            >
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
