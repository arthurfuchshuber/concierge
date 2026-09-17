import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Clock3, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  decideCleaningApproval,
  listCleaningApprovals,
  type CleaningApprovalItem,
} from "@/lib/cleaning-approval.functions";

/**
 * "LIMPEZAS COMPLETAS PARA APROVAR" — aba Limpeza (mockup aprovado,
 * 17/09/2026: bloco com borda de luz, mesma linguagem do bloco de atenção dos
 * Registros, em âmbar porque aqui é espera e não problema).
 *
 * Aparece só quando existe completa pendente. Quem pode aprovar vê os dois
 * botões; os demais (ex.: o prestador que concluiu) veem a mesma lista com a
 * etiqueta "Aguardando aprovação", para saber que o pedido chegou.
 */

export const CLEANING_APPROVALS_KEY = "dash-cleaning-approvals";

function brl(cents: number | null): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "hoje, 14:20" / "ontem, 16:05" / "12/09, 09:30" — fuso de São Paulo. */
function whenLabel(iso: string | null): string {
  if (!iso) return "";
  const tz = "America/Sao_Paulo";
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pt-BR", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
  const today = day(new Date());
  const yesterday = day(new Date(Date.now() - 86_400_000));
  const dd = day(d);
  if (dd === today) return `hoje, ${time}`;
  if (dd === yesterday) return `ontem, ${time}`;
  const short = d.toLocaleDateString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit" });
  return `${short}, ${time}`;
}

export function CleaningApprovalPanel({
  ownerId,
  propertyIds,
  enabled,
}: {
  ownerId: string | null;
  propertyIds?: string[];
  enabled: boolean;
}) {
  const listFn = useServerFn(listCleaningApprovals);
  const decideFn = useServerFn(decideCleaningApproval);
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const q = useQuery({
    queryKey: [CLEANING_APPROVALS_KEY, ownerId ?? "self", propertyIds?.join(",") ?? ""],
    queryFn: () => listFn({ data: { ownerId, propertyIds } }),
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    enabled,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "approve" | "normal" }) =>
      decideFn({ data: { ...v, ownerId } }),
    onMutate: (v) => setBusyId(v.id),
    onSuccess: (res) => {
      toast.success(
        res.status === "approved"
          ? "Limpeza completa aprovada — já entrou no custo."
          : "Registrada como limpeza normal.",
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Não foi possível registrar a decisão.");
    },
    onSettled: () => {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: [CLEANING_APPROVALS_KEY] });
      void qc.invalidateQueries({ queryKey: ["dash-cleaning-stats"] });
    },
  });

  const items = q.data?.items ?? [];
  if (items.length === 0) return null;
  const canApprove = q.data?.canApprove === true;

  return (
    <section
      aria-label="Limpezas completas para aprovar"
      className="mt-1.5 rounded-[0.5rem] bg-gradient-to-b from-amber-400/45 via-amber-400/[0.06] to-amber-400/[0.03] p-px"
    >
      <div className="rounded-[calc(0.5rem-1px)] bg-gradient-to-b from-[color-mix(in_oklab,#fbbf24_7%,var(--background))] to-background to-75% px-1.5 pb-1.5 pt-3">
        <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-[22px] shrink-0 place-items-center rounded-md bg-amber-400/15 text-amber-500 dark:text-amber-400">
              <Clock3 className="size-[13px]" strokeWidth={2.2} />
            </span>
            <h2 className="truncate font-display text-[13px] font-bold">
              Limpezas completas para aprovar
            </h2>
          </div>
          <span className="shrink-0 text-[11px] font-extrabold tabular-nums text-amber-500 dark:text-amber-400">
            {items.length}
          </span>
        </div>
        <p className="px-1.5 pb-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {canApprove
            ? "Só entram no custo depois de aprovadas. “Foi normal” registra com o valor da limpeza normal."
            : "Só entram no custo depois que o gestor aprovar."}
        </p>
        <div className="grid gap-1.5 lg:grid-cols-2">
          {items.map((it) => (
            <ApprovalRow
              key={it.id}
              item={it}
              canApprove={canApprove}
              busy={busyId === it.id}
              disabled={decide.isPending}
              onDecide={(decision) => decide.mutate({ id: it.id, decision })}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ApprovalRow({
  item,
  canApprove,
  busy,
  disabled,
  onDecide,
}: {
  item: CleaningApprovalItem;
  canApprove: boolean;
  busy: boolean;
  disabled: boolean;
  onDecide: (decision: "approve" | "normal") => void;
}) {
  const meta = [whenLabel(item.concludedAt), item.doneByName ? `por ${item.doneByName}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="ds-3d flex flex-col gap-2.5 rounded-[0.3rem] bg-card p-3">
      <div className="flex justify-between gap-2.5">
        <div className="min-w-0">
          <span className="ds-card-title block">{item.propertyName}</span>
          {meta && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{meta}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className="font-display text-[15px] font-bold tabular-nums">{brl(item.priceCents)}</p>
          {item.normalPriceCents != null && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              normal: {brl(item.normalPriceCents)}
            </p>
          )}
        </div>
      </div>
      {canApprove ? (
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecide("normal")}
            className="h-10 rounded-md border border-border text-[12.5px] font-bold transition-colors hover:bg-secondary/50 disabled:opacity-60"
          >
            Foi normal
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDecide("approve")}
            className="flex h-10 items-center justify-center gap-1.5 rounded-md bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[12.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            Aprovar completa
          </button>
        </div>
      ) : (
        <p className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-amber-500 dark:text-amber-400">
          Aguardando aprovação
        </p>
      )}
    </div>
  );
}
