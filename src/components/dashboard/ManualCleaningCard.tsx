import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, Check, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CARD_OWNER, CARD_PROPERTY, ownerLabel } from "@/components/dashboard/card-colors";
import { CleaningProviderAvatar } from "@/components/dashboard/CleaningProviderAvatar";
import { PropertyAccessButton } from "@/components/dashboard/PropertyAccessButton";
import { CLEANING_APPROVALS_KEY } from "@/components/dashboard/CleaningApprovalPanel";
import { notifyAction } from "@/components/UndoActionBar";
import { concludeManualCleaning, reopenManualCleaning } from "@/lib/manual-cleaning.functions";
import type { ArrivalRow } from "@/lib/dashboard-arrival-types";

/**
 * CARD DE UMA LIMPEZA CRIADA MANUALMENTE (mockup "Nova limpeza", aprovado
 * 02/10/2026: nome do imóvel + "Proprietário:", selo "Manual" e a linha
 * "Sem reserva · Limpeza normal · R$ 150,00").
 *
 * POR QUE É UM CARD PRÓPRIO, e não o `ArrivalCard` da esteira: aquele card é
 * todo construído em volta de uma estadia — previsão de chegada/saída,
 * engajamento do hóspede, registros e histórico da reserva, "voltar ao status
 * anterior". Nada disso existe numa limpeza avulsa, e ligar cada peça com um
 * "se for manual, esconde" espalharia a exceção por mil linhas. Aqui fica só
 * o que a limpeza manual tem.
 *
 * O que ele reaproveita, sem redesenhar:
 *  · a casca dos cards da fila (mesmo raio, borda e fundo do `ArrivalCard`);
 *  · o botão "Finalizar Limpeza" (mesmas classes; o texto corta com
 *    reticências, nunca os ícones — regra de 30/09/2026);
 *  · o quadrado do prestador (`CleaningProviderAvatar`), que troca o
 *    responsável só desta limpeza;
 *  · a chave de acesso (`PropertyAccessButton`), que é onde mora o botão do
 *    Maps desde 01/10/2026 — então a regra "nome do imóvel sempre com
 *    proprietário e Maps" continua valendo;
 *  · "Limpeza não será realizada" no menu "⋮", com a mesma confirmação.
 *
 * Tipo e valor foram definidos na criação: finalizar NÃO pergunta o tipo de
 * novo. O "Desfazer" de 5 s devolve a limpeza para a fila.
 */

function brl(c: number | null | undefined) {
  if (c == null) return null;
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function ManualCleaningCard({ row }: { row: ArrivalRow }) {
  const m = row.manual;
  const qc = useQueryClient();
  const concludeFn = useServerFn(concludeManualCleaning);
  const reopenFn = useServerFn(reopenManualCleaning);
  const [busy, setBusy] = useState(false);
  if (!m) return null;

  const refresh = () =>
    qc.invalidateQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return k === "dash-list" || k === "dash-cleaning-stats" || k === CLEANING_APPROVALS_KEY;
      },
      refetchType: "active",
    });

  async function finish(skip: boolean) {
    if (!m) return;
    setBusy(true);
    // O card sai da fila na hora; a recarga confirma depois.
    void qc.cancelQueries({ predicate: (q) => q.queryKey[0] === "dash-list" });
    qc.setQueriesData<{ rows: ArrivalRow[] } | undefined>(
      { predicate: (q) => q.queryKey[0] === "dash-list" && q.queryKey[1] === "checkout" },
      (old) => (old?.rows ? { ...old, rows: old.rows.filter((r) => r.logId !== row.logId) } : old),
    );
    try {
      await concludeFn({ data: { statusId: m.id, skip } });
      notifyAction(
        skip ? "Limpeza não será realizada — card concluído." : "Limpeza concluída.",
        () => {
          reopenFn({ data: { statusId: m.id } })
            .catch((e) =>
              toast.error(e instanceof Error ? e.message : "Não foi possível desfazer."),
            )
            .finally(() => void refresh());
        },
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível finalizar a limpeza.");
    } finally {
      setBusy(false);
      void refresh();
    }
  }

  const owner = ownerLabel(row.ownerName);
  const price = brl(m.priceCents);
  const detail = [
    m.reservationLinked ? row.guestName || "Reserva" : "Sem reserva",
    m.cleaningType === "completa" ? "Limpeza completa" : "Limpeza normal",
    price,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      data-whole-card
      className="relative isolate flex snap-start flex-col gap-2 rounded-[10px] border border-border bg-muted/20 p-3 pl-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className={`${CARD_PROPERTY} block truncate`} title={row.propertyName ?? undefined}>
            {row.propertyName ?? "Imóvel"}
          </span>
          {owner && <p className={`mt-0.5 truncate text-[11.5px] ${CARD_OWNER}`}>{owner}</p>}
        </div>
        <span className="shrink-0 rounded-full bg-accent/[0.14] px-[9px] py-[3px] text-[10px] font-bold uppercase tracking-[0.08em] text-accent">
          Manual
        </span>
      </div>
      <p className="truncate text-[11.5px] text-muted-foreground" title={detail}>
        {detail}
      </p>

      <div className="flex min-w-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => void finish(false)}
          disabled={busy}
          aria-label="Concluir limpeza"
          title="Concluir limpeza"
          className="box-border inline-flex h-7 max-h-7 min-h-7 min-w-0 flex-1 items-center justify-center gap-2 self-center rounded-[0.3rem] bg-emerald-600 px-2.5 text-[11px] font-semibold leading-none tracking-tight text-white transition-all hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-60"
        >
          <Check className="size-3 shrink-0" />
          <span className="truncate">Finalizar Limpeza</span>
        </button>
        <CleaningProviderAvatar
          propertyId={row.propertyId}
          logId={row.logId}
          reservationId={null}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <PropertyAccessButton row={row} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Mais opções"
                title="Mais opções"
                className="grid size-7 place-items-center rounded-[0.3rem] border border-border/50 bg-[var(--chip-bg)] hover:bg-primary/[0.08]"
              >
                <MoreVertical className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[13rem]">
              <DropdownMenuItem
                disabled={busy}
                onClick={() => {
                  if (
                    !window.confirm(
                      "Marcar que a limpeza NÃO será realizada? O card sai da fila e o valor da limpeza não será contabilizado.",
                    )
                  )
                    return;
                  void finish(true);
                }}
              >
                <Ban className="size-3.5 shrink-0" /> Limpeza não será realizada
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
