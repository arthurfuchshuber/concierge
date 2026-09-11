/**
 * O HISTÓRICO DA RESERVA, na mesma moldura dos outros popups do quadro
 * (Pendências, Limpeza Prevista 7d): largura `sm:max-w-lg`, cabeçalho com
 * `ds-page-title` + `ds-page-subtitle`, corpo rolável em `sg-elegant-scroll`.
 * Pedido explícito (08/09/2026): "precisa seguir o mesmo layout padrão que já
 * implementamos".
 *
 * As cores das linhas vêm de `card-colors.ts` — as MESMAS do card que abriu
 * este popup: proprietário no rosa, período na cor do estado. Um histórico
 * pintado com outra régua faria a pessoa reaprender o significado das cores
 * ao atravessar dois cliques.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, ListChecks, Paperclip } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getReservationJourney, type JourneyStep } from "@/lib/reservation-journey.functions";
import { CARD_MUTED, CARD_OWNER, periodColorClass } from "@/components/dashboard/card-colors";

function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return null;
  }
}

function fmtDateBR(d: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-");
  return day ? `${day}/${m}/${y}` : d;
}

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: "Aberta",
  done: "Concluída",
  canceled: "Arquivada",
};

/** Um passo da esteira: bolinha, rótulo, quando aconteceu e o detalhe. */
function StepRow({ step, last }: { step: JourneyStep; last: boolean }) {
  const done = step.state === "done";
  const when = fmtWhen(step.at);
  return (
    <li className="relative flex gap-3 pb-3 last:pb-0">
      {/* Fio vertical ligando os passos — some no último, senão vira um
          traço solto abaixo do fim da jornada. */}
      {!last && <span aria-hidden className="absolute left-[7px] top-4 bottom-0 w-px bg-border" />}
      <span
        className={`relative z-10 mt-1 grid size-3.5 shrink-0 place-items-center rounded-full border ${
          done
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "border-border bg-card text-transparent"
        }`}
      >
        {done && <Check className="size-2.5" />}
      </span>
      <div className="min-w-0 flex-1 ds-card-lines">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[13px] font-medium ${done ? "" : CARD_MUTED}`}>{step.label}</span>
          {when && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{when}</span>
          )}
        </div>
        {step.detail && (
          <p className="text-[11.5px] leading-snug text-muted-foreground">{step.detail}</p>
        )}
      </div>
    </li>
  );
}

export function ReservationJourneyDialog({
  open,
  onOpenChange,
  logId,
  reservationId,
  predictionEditor,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Só uuid de verdade — a chave sintética "ical:<id>" não vale aqui. */
  logId: string | null;
  reservationId: string | null;
  /**
   * Chegada e saída, as duas editáveis (pedido explícito, 08/09/2026).
   *
   * Chega pronto do card, como nó já montado, e não como dados: o editor de
   * previsão vive dentro do quadro (é lá que estão as duas listas da esteira
   * e a gravação otimista), e importá-lo daqui criaria um ciclo — o quadro já
   * importa este diálogo. Passar o nó pronto mantém uma única implementação
   * de gravação, que é a mesma regra que vale para as ações do assistente.
   */
  predictionEditor?: React.ReactNode;
}) {
  const fn = useServerFn(getReservationJourney);
  const { data, isLoading, error } = useQuery({
    queryKey: ["reservation-journey", logId, reservationId],
    queryFn: () => fn({ data: { logId, reservationId } }),
    enabled: open && (!!logId || !!reservationId),
    staleTime: 15_000,
  });

  const periodo = [fmtDateBR(data?.checkinDate ?? null), fmtDateBR(data?.checkoutDate ?? null)]
    .filter(Boolean)
    .join(" → ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2.5rem)] sm:w-full sm:max-w-lg p-0 overflow-hidden rounded-lg border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl">
        <DialogTitle className="sr-only">Histórico da reserva</DialogTitle>
        <DialogDescription className="sr-only">
          A jornada completa desta reserva: chegada, estadia, saída, limpeza e conclusão.
        </DialogDescription>

        <div className="px-5 pt-5 pb-3">
          <h2 className="ds-page-title min-w-0 truncate pr-9">Histórico da reserva</h2>
          <p className="ds-page-subtitle mt-1.5 truncate">
            {data?.guestName ?? (isLoading ? "Carregando…" : "Reserva")}
            {data?.reservationCode ? ` · ${data.reservationCode}` : ""}
          </p>
        </div>

        <div className="sg-elegant-scroll max-h-[70vh] overflow-y-auto px-5 pb-5 space-y-4">
          {isLoading ? (
            <div className="py-12 grid place-items-center text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : error || !data ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Não consegui carregar o histórico desta reserva.
            </div>
          ) : (
            <>
              {/* Cabeçalho de identidade — mesmas cores do card de origem. */}
              <div className="ds-surface ds-card-lines border border-border/60 bg-secondary/30 px-3 py-2.5">
                {data.ownerName && (
                  <div className={`truncate text-xs ${CARD_OWNER}`}>{data.ownerName}</div>
                )}
                <div className="ds-card-title truncate">{data.propertyName ?? "Sem nome"}</div>
                {periodo && (
                  <div className={`text-xs ${periodColorClass({ kind: "checkin" })}`}>
                    {periodo}
                  </div>
                )}
              </div>

              {predictionEditor && (
                <div>
                  <p className="ds-eyebrow mb-2 text-muted-foreground">Previsão</p>
                  {predictionEditor}
                </div>
              )}

              <div>
                <p className="ds-eyebrow mb-2 text-muted-foreground">Jornada</p>
                <ol className="relative">
                  {data.steps.map((s, i) => (
                    <StepRow key={s.key} step={s} last={i === data.steps.length - 1} />
                  ))}
                </ol>
              </div>

              {data.tasks.length > 0 && (
                <div>
                  <p className="ds-eyebrow mb-2 text-muted-foreground">Pendências desta reserva</p>
                  <ul className="ds-list">
                    {data.tasks.map((t) => (
                      <li
                        key={t.id}
                        className="ds-surface flex items-start gap-2 bg-secondary/40 px-2.5 py-2"
                      >
                        <ListChecks className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0 flex-1 ds-card-lines">
                          <div
                            className={`text-xs font-semibold leading-snug ${
                              t.status === "done" ? "line-through text-muted-foreground" : ""
                            }`}
                          >
                            {t.title}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground">
                            {TASK_STATUS_LABEL[t.status] ?? t.status}
                            {t.dueDate ? ` · ${fmtDateBR(t.dueDate)}` : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Os registros (fotos, áudios, notas) continuam vivendo no seu
                  próprio diálogo, aberto pelo clipe do card — aqui só a
                  contagem, para a pessoa saber que existem. Duplicar a linha
                  do tempo de anexos aqui dentro seria manter duas telas
                  contando a mesma coisa. */}
              {data.recordsCount > 0 && (
                <p className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <Paperclip className="size-3 shrink-0" />
                  {data.recordsCount} {data.recordsCount === 1 ? "registro" : "registros"} nesta
                  reserva — abra pelo clipe no card.
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
