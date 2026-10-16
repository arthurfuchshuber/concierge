/**
 * Dados da reserva no ATENDIMENTO (mockup "Atendimento: lista e cabeçalho",
 * aprovado em 16/10/2026): uma informação por linha, na mesma ordem do card do
 * Kanban. Usado pelos cards da lista lateral e pelo cabeçalho do chat.
 *
 * - Cores IDÊNTICAS às do card do Kanban (card-colors.ts: azul chegada, verde estadia,
 *   laranja saída, vermelho atraso/cancelada).
 * - Etiqueta ao lado do nome: FASE da reserva (Chega hoje, Em estadia…) na cor
 *   do status; "Cancelada" em vermelho; "Consulta" em amarelo fraco (o hóspede
 *   ainda não tem reserva). Reserva encerrada não leva etiqueta.
 * - "Data Indisponível" só aparece na Consulta, ao lado direito da etiqueta; as demais linhas
 *   (Estadia, Reserva) continuam quando houver dado.
 * - Ícone de pessoas com número: quantas pessoas abriram o guia dessa reserva.
 */
import { CalendarDays, Hash, Moon, Users } from "lucide-react";
import { CopyButton } from "@/components/CopyButton";
import type { HandoffGuestDetail, HandoffReservationMatch } from "@/lib/handoff.schemas";

export type StayTone = "sky" | "emerald" | "orange" | "cream" | "red" | "none";

export type StayView = {
  kind: "reservation" | "consulta" | "cancelled";
  checkin: string | null;
  checkout: string | null;
  nights: number | null;
  guests: number | null;
  code: string | null;
  viewers: number;
  tagLabel: string | null;
  tone: StayTone;
};

const DAY = 86_400_000;

function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

const dayNum = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

/** "2026-10-18" → "18/10" */
export function fmtDM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : null;
}

function phaseOf(checkin: string, checkout: string | null): { label: string | null; tone: StayTone } {
  const today = dayNum(todaySaoPaulo());
  const ci = dayNum(checkin);
  const co = checkout ? dayNum(checkout) : ci;
  if (today < ci) {
    const d = ci - today;
    return { label: d === 1 ? "Chega amanhã" : `Chega em ${d} dias`, tone: "sky" };
  }
  if (today === ci) return { label: "Chega hoje", tone: "sky" };
  if (today < co) {
    const d = co - today;
    if (d === 1) return { label: "Sai amanhã", tone: "orange" };
    return { label: `Em estadia · sai ${fmtDM(checkout)}`, tone: "emerald" };
  }
  if (today === co) return { label: "Sai hoje", tone: "orange" };
  return { label: null, tone: "none" }; // encerrada: sem etiqueta
}

export function buildStayView(args: {
  detail?: HandoffGuestDetail | null;
  res?: HandoffReservationMatch | null;
  viewers?: number;
}): StayView {
  const { detail, res } = args;
  const viewers = args.viewers ?? 0;
  const code = detail?.reservationCode ?? null;
  if (res?.status === "cancelled") {
    const ci = res.checkin ?? detail?.checkinDate ?? null;
    const co = res.checkout ?? detail?.checkoutDate ?? null;
    return { kind: "cancelled", checkin: ci, checkout: co, nights: nightsOf(ci, co), guests: res.guests ?? null, code, viewers, tagLabel: "Cancelada", tone: "red" };
  }
  const ci = res?.checkin ?? detail?.checkinDate ?? null;
  const co = res?.checkout ?? detail?.checkoutDate ?? null;
  // Consulta = ainda não há reserva (nada no Airbnb/Channex para esta conversa).
  const consulta = res?.status === "missing" || !ci;
  if (consulta) {
    return { kind: "consulta", checkin: null, checkout: null, nights: null, guests: res?.guests ?? null, code, viewers, tagLabel: "Consulta", tone: "cream" };
  }
  const phase = phaseOf(ci, co);
  return { kind: "reservation", checkin: ci, checkout: co, nights: nightsOf(ci, co), guests: res?.guests ?? null, code, viewers, tagLabel: phase.label, tone: phase.tone };
}

function nightsOf(ci: string | null, co: string | null): number | null {
  if (!ci || !co) return null;
  const n = dayNum(co) - dayNum(ci);
  return n > 0 ? n : null;
}

