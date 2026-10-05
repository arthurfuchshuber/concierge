/**
 * O HISTÓRICO DA RESERVA — mesma moldura das janelas novas (Registros, "Mais
 * registros"): capa do imóvel, "Proprietário: nome" com o ícone de mensagem
 * padrão, pílula de status e cartões. Layout aprovado no canvas em 05/10/2026.
 *
 *   · TODOS os passos usam o mesmo cartão (feitos ou pendentes), com a bolinha
 *     sempre no MEIO do cartão e o fio contínuo (primeiro/último começam e
 *     terminam no meio);
 *   · cada ação mostra QUEM fez (iniciais + nome + papel) e o horário exato;
 *     dado anterior ao registro de autoria mostra "Autor não registrado";
 *   · "Atividade" fica abaixo da "Jornada", na mesma janela; registros e
 *     pendências abrem o item ao tocar;
 *   · a janela é SEMPRE centralizada na tela (DialogContent) e limitada a 75%
 *     da altura: cabeçalho fixo, só o corpo rola, e a rolagem não deixa um
 *     cartão cortado (`useAntiClipRows`).
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { useAntiClipRows } from "@/hooks/useAntiClipRows";
import {
  getReservationJourney,
  type JourneyActivity,
  type JourneyActor,
  type JourneyStep,
} from "@/lib/reservation-journey.functions";
import { ownerLabel } from "@/components/dashboard/card-colors";

/** "04/10 · 15:46" no fuso de São Paulo — hora exata, não "há 1 dia". */
function fmtWhen(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("day")}/${g("month")} · ${g("hour")}:${g("minute")}`;
}

function fmtDateBR(d: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-");
  return day ? `${day}/${m}/${y}` : d;
}

function initialsOf(name: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const AVATAR: Record<string, string> = {
  Equipe: "bg-foreground/10 text-foreground/80",
  Prestador: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Hóspede": "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Sistema: "bg-foreground/[0.08] text-muted-foreground",
};

/** Quem fez: avatar com iniciais, nome e papel. Sem nome → "Autor não registrado". */
function WhoLine({ actor }: { actor: JourneyActor }) {
  const unknown = !actor.name;
  return (
    <div className="mt-2 flex min-w-0 items-center gap-[7px]">
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full text-[8.5px] font-extrabold ${
          unknown ? AVATAR.Sistema : AVATAR[actor.role ?? "Sistema"]
        }`}
      >
        {unknown ? "?" : initialsOf(actor.name)}
      </span>
      <span
        className={`min-w-0 truncate text-xs ${unknown ? "font-medium italic text-muted-foreground" : "font-semibold"}`}
      >
        {unknown ? "Autor não registrado" : actor.name}
      </span>
      {!unknown && actor.role && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {actor.role}
        </span>
      )}
    </div>
  );
}

function SectionTitle({ children, extra }: { children: React.ReactNode; extra?: string }) {
  return (
    <div className="flex snap-start items-center gap-2.5 px-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
      {children}
      {extra && <em className="not-italic tracking-[0.04em] text-muted-foreground/60">{extra}</em>}
      <i className="h-px flex-1 bg-foreground/[0.08]" />
    </div>
  );
}

