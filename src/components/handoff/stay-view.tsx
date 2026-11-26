/**
 * Dados da reserva no ATENDIMENTO (mockups ATD-D/M, aprovados em 23–26/11/2026). Usado pelos cards da lista e
 * pelo cabeçalho da conversa. Sem tabela rotulada (Período/Estadia/Reserva) e sem etiquetas de fase:
 *  - hóspede com o ícone de pessoa;
 *  - período "dd/mm/aaaa → dd/mm/aaaa" na COR DA ETAPA (a mesma do card do Kanban), com Hoje/Amanhã/Ontem/
 *    Anteontem/Depois de Amanhã no lugar da data, SEMPRE em negrito (regra global de 23/11/2026);
 *  - "N noites · N hóspedes · CÓDIGO" em tom secundário, com o botão de copiar o código logo à direita
 *    (regra global de 24/11/2026).
 * A barra lateral do card continua na cor da fase (`stayBarClass`).
 */
import { CalendarDays, Copy, Moon, User } from "lucide-react";
import { toast } from "sonner";
import type { HandoffGuestDetail, HandoffReservationMatch } from "@/lib/handoff.schemas";
import { formatDayBR, relativeDayWord, todaySaoPauloIso } from "@/lib/relative-day";

type StayTone = "sky" | "emerald" | "orange" | "cream" | "red" | "none";

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

const dayNum = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

/** "2026-10-18" → "18/10" */
function fmtDM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}` : null;
}

function phaseOf(checkin: string, checkout: string | null): { label: string | null; tone: StayTone } {
  const today = dayNum(todaySaoPauloIso());
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
  return { label: null, tone: "none" }; // encerrada
}

export function buildStayView(args: {
  detail?: HandoffGuestDetail | null;
  res?: HandoffReservationMatch | null;
  viewers?: number;
}): StayView {
  const { detail, res } = args;
  const viewers = args.viewers ?? 0;
  const code = detail?.reservationCode ?? res?.code ?? null;
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
export function stayBarClass(s: Pick<StayView, "tone">): string {
  switch (s.tone) {
    case "sky":
      return "bg-sky-400";
    case "emerald":
      return "bg-emerald-400";
    case "orange":
      return "bg-orange-400";
    case "red":
      return "bg-red-500";
    default:
      return "bg-muted-foreground/40";
  }
}

/** Cor do texto do período e da palavra relativa (a cor da etapa, igual ao card do Kanban). */
export function stayToneText(s: Pick<StayView, "tone">, fallback = "text-foreground"): string {
  switch (s.tone) {
    case "orange":
      return "text-orange-600";
    case "sky":
      return "text-sky-700";
    case "emerald":
      return "text-emerald-700";
    case "red":
      return "text-red-800";
    default:
      return fallback;
  }
}

/** Data ou palavra relativa (negrito + cor do status). */
export function RelDay({ iso, toneClass }: { iso: string | null; toneClass: string }) {
  const word = relativeDayWord(iso);
  if (word) return <strong className={`font-bold ${toneClass}`}>{word}</strong>;
  return <>{formatDayBR(iso)}</>;
}

/** Plural certo de noites/hóspedes. */
export const nightsLabel = (n: number) => `${n} ${n === 1 ? "noite" : "noites"}`;
export const guestsLabel = (n: number) => `${n} ${n === 1 ? "hóspede" : "hóspedes"}`;

/** Botão de copiar o código da reserva (mesma cor cinza do texto secundário). */
export function CopyCode({ code, className = "" }: { code: string; className?: string }) {
  return (
    <button
      type="button"
      aria-label="Copiar código da reserva"
      title="Copiar código da reserva"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        navigator.clipboard
          ?.writeText(code)
          .then(() => toast.success("Código copiado"))
          .catch(() => toast.error("Não foi possível copiar"));
      }}
      className={`-m-1 inline-flex size-5 shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      <Copy className="size-3" />
    </button>
  );
}

/** Linha do hóspede (ícone de pessoa à esquerda; sem ícone de canal). */
export function StayGuestLine({ name, size = "text-[12px]" }: { name: string; size?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
      <User className="size-3.5 shrink-0" />
      <span className={`min-w-0 truncate ${size} font-medium`} title={name}>
        {name}
      </span>
    </div>
  );
}

/** Período "início → fim" na cor da etapa. */
export function StayPeriodLine({ stay, size = "text-[12px]" }: { stay: StayView; size?: string }) {
  if (!stay.checkin) return null;
  const tone = stayToneText(stay);
  return (
    <div className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap tabular-nums ${size} font-medium ${tone}`}>
      <CalendarDays className="size-3.5 shrink-0" />
      <span>
        <RelDay iso={stay.checkin} toneClass={tone} />
      </span>
      {stay.checkout ? (
        <>
          <span aria-hidden="true">→</span>
          <span>
            <RelDay iso={stay.checkout} toneClass={tone} />
          </span>
        </>
      ) : null}
    </div>
  );
}

/** "N noites · N hóspedes · CÓDIGO" + copiar. Some quando não há nenhum dos três. */
export function StayNightsLine({ stay, size = "text-[12px]" }: { stay: StayView; size?: string }) {
  const parts: string[] = [];
  if (stay.nights != null) parts.push(nightsLabel(stay.nights));
  if (stay.guests) parts.push(guestsLabel(stay.guests));
  if (parts.length === 0 && !stay.code) return null;
  return (
    <div className={`flex min-w-0 items-center gap-1.5 whitespace-nowrap tabular-nums ${size} font-medium text-muted-foreground`}>
      <Moon className="size-3.5 shrink-0" />
      <span className="truncate">
        {parts.join(" · ")}
        {stay.code ? (
          <>
            {parts.length ? " · " : ""}
            <span className="tracking-[0.02em] text-foreground/75">{stay.code}</span>
          </>
        ) : null}
      </span>
      {stay.code ? <CopyCode code={stay.code} /> : null}
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