/** Barra lateral do card (cor da fase). */
export function stayBarClass(s: StayView): string {
  switch (s.tone) {
    case "sky":
      return "bg-sky-400";
    case "emerald":
      return "bg-emerald-400";
    case "orange":
      return "bg-orange-400";
    case "cream":
      return "bg-muted-foreground/40";
    case "red":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}

const TAG_THEME: Record<Exclude<StayTone, "none">, string> = {
  sky: "bg-sky-500/15 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  emerald: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  orange: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  // Consulta: amarelo-creme PRÓPRIO (matiz ~100°), distinto do âmbar de "pendente/atenção" e do laranja de saída.
  cream: "bg-[oklch(0.88_0.09_100/0.2)] text-[oklch(0.45_0.09_100)] dark:bg-[oklch(0.88_0.09_100/0.14)] dark:text-[oklch(0.88_0.1_100)]",
  red: "bg-red-500/15 text-red-800 dark:bg-red-500/15 dark:text-red-400",
};
// O cabeçalho do chat tem tema claro fixo (independe do modo do app): classes sem `dark:`.
const TAG_LIGHT: Record<Exclude<StayTone, "none">, string> = {
  sky: "bg-sky-100 text-sky-800",
  emerald: "bg-emerald-50 text-emerald-700",
  orange: "bg-orange-50 text-orange-600",
  cream: "bg-[oklch(0.95_0.05_100)] text-[oklch(0.45_0.09_100)]",
  red: "bg-red-50 text-red-800",
};

/** Etiqueta ao lado do nome. `light`: cabeçalho do chat (tema claro fixo). */
export function StayTag({ stay, light = false }: { stay: StayView; light?: boolean }) {
  if (!stay.tagLabel || stay.tone === "none") return null;
  const theme = (light ? TAG_LIGHT : TAG_THEME)[stay.tone];
  const chip = (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-[2px] text-[10.5px] font-semibold leading-none ${theme}`}>
      {stay.tagLabel}
    </span>
  );
  // "Data Indisponível" só na Consulta, ao lado direito da etiqueta (as demais linhas do card seguem iguais).
  if (stay.kind !== "consulta") return chip;
  return (
    <>
      {chip}
      <span className={`min-w-0 truncate text-[10.5px] font-semibold ${light ? "text-zinc-700" : "text-foreground"}`}>
        Data Indisponível
      </span>
    </>
  );
}

/** Ícone de pessoas + número, ao lado do telefone. Some quando ninguém abriu o guia. */
export function GuideViewers({ count }: { count: number }) {
  if (!count) return null;
  const label = count === 1 ? "1 pessoa acessou o guia desta reserva" : `${count} pessoas acessaram o guia desta reserva`;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground"
      title={label}
      aria-label={label}
    >
      <Users className="size-3" />
      {count}
    </span>
  );
}

function Line({
  icon: Icon,
  label,
  labelW,
  iconCls,
  value,
  extra,
}: {
  icon: typeof Hash;
  label: string;
  labelW: string;
  iconCls: string;
  value: React.ReactNode;
  extra?: React.ReactNode;
}) {
  // Idêntico ao mockup: ícone · rótulo (largura fixa) · valor em negrito · complemento (mesmo gap de 8px).
  return (
    <div className="flex min-w-0 items-center gap-2 whitespace-nowrap tabular-nums">
      <Icon className={`${iconCls} shrink-0 text-muted-foreground`} />
      <span className={`${labelW} shrink-0 text-muted-foreground`}>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
      {extra}
    </div>
  );
}

/**
 * Linhas Período · Estadia · Reserva (Consulta não tem Período: a nota fica ao lado da etiqueta).
 * `size="md"` = cabeçalho do chat; `size="sm"` = card da lista.
 */
export function StayLines({ stay, size = "sm" }: { stay: StayView; size?: "sm" | "md" }) {
  const text = size === "md" ? "text-[12.5px]" : "text-[11.5px]";
  const labelW = size === "md" ? "w-[68px]" : "w-[52px]";
  const iconCls = size === "md" ? "size-3.5" : "size-3";
  const ci = fmtDM(stay.checkin);
  const co = fmtDM(stay.checkout);
  const guests = stay.guests ? (
    <span className="font-semibold text-foreground">
      · {stay.guests} {stay.guests === 1 ? "hóspede" : "hóspedes"}
    </span>
  ) : null;
  return (
    <div className={`flex flex-col gap-0.5 ${text}`}>
      {ci && <Line icon={CalendarDays} label="Período" labelW={labelW} iconCls={iconCls} value={co ? `${ci} a ${co}` : ci} />}
      {stay.nights != null && (
        <Line
          icon={Moon}
          label="Estadia"
          labelW={labelW}
          iconCls={iconCls}
          value={`${stay.nights} ${stay.nights === 1 ? "noite" : "noites"}`}
          extra={guests}
        />
      )}
      {stay.nights == null && stay.guests ? (
        <Line
          icon={Moon}
          label="Estadia"
          labelW={labelW}
          iconCls={iconCls}
          value={`${stay.guests} ${stay.guests === 1 ? "hóspede" : "hóspedes"}`}
        />
      ) : null}
      {stay.code && (
        <Line
          icon={Hash}
          label="Reserva"
          labelW={labelW}
          iconCls={iconCls}
          value={stay.code}
          extra={
            <span onClick={(e) => e.stopPropagation()}>
              <CopyButton value={stay.code} size={11} />
            </span>
          }
        />
      )}
    </div>
  );
}

/** "9 h", "2 dias", "35 min" — formato curto do mockup (sem "cerca de"). */
export function shortAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? "1 dia" : `${d} dias`;
}