/** Um passo da esteira: o MESMO cartão para feito e pendente; bolinha no meio. */
function StepRow({ step, first, last }: { step: JourneyStep; first: boolean; last: boolean }) {
  const done = step.state === "done";
  const when = fmtWhen(step.at);
  return (
    <li data-clip-row className="relative grid snap-start grid-cols-[22px_minmax(0,1fr)] items-center gap-2.5 py-1">
      {/* Fio contínuo: o primeiro começa e o último termina no MEIO do cartão. */}
      {!(first && last) && (
        <span
          aria-hidden
          className="absolute left-[10.5px] w-px bg-foreground/10"
          style={{ top: first ? "50%" : 0, bottom: last ? "50%" : 0 }}
        />
      )}
      <span
        className={`relative z-10 grid size-[22px] place-items-center rounded-full ${
          done ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-foreground/[0.06] text-transparent"
        }`}
      >
        {done && <Check className="size-3" strokeWidth={3} />}
      </span>
      <div className="min-w-0 rounded-2xl bg-foreground/[0.04] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`text-[13.5px] ${done ? "font-semibold" : "font-medium text-muted-foreground"}`}>
            {step.label}
          </span>
          {when && <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">{when}</span>}
        </div>
        {step.detail && <p className="mt-[3px] text-xs leading-snug text-muted-foreground">{step.detail}</p>}
        {step.actor && <WhoLine actor={step.actor} />}
      </div>
    </li>
  );
}

const TAG_STYLE: Record<JourneyActivity["tag"], string> = {
  Registro: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  "Pendência": "bg-rose-500/15 text-rose-600 dark:text-rose-400",
  "Previsão": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "Check-in": "bg-foreground/10 text-muted-foreground",
  "Check-out": "bg-foreground/10 text-muted-foreground",
  Limpeza: "bg-foreground/10 text-muted-foreground",
  "Formulário": "bg-foreground/10 text-muted-foreground",
  Reserva: "bg-foreground/10 text-muted-foreground",
};

/** Uma linha da Atividade: hora à esquerda, o que foi feito e por quem. */
function ActivityRow({ item, onOpen }: { item: JourneyActivity; onOpen?: () => void }) {
  const when = fmtWhen(item.at) ?? "";
  const [day, time] = when.split(" · ");
  const clickable = item.opens && onOpen;
  const Tag = clickable ? "button" : "div";
  return (
    <Tag
      {...(clickable ? { type: "button" as const, onClick: onOpen } : {})}
      data-clip-row
      className={`grid w-full snap-start grid-cols-[44px_minmax(0,1fr)] gap-2.5 rounded-2xl bg-foreground/[0.04] px-3 py-2.5 text-left ${
        clickable ? "transition-colors hover:bg-foreground/[0.07]" : ""
      }`}
    >
      <div className="text-[11.5px] leading-[1.3] tabular-nums text-muted-foreground">
        <div className="text-[12.5px] font-bold text-foreground">{time}</div>
        <div>{day}</div>
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-snug">
          <span
            className={`mr-1.5 inline-block rounded px-[5px] py-px align-[1px] text-[8.5px] font-extrabold uppercase tracking-[0.04em] ${TAG_STYLE[item.tag]}`}
          >
            {item.tag}
          </span>
          {item.title}
        </div>
        {item.sub && <div className="mt-0.5 text-xs text-muted-foreground">{item.sub}</div>}
        <WhoLine actor={item.actor} />
      </div>
    </Tag>
  );
}

export function ReservationJourneyDialog({
  open,
  onOpenChange,
  logId,
  reservationId,
  predictionEditor,
  cleaningEditor,
  onOpenRecords,
  title = "Histórico da reserva",
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
  /** Seção editável da limpeza (tipo, valor, ações) — cards em limpeza. */
  cleaningEditor?: React.ReactNode;
  /** Toque num registro/pendência da Atividade: o card fecha esta janela e abre os registros. */
  onOpenRecords?: () => void;
  title?: string;
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
  const bodyRef = useAntiClipRows<HTMLDivElement>([data?.steps.length, data?.activity.length]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sem `left/top` próprios: o DialogContent já é CENTRALIZADO na tela. */}
      <DialogContent
        className="flex max-h-[75dvh] w-[min(420px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="relative h-[112px] shrink-0 overflow-hidden bg-secondary/60">
          <CoverImage urls={data?.propertyCoverUrls ?? []} empty={false} />
          <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-black/55 to-[var(--panel)]" />
          <div className="absolute bottom-2 left-[18px] right-12">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">{title}</div>
            <DialogTitle
              className="mt-[3px] block truncate text-[17px] font-bold leading-tight tracking-tight text-white"
              title={data?.propertyName ?? undefined}
            >
              {data?.propertyName ?? (isLoading ? "Carregando…" : "Reserva")}
            </DialogTitle>
          </div>
        </div>
        <DialogDescription className="sr-only">
          A jornada completa desta reserva: chegada, estadia, saída, limpeza e conclusão, com quem fez cada ação.
        </DialogDescription>

        {isLoading ? (
          <div className="grid place-items-center py-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : error || !data ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            Não consegui carregar o histórico desta reserva.
          </div>
        ) : (
          <>
            <div className="flex shrink-0 flex-col gap-2 px-[18px] pb-3 pt-1.5">
              <div className="flex min-w-0 items-center justify-between gap-2.5">
                <div className="flex min-w-0 items-center gap-0 text-xs text-muted-foreground">
                  {data.ownerName ? (
                    <>
                      <span className="truncate">{ownerLabel(data.ownerName)}</span>
                      <PhoneActionButton
                        phone={data.ownerPhone}
                        country={data.ownerPhoneCountry}
                        size={14}
                        alwaysShow
                        className="shrink-0"
                      />
                    </>
                  ) : null}
                </div>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-[11px] py-[5px] text-[11.5px] font-semibold text-foreground">
                  <span className="size-1.5 rounded-full bg-emerald-500/80" />
                  {data.statusLabel}
                </span>
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {data.guestName && <b className="font-semibold text-foreground">{data.guestName}</b>}
                {data.reservationCode && data.reservationCode !== data.guestName ? ` · ${data.reservationCode}` : ""}
                {periodo ? ` · ${periodo}` : ""}
              </div>
            </div>

            <div
              ref={bodyRef}
              className="sg-elegant-scroll grid min-h-0 min-w-0 flex-1 snap-y snap-proximity grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-y-auto overscroll-contain px-3 pb-4"
            >
              {cleaningEditor && (
                <>
                  <SectionTitle>Limpeza</SectionTitle>
                  <div>{cleaningEditor}</div>
                </>
              )}
              {predictionEditor && (
                <>
                  <SectionTitle>Previsão</SectionTitle>
                  <div>{predictionEditor}</div>
                </>
              )}

              <div className={cleaningEditor || predictionEditor ? "pt-2" : ""}>
                <SectionTitle>Jornada</SectionTitle>
              </div>
              <ol className="flex flex-col">
                {data.steps.map((st, i) => (
                  <StepRow key={st.key} step={st} first={i === 0} last={i === data.steps.length - 1} />
                ))}
              </ol>

              {data.activity.length > 0 && (
                <>
                  <div className="pt-2">
                    <SectionTitle extra={`· ${data.activity.length} ${data.activity.length === 1 ? "ação" : "ações"}`}>
                      Atividade
                    </SectionTitle>
                  </div>
                  {data.activity.map((a) => (
                    <ActivityRow key={a.id} item={a} onOpen={onOpenRecords} />
                  ))}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
