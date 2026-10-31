/**
 * O HISTÓRICO DA RESERVA — layout "Opção C · foco no agora" (mockups aprovados no canvas, 31/10/2026),
 * implementado fielmente:
 *
 *   · CAPA fixa de 140 px com a foto do imóvel levemente desfocada (blur 1,5 px, 90% de brilho), etiqueta
 *     "HISTÓRICO DA RESERVA", título 14 px negrito e "Proprietário(a): nome" (chat) no MESMO bloco; X sólido;
 *   · LINHA DE ETAPAS (Reserva · Check-in · Estadia · Check-out · Limpeza) com a etapa atual destacada;
 *   · CARTÃO DO MOMENTO (faixa lateral na cor do status): título + "desde/chegada em" alinhados pelo topo,
 *     subtítulo (previsão em âmbar, tocável para editar) e as linhas Hóspede (chat à esquerda) · Período ·
 *     Recebido · Comissão — 21 px entre linhas, sem divisórias. Em limpeza traz Tipo/Valor/Prestador e a
 *     fileira de ações padrão (Finalizar Limpeza + quadrados 28 px). Cancelada: valores apagados e riscados;
 *   · HISTÓRICO enxuto, do mais recente para o mais antigo (data alinhada ao topo do título), etiquetas
 *     REGISTRO / PENDÊNCIA / PREVISÃO / LIMPEZA; registros e pendências abrem ao tocar;
 *   · tudo rola junto abaixo da capa (anticorte global das janelas), altura automática até 90% da tela.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CoverImage } from "@/components/ui/cover-image";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import {
  getReservationJourney,
  type JourneyActivity,
  type JourneyActor,
  type JourneyStep,
} from "@/lib/reservation-journey.functions";

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


const SAGE = "#7fb79a";
const ROSE = "#c98c8c";
const AMBER = "#c9a962";
const NODE_LABELS = ["Reserva", "Check-in", "Estadia", "Check-out", "Limpeza"];
type NodeState = "done" | "now" | "next" | "bad" | "skip";

/** Estado de cada uma das 5 etapas, a partir do status devolvido pelo servidor. */
function nodesFor(status: string): { labels: string[]; states: NodeState[] } {
  switch (status) {
    case "Concluída":
      return { labels: NODE_LABELS, states: ["done", "done", "done", "done", "done"] };
    case "Em limpeza":
      return { labels: NODE_LABELS, states: ["done", "done", "done", "done", "now"] };
    case "Em estadia":
      return { labels: NODE_LABELS, states: ["done", "done", "now", "next", "next"] };
    case "Cancelada":
      return { labels: ["Reserva", "Cancelada", "Check-in", "Check-out", "Limpeza"], states: ["done", "bad", "skip", "skip", "skip"] };
    case "Não compareceu":
      return { labels: ["Reserva", "Não compareceu", "Check-in", "Check-out", "Limpeza"], states: ["done", "bad", "skip", "skip", "skip"] };
    default:
      return { labels: NODE_LABELS, states: ["done", "now", "next", "next", "next"] };
  }
}

