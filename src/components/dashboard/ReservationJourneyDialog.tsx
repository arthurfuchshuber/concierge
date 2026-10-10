/**
 * O HISTÓRICO DA RESERVA — mesma moldura das janelas novas (Registros, "Mais
 * registros"): capa do imóvel, "Proprietário: nome" com o ícone de mensagem
 * padrão e cartões. Layout aprovado no canvas em 05/10/2026 e REFATORADO em
 * 09/10/2026 (opção B do canvas, pedido explícito): UMA info por linha com o
 * rótulo à esquerda (Hóspede / Código / Período / Status), proprietário logo
 * abaixo do título na faixa de capa, Chegada/Saída em dois quadrados lado a
 * lado, e cartões da timeline com data/hora no canto superior direito e a
 * etiqueta (Pendência, Dano…) no canto inferior direito.
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
 *     cartão cortado (anticorte global das janelas, `useAntiClipWindow`).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { PhoneActionButton } from "@/components/PhoneActionButton";
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
function WhoLine({ actor, prefix }: { actor: JourneyActor; prefix?: string }) {
  const unknown = !actor.name;
  return (
    <div className="flex min-w-0 items-center gap-[7px]">
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
        {unknown ? "Autor não registrado" : prefix ? `${prefix} ${actor.name}` : actor.name}
      </span>
      {!unknown && actor.role && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
          {actor.role}
        </span>
      )}
    </div>
  );
}

/** Linha do quadro de infos: rótulo à esquerda, valor ao lado (uma info por linha). */
function InfoRow({ label, children, aside }: { label: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="grid h-[34px] grid-cols-[78px_minmax(0,1fr)] items-center gap-2 px-3">
      <span className="text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 truncate text-[13px] font-bold">{children}</span>
        {aside}
      </span>
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

/**
 * Uma linha da LINHA DO TEMPO ÚNICA (pedido explícito, 09/10/2026: "toda
 * movimentação, status e atividade deve seguir a ordem da timeline"): passos
 * da reserva e ações da equipe moram na MESMA esteira, no mesmo fio, na ordem
 * em que aconteceram. A bolinha fica sempre no MEIO do cartão.
 */
function TimelineRow({
  first,
  last,
  dot,
  children,
}: {
  first: boolean;
  last: boolean;
  dot: React.ReactNode;
  children: React.ReactNode;
}) {
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
      {dot}
      {children}
    </li>
  );
}

/** Um passo da esteira: o MESMO cartão para feito e pendente; bolinha no meio. */
function StepRow({ step, first, last }: { step: JourneyStep; first: boolean; last: boolean }) {
  const done = step.state === "done";
  const when = fmtWhen(step.at);
  return (
    <TimelineRow
      first={first}
      last={last}
      dot={
        <span
          className={`relative z-10 grid size-[22px] place-items-center rounded-full ${
            done ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-foreground/[0.06] text-transparent"
          }`}
        >
          {done && <Check className="size-3" strokeWidth={3} />}
        </span>
      }
    >
      <div className="flex min-w-0 flex-col gap-1 rounded-[var(--win-radius)] bg-foreground/[0.04] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`min-w-0 truncate text-[13.5px] ${done ? "font-semibold" : "font-medium text-muted-foreground"}`}>
            {step.label}
          </span>
          {when && <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">{when}</span>}
        </div>
        {step.detail && <p className="text-xs leading-snug text-muted-foreground">{step.detail}</p>}
        {step.actor && <WhoLine actor={step.actor} prefix="Feito por" />}
      </div>
    </TimelineRow>
  );
}

/**
 * "Aberta por Esther Villar", "Registrado por…" (pedido explícito, 09/10/2026):
 * o nome de quem fez vem sempre precedido do verbo da ação, nunca solto nem
 * separado por "·". Pendência usa o próprio estado (Aberta/Concluída/Arquivada).
 */
function whoVerb(item: JourneyActivity): { prefix: string; hideSub: boolean } {
  if (item.tag === "Pendência") {
    const st = item.sub === "Concluída" || item.sub === "Arquivada" || item.sub === "Aberta" ? item.sub : "Aberta";
    return { prefix: `${st} por`, hideSub: item.sub === st };
  }
  if (item.tag === "Registro") return { prefix: "Registrado por", hideSub: false };
  if (item.tag === "Previsão") return { prefix: "Alterado por", hideSub: false };
  return { prefix: "Feito por", hideSub: false };
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

/** Uma ação da equipe NA timeline: bolinha menor (ponto), mesmo fio e mesmo cartão. */
function ActivityRow({
  item,
  first,
  last,
  onOpen,
}: {
  item: JourneyActivity;
  first: boolean;
  last: boolean;
  onOpen?: () => void;
}) {
  const when = fmtWhen(item.at) ?? "";
  const verb = whoVerb(item);
  const clickable = item.opens && onOpen;
  const Tag = clickable ? "button" : "div";
  return (
    <TimelineRow
      first={first}
      last={last}
      dot={
        <span className="relative z-10 grid size-[22px] place-items-center rounded-full bg-[var(--panel)]">
          <span className="size-2 rounded-full bg-foreground/30" />
        </span>
      }
    >
      <Tag
        {...(clickable ? { type: "button" as const, onClick: onOpen } : {})}
        className={`flex min-w-0 w-full flex-col gap-1 rounded-[var(--win-radius)] bg-foreground/[0.04] px-3 py-2.5 text-left ${
          clickable ? "transition-colors hover:bg-foreground/[0.07]" : ""
        }`}
      >
        {/* Linha 1: título à esquerda, data/hora no canto superior direito. */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0 text-[13px] font-semibold leading-snug">{item.title}</div>
          {when && <span className="shrink-0 whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">{when}</span>}
        </div>
        {item.sub && !verb.hideSub && <div className="text-xs text-muted-foreground">{item.sub}</div>}
        {/* Última linha: quem fez à esquerda, etiqueta no canto inferior direito. */}
        <div className="flex items-end justify-between gap-2">
          <WhoLine actor={item.actor} prefix={verb.prefix} />
          <span
            className={`shrink-0 rounded px-[6px] py-px text-[8.5px] font-extrabold uppercase tracking-[0.04em] ${TAG_STYLE[item.tag]}`}
          >
            {item.tag}
          </span>
        </div>
      </Tag>
    </TimelineRow>
  );
}

type TimelineEntry =
  | { kind: "step"; step: JourneyStep }
  | { kind: "activity"; item: JourneyActivity };

/**
 * Junta passos e ações numa ordem só. Passos mantêm a sequência original; cada
 * ação entra antes do primeiro passo JÁ DATADO que aconteceu depois dela (ou,
 * se nenhum, logo após o último passo feito — antes dos pendentes). Ações da
 * mesma hora mantêm a ordem em que o servidor as mandou, invertida para
 * cronológica (o servidor manda a mais recente primeiro).
 */
export function mergeTimeline(steps: JourneyStep[], activity: JourneyActivity[]): TimelineEntry[] {
  const ts = (iso: string | null) => (iso ? new Date(iso).getTime() : NaN);
  const acts = [...activity].reverse().sort((a, b) => ts(a.at) - ts(b.at) || 0);
  const out: TimelineEntry[] = [];
  let ai = 0;
  const lastDoneIdx = steps.reduce((acc, st, i) => (st.state === "done" ? i : acc), -1);
  steps.forEach((st, i) => {
    const t = ts(st.at);
    if (st.state === "done" && !Number.isNaN(t)) {
      while (ai < acts.length && ts(acts[ai]!.at) <= t) out.push({ kind: "activity", item: acts[ai++]! });
    }
    out.push({ kind: "step", step: st });
    if (i === lastDoneIdx) {
      while (ai < acts.length) out.push({ kind: "activity", item: acts[ai++]! });
    }
  });
  while (ai < acts.length) out.push({ kind: "activity", item: acts[ai++]! });
  return out;
}

export function ReservationJourneyDialog({
  open,
  onOpenChange,
  logId,
  reservationId,
  predictionEditor,
  cleaningEditor,
  guestAside,
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
  /**
   * Ícone do chat/telefone do hóspede e a "quantidade" (+N acompanhantes) ao
   * lado do nome — os mesmos controles do card (pedido explícito, 09/10/2026).
   * Chegam como nó pronto: o telefone e a lista de acompanhantes moram no card.
   */
  guestAside?: React.ReactNode;
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
    retry: 1,
    retryDelay: 800,
  });

  const periodo = [fmtDateBR(data?.checkinDate ?? null), fmtDateBR(data?.checkoutDate ?? null)]
    .filter(Boolean)
    .join(" → ");
  const timeline = useMemo(() => mergeTimeline(data?.steps ?? [], data?.activity ?? []), [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sem `left/top` próprios: o DialogContent já é CENTRALIZADO na tela. */}
      <DialogContent
        className="flex max-h-[75dvh] w-[min(420px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="relative h-[88px] shrink-0 overflow-hidden bg-secondary/60">
          <CoverImage urls={data?.propertyCoverUrls ?? []} empty={false} />
          {/* Degradê ESCURO até embaixo (não mais até `--panel`): no tema claro
              o texto branco do título/proprietário precisa de fundo escuro. */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-black/35 to-black/70" />
          <div className="absolute bottom-2 left-[18px] right-12">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/80">{title}</div>
            <DialogTitle
              className="mt-[3px] block truncate text-[16px] font-bold leading-tight tracking-tight text-white"
              title={data?.propertyName ?? undefined}
            >
              {data?.propertyName ?? (isLoading ? "Carregando…" : "Reserva")}
            </DialogTitle>
            {data?.ownerName ? (
              <div className="mt-[3px] flex min-w-0 items-center gap-0 text-[11.5px] font-medium text-white/90">
                <span className="truncate">{ownerLabel(data.ownerName)}</span>
                <PhoneActionButton
                  phone={data.ownerPhone}
                  country={data.ownerPhoneCountry}
                  size={14}
                  alwaysShow
                  className="shrink-0"
                />
              </div>
            ) : null}
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
            <div className="flex shrink-0 flex-col gap-1.5 px-4 pb-1 pt-3">
              {/* Uma info por linha, rótulo à esquerda (opção B, 09/10/2026). */}
              <div className="divide-y divide-foreground/[0.08] overflow-hidden rounded-[var(--win-radius)] bg-foreground/[0.04]">
                {data.guestName && <InfoRow label="Hóspede" aside={guestAside}>{data.guestName}</InfoRow>}
                {data.reservationCode && data.reservationCode !== data.guestName && (
                  <InfoRow label="Código">{data.reservationCode}</InfoRow>
                )}
                {periodo && <InfoRow label="Período">{periodo}</InfoRow>}
                <InfoRow label="Status">
                  <span className="inline-flex items-center gap-[7px]">
                    <span className="size-[7px] shrink-0 rounded-full bg-emerald-500/80" />
                    {data.statusLabel}
                  </span>
                </InfoRow>
              </div>
              {predictionEditor}
            </div>

            <div
              className="sg-elegant-scroll grid min-h-0 min-w-0 flex-1 snap-y snap-proximity grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-y-auto overscroll-contain px-3 pb-4"
            >
              {cleaningEditor && (
                <>
                  <SectionTitle>Limpeza</SectionTitle>
                  <div>{cleaningEditor}</div>
                </>
              )}

              <div className={cleaningEditor ? "pt-2" : ""}>
                <SectionTitle>Jornada</SectionTitle>
              </div>
              <ol className="flex flex-col">
                {timeline.map((e, i) =>
                  e.kind === "step" ? (
                    <StepRow key={e.step.key} step={e.step} first={i === 0} last={i === timeline.length - 1} />
                  ) : (
                    <ActivityRow
                      key={e.item.id}
                      item={e.item}
                      first={i === 0}
                      last={i === timeline.length - 1}
                      onOpen={onOpenRecords}
                    />
                  ),
                )}
              </ol>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