function Stepper({ status }: { status: string }) {
  const { labels, states } = nodesFor(status);
  return (
    <ol className="grid grid-cols-5" aria-label="Etapas da reserva">
      {labels.map((label, i) => {
        const st = states[i]!;
        const prev = states[i - 1];
        const lineColor =
          prev === "done" && (st === "done" || st === "now")
            ? SAGE
            : prev === "bad"
              ? ROSE
              : "color-mix(in oklab, var(--foreground) 12%, transparent)";
        return (
          <li key={label + i} className="relative flex min-w-0 flex-col items-center gap-[7px]">
            {i > 0 && (
              <span
                aria-hidden
                className="absolute top-[10px] h-0.5"
                style={{ left: "calc(-50% + 13px)", width: "calc(100% - 26px)", background: lineColor }}
              />
            )}
            {st === "done" ? (
              <span className="relative z-10 grid size-[22px] place-items-center rounded-full bg-[#1f2d27]">
                <Check className="size-3" style={{ color: SAGE }} strokeWidth={2.6} />
              </span>
            ) : st === "now" ? (
              <span className="relative z-10 grid size-[22px] place-items-center rounded-full border-2 bg-[var(--panel)]" style={{ borderColor: SAGE }}>
                <i className="size-2 rounded-full" style={{ background: SAGE }} />
              </span>
            ) : st === "bad" ? (
              <span className="relative z-10 grid size-[22px] place-items-center rounded-full bg-[#2d2124]">
                <X className="size-3" style={{ color: ROSE }} strokeWidth={2.6} />
              </span>
            ) : (
              <span
                className={`relative z-10 size-[22px] rounded-full border-[1.5px] bg-[var(--panel)] ${
                  st === "skip" ? "border-dashed" : "border-solid"
                } border-[#4a443f]`}
              />
            )}
            <span
              className={`max-w-full truncate text-center text-[10.5px] leading-[14px] ${
                st === "now" || st === "bad" ? "font-bold text-foreground" : "font-medium text-[#8f8781]"
              }`}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Linha do cartão: rótulo cinza à esquerda, valor em destaque à direita (21 px de passo, sem divisórias). */
function Row({ label, children, struck }: { label: string; children: React.ReactNode; struck?: boolean }) {
  return (
    <div className="flex h-[21px] items-center justify-between gap-4 text-xs leading-none">
      <span className="shrink-0 text-[#8f8781]">{label}</span>
      <span
        className={`flex min-w-0 items-center gap-1.5 truncate text-right ${
          struck ? "font-medium text-[#8f8781] line-through decoration-[1.5px]" : "font-semibold text-[#f4efea]"
        }`}
      >
        {children}
      </span>
    </div>
  );
}

const TAG_COLOR: Partial<Record<JourneyActivity["tag"], string>> = {
  Registro: SAGE,
  "Pendência": ROSE,
  "Previsão": AMBER,
  Limpeza: "#a39b95",
};

type HistoryRow = {
  id: string;
  title: string;
  at: string | null;
  detail: string;
  tag: JourneyActivity["tag"] | null;
  opens: boolean;
};

function whoText(actor: JourneyActor | null | undefined): string | null {
  if (!actor) return null;
  if (!actor.name) return "Autor não registrado";
  return actor.role ? `${actor.name} (${actor.role.toUpperCase()})` : actor.name;
}

function historyRows(timeline: TimelineEntry[]): HistoryRow[] {
  const out: HistoryRow[] = [];
  for (const e of timeline) {
    if (e.kind === "step") {
      if (e.step.state !== "done") continue;
      out.push({
        id: e.step.key,
        title: e.step.label,
        at: e.step.at,
        detail: [e.step.detail, whoText(e.step.actor)].filter(Boolean).join(" · "),
        tag: null,
        opens: false,
      });
    } else {
      const it = e.item;
      out.push({
        id: it.id,
        title: it.title,
        at: it.at,
        detail: [it.sub, whoText(it.actor)].filter(Boolean).join(" · "),
        tag: it.tag,
        opens: !!it.opens,
      });
    }
  }
  return out.reverse();
}

export function ReservationJourneyDialog({
  open,
  onOpenChange,
  logId,
  reservationId,
  predictionEditor,
  cleaningEditor,
  guestChat,
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
   * Previsão (chegada/saída) como texto âmbar TOCÁVEL, montado no card (é lá que vive o editor e a gravação
   * otimista; importá-lo aqui criaria um ciclo). Aparece na linha de subtítulo do cartão do momento.
   */
  predictionEditor?: React.ReactNode;
  /** Ícone do chat/telefone do hóspede — fica À ESQUERDA do nome (regra global de chat). */
  guestChat?: React.ReactNode;
  /** "+N acompanhantes" ao lado do nome. */
  guestAside?: React.ReactNode;
  /** Linhas Tipo/Valor/Prestador + fileira de ações da limpeza — entram dentro do cartão do momento. */
  cleaningEditor?: React.ReactNode;
  /** Toque num registro/pendência do Histórico: o card fecha esta janela e abre os registros. */
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

  const timeline = useMemo(() => mergeTimeline(data?.steps ?? [], data?.activity ?? []), [data]);
  const history = useMemo(() => historyRows(timeline), [timeline]);

  const brl = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: data?.payoutCurrency || "BRL" }).format(v);
  const periodo = (() => {
    const a = data?.checkinDate?.slice(0, 10);
    const b = data?.checkoutDate?.slice(0, 10);
    if (!a && !b) return null;
    const short = (d: string | undefined) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
    return `${short(a)} → ${b ? `${short(b)}/${b.slice(0, 4)}` : ""}`;
  })();

  const status = data?.statusLabel ?? "";
  const canceled = !!data?.canceled || status === "Cancelada";
  const stepAt = (key: JourneyStep["key"]) => data?.steps.find((s) => s.key === key)?.at ?? null;
  /** Cartão do momento: título, "desde/chegada em", subtítulo e a cor da faixa lateral. */
  const now = (() => {
    switch (status) {
      case "Concluída":
        return { bar: SAGE, title: "Concluída", since: fmtWhen(stepAt("concluido")), sub: "Esteira concluída", subCol: SAGE };
      case "Em limpeza":
        return { bar: AMBER, title: "Em limpeza", since: stepAt("checkout") ? `desde ${fmtWhen(stepAt("checkout"))}` : null, sub: "Limpeza em andamento", subCol: AMBER };
      case "Em estadia":
        return { bar: SAGE, title: "Em estadia", since: stepAt("checkin") ? `desde ${fmtWhen(stepAt("checkin"))}` : null, sub: null, subCol: AMBER };
      case "Cancelada":
        return { bar: ROSE, title: "Cancelada", since: fmtWhen(stepAt("cancelada")), sub: "Cancelada na plataforma", subCol: ROSE };
      case "Não compareceu":
        return { bar: ROSE, title: "Não compareceu", since: fmtWhen(stepAt("no_show")), sub: data?.steps.find((x) => x.key === "no_show")?.detail ?? "Hóspede não compareceu", subCol: ROSE };
      default:
        return {
          bar: AMBER,
          title: "Aguardando check-in",
          since: data?.checkinDate ? `chegada em ${fmtDateBR(data.checkinDate)?.slice(0, 5)}` : null,
          sub: null,
          subCol: AMBER,
        };
    }
  })();
  const showEditorSub = status === "Em estadia" || status === "Aguardando chegada" || status === "";
  const showPaid = true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sem `left/top` próprios: o DialogContent já é CENTRALIZADO na tela. */}
      <DialogContent
        className="flex max-h-[90dvh] w-[min(420px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="relative h-[140px] shrink-0 overflow-hidden bg-secondary/60">
          {/* Foto levemente desfocada (regra de capa, 31/10/2026): blur 1,5 px, 90% de brilho, ampliada 4%. */}
          <div className="absolute inset-0 origin-center scale-[1.04] [filter:blur(1.5px)_brightness(.9)]">
            <CoverImage urls={data?.propertyCoverUrls ?? []} empty={false} />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_25%,rgba(0,0,0,.7)_100%)] dark:bg-[linear-gradient(180deg,rgba(34,30,27,0)_25%,rgba(34,30,27,.82)_100%)]" />
          <div className="absolute inset-x-4 bottom-2.5 min-w-0 pr-8">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-white/90">{title}</div>
            <DialogTitle
              className="mt-1 block truncate text-sm font-bold leading-[18px] text-white"
              title={data?.propertyName ?? undefined}
            >
              {data?.propertyName ?? (isLoading ? "Carregando…" : "Reserva")}
            </DialogTitle>
            {data?.ownerName ? (
              <OwnerLine
                name={data.ownerName}
                phone={data.ownerPhone}
                country={data.ownerPhoneCountry}
                phonePosition="adjacent"
                className="mt-0.5 [&>span:first-child]:text-white/70 [&>span:nth-child(2)]:text-white"
              />
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
          /* Só a CAPA é fixa; etapas, cartão do momento e histórico rolam juntos (anticorte global: cada bloco/linha
             é uma unidade `data-clip-row`). 16 px de recuo nos dois lados e 16 px de base. */
          <div className="sg-elegant-scroll grid min-h-0 min-w-0 flex-1 snap-y snap-proximity grid-cols-[minmax(0,1fr)] content-start overflow-y-auto overscroll-contain px-4 pb-4 pt-[18px]">
            <div data-clip-row className="snap-start">
              <Stepper status={status} />
            </div>

            {/* CARTÃO DO MOMENTO */}
            <div
              data-clip-row
              className="relative mt-[18px] snap-start overflow-hidden rounded-[12px] border border-foreground/[0.07] bg-[var(--card-surface)] py-3 pl-4 pr-3.5"
            >
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: now.bar }} />
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-bold leading-[18px]">{now.title}</span>
                {now.since && (
                  <span className="mt-[1px] shrink-0 whitespace-nowrap text-[11.5px] leading-[15px] text-muted-foreground">
                    {now.since}
                  </span>
                )}
              </div>
              {showEditorSub && predictionEditor ? (
                <div className="mt-[7px] flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold" style={{ color: AMBER }}>
                  {predictionEditor}
                </div>
              ) : now.sub ? (
                <p className="mt-[7px] text-xs font-semibold leading-[15px]" style={{ color: now.subCol }}>
                  {now.sub}
                </p>
              ) : null}

              <div className="mt-3.5 grid">
                {data.guestName && (
                  <Row label="Hóspede">
                    {guestChat}
                    <span className="min-w-0 truncate">{data.guestName}</span>
                    {guestAside}
                  </Row>
                )}
                {cleaningEditor ? (
                  cleaningEditor
                ) : (
                  <>
                    {data.reservationCode && data.reservationCode !== data.guestName && (
                      <Row label="Código">{data.reservationCode}</Row>
                    )}
                    {periodo && (
                      <Row label="Período" struck={canceled}>
                        {periodo}
                      </Row>
                    )}
                    {showPaid && (
                      <Row label="Recebido" struck={canceled && data.payoutAmount != null}>
                        {data.payoutAmount != null ? brl(data.payoutAmount) : "—"}
                      </Row>
                    )}
                    {data.payoutCommission != null && (
                      <Row label="Comissão" struck={canceled}>
                        {brl(data.payoutCommission)}
                      </Row>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* HISTÓRICO — mais recente primeiro */}
            {history.length > 0 && (
              <>
                <div data-clip-row className="mt-4 snap-start text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[#b4aca6]">
                  Histórico
                </div>
                <ol className="relative mt-3">
                  {history.map((h, i) => {
                    const when = fmtWhen(h.at);
                    const tagCol = h.tag ? TAG_COLOR[h.tag] : undefined;
                    const Tag = h.opens && onOpenRecords ? "button" : "div";
                    return (
                      <li key={h.id} data-clip-row className="relative snap-start">
                        {history.length > 1 && (
                          <span
                            aria-hidden
                            className="absolute left-[10.5px] w-px bg-foreground/10"
                            style={{ top: i === 0 ? 12 : 0, bottom: i === history.length - 1 ? "calc(100% - 12px)" : 0 }}
                          />
                        )}
                        <span aria-hidden className="absolute left-2 top-[8.5px] z-10 size-[7px] rounded-full bg-[#5f5852]" />
                        <Tag
                          {...(Tag === "button" ? { type: "button" as const, onClick: onOpenRecords } : {})}
                          className="block min-h-[46px] w-full pl-[30px] text-left"
                        >
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0 truncate text-[13px] font-bold leading-[17px]">{h.title}</span>
                            {when && (
                              <span className="mt-[0.5px] shrink-0 whitespace-nowrap text-[11.5px] leading-[15px] text-muted-foreground">
                                {when}
                              </span>
                            )}
                          </span>
                          <span className="mt-[3px] flex items-center justify-between gap-3 pb-2.5">
                            <span className="min-w-0 truncate text-[11.5px] leading-[15px] text-muted-foreground">{h.detail}</span>
                            {tagCol && h.tag && (
                              <span
                                className="shrink-0 rounded-[5px] px-[7px] py-[2px] text-[9px] font-extrabold uppercase leading-[12px] tracking-[0.06em]"
                                style={{ color: tagCol, background: `color-mix(in oklab, ${tagCol} 14%, transparent)` }}
                              >
                                {h.tag}
                              </span>
                            )}
                          </span>
                        </Tag>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
