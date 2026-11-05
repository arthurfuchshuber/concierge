import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, ChevronDown, Pencil, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToReaisInput, parseReaisInputToCents } from "@/components/ui/money-input";
import { CleaningProviderAvatar } from "@/components/dashboard/CleaningProviderAvatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { setCleaningPriceOverride, setCleaningType } from "@/lib/cleaning-price.functions";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { OwnerLine } from "@/components/dashboard/OwnerLine";
import { ClampName } from "@/components/ui/clamp-name";
import { useAreaAccess } from "@/lib/permissions/useAreaAccess";
import type { CleaningDayItem } from "@/lib/dashboard.functions";
import type { ExtraServiceItem } from "@/lib/service-situations";

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
 *
 * ABA SERVIÇOS (23/10/2026): "done" e "cost" aceitam também `extras` — os
 * serviços que NÃO são limpeza (manutenção, danos, outro e as situações
 * criadas pelo usuário). Entram na mesma tabela do dia: em "done", num bloco
 * "Serviços" logo abaixo das limpezas, com a situação em cada linha; em
 * "cost", como linhas por imóvel e situação. O total do rodapé soma tudo.
 */

export type CleaningForecastItem = {
  id: string;
  date: string;
  propertyName: string;
  ownerName: string | null;
  ownerPhone?: string | null;
  ownerPhoneCountry?: string | null;
  timeLabel: string | null;
  guestName: string | null;
  estimateCents: number;
};

export type DayDetailSource =
  | { mode: "done" | "cost"; items: CleaningDayItem[]; extras?: ExtraServiceItem[] }
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

function dateSP(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * DADO EDITÁVEL (mockup aprovado, 04/11/2026): sem fundo e sem borda, na mesma
 * letra das demais linhas; um lápis à direita do dado avisa que ele pode ser
 * alterado. Só aparece para quem tem permissão; sem ela o dado é texto simples.
 */
const EDIT_BTN = "inline-flex min-w-0 max-w-full items-center transition-opacity hover:opacity-80";
const EDIT_PENCIL = "ml-1.5 size-3 shrink-0 opacity-60";

/** Namespace que decide quem pode alterar tipo, valor e prestador da limpeza. */
const CLEANING_EDIT_PERMISSION = "tenant.dashboard.chegadas.limpeza";

function dateISO(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function timeSP(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TD = "min-w-0 max-w-full overflow-hidden border-t border-border/60 py-3 align-top text-[12.5px]";

/**
 * REGRA GLOBAL (18/10/2026): proprietário + ícone de chat acima, título do
 * anúncio em UMA linha com reticências (toque mostra o nome completo).
 */
function PropertyCell({
  name,
  owner,
  phone = null,
  country = null,
  children,
}: {
  name: string;
  owner: string | null;
  phone?: string | null;
  country?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <td className={TD}>
      <ClampName text={name} className="font-bold" />
      <OwnerLine name={owner} phone={phone} country={country} phonePosition="adjacent" />
      {children}
    </td>
  );
}

/**
 * Célula do imóvel na lista "Limpezas Realizadas": título, proprietário e a
 * tipo e valor (`children`), onde só o dado é botão. A linha da ação
 * (data · hora · quem fez) fica no FIM do card, em uma linha, com reticências
 * quando não couber (texto completo no `title`).
 */
function DoneCell({
  name,
  owner,
  phone = null,
  country = null,
  action,
  tail,
  children,
}: {
  name: string;
  owner: string | null;
  phone?: string | null;
  country?: string | null;
  action: string | null;
  /** Fim da última linha (ex.: seletor do prestador). */
  tail?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <td className={TD}>
      <ClampName text={name} className="font-bold" />
      <OwnerLine name={owner} phone={phone} country={country} phonePosition="adjacent" />
      {children}
      {action && (
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-foreground/80">
          <span className="truncate" title={action}>
            {action}
          </span>
          {tail}
        </span>
      )}
    </td>
  );
}

/**
 * RECOLHER/EXPANDIR (mockup aprovado, 04/11/2026): a seta delicada fica ao lado
 * do rótulo principal do card ("Situação", "Tipo da Limpeza", "Quantidade",
 * "Data de Saída"); as demais informações ficam recolhidas e avançam 30px para
 * dentro ao abrir — o mesmo recuo dos cards de reservas. Só um card abre por
 * vez e toda janela nasce recolhida (o estado vive só no componente).
 */
function Chevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden
      className={`size-3.5 shrink-0 opacity-70 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
    />
  );
}

function RowToggle({
  open,
  onToggle,
  title,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      title={title}
      onClick={onToggle}
      className="mt-0.5 flex w-full min-w-0 items-center gap-1 text-left text-[11.5px] font-semibold text-foreground/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <span className="min-w-0 truncate">{children}</span>
      <Chevron open={open} />
    </button>
  );
}

/** Parte recolhível: abre com altura suave; fechada, fica fora do foco. */
function Reveal({ open, children }: { open: boolean; children: React.ReactNode }) {
  const closedProps = open ? {} : ({ inert: true } as object);
  return (
    <div
      aria-hidden={!open}
      {...closedProps}
      className={`grid transition-[grid-template-rows,opacity] duration-200 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}
    >
      <div className="min-h-0 min-w-0 overflow-hidden pl-[30px]">{children}</div>
    </div>
  );
}

/** O valor entra como uma linha comum, logo abaixo das demais informações do card. */
function ValueLine({ label = "Valor do Serviço", children }: { label?: string; children: React.ReactNode }) {
  return (
    <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-foreground/80">
      <span className="shrink-0">{label}:</span>
      {children}
    </span>
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

/**
 * ANTI-CORTE vertical (mockup aprovado, 04/11/2026): nenhuma linha aparece
 * cortada. A altura visível da lista é ajustada para terminar na última linha
 * INTEIRA; o rodapé sobe logo depois dela e a próxima linha surge inteira ao
 * rolar. Sem máscara/esmaecimento. Recalcula ao rolar e ao redimensionar.
 */
function SnapScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop;
    el.style.height = "";
    const avail = el.clientHeight;
    if (avail <= 0 || el.scrollHeight <= avail + 1) {
      el.scrollTop = top;
      return;
    }
    const box = el.getBoundingClientRect();
    let best = 0;
    el.querySelectorAll("tbody > tr").forEach((tr) => {
      const bottom = tr.getBoundingClientRect().bottom - box.top;
      if (bottom <= avail + 0.5 && bottom > best) best = bottom;
    });
    // No fim da rolagem não há o que cortar: usa a altura toda.
    const atEnd = top + avail >= el.scrollHeight - 1;
    if (best > 0 && !atEnd) el.style.height = `${Math.floor(best)}px`;
    el.scrollTop = top;
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    fit();
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    el.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(later) : null;
    ro?.observe(el);
    if (el.parentElement) ro?.observe(el.parentElement);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      ro?.disconnect();
    };
  }, [fit]);
  return (
    <div
      ref={ref}
      className="sg-elegant-scroll min-h-0 shrink [scrollbar-gutter:stable] overflow-y-auto overflow-x-hidden px-5 pb-0 pt-1"
    >
      {children}
    </div>
  );
}

/**
 * Janela "Confirmar Alteração?" (mockup aprovado): só o nome da propriedade e
 * dois blocos — De (valor antigo riscado) → Para (valor novo).
 */
function ConfirmChange({
  open,
  onOpenChange,
  property,
  from,
  to,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  property: string;
  from: string;
  to: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const btn = "h-9 flex-1 rounded-[10px] border text-[12px] transition-colors disabled:opacity-50";
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] gap-3 p-4 sm:max-w-sm">
        <AlertDialogCancel
          aria-label="Fechar"
          disabled={busy}
          className="absolute right-0 top-0 z-[5] grid size-8 place-items-center rounded-none rounded-bl-[12px] rounded-tr-[calc(var(--win-radius,12px)-1px)] border-0 p-0 text-muted-foreground"
          style={{ background: "color-mix(in srgb, var(--panel) 80%, white 8%)" }}
        >
          <X className="size-3.5" strokeWidth={2.2} />
        </AlertDialogCancel>
        <AlertDialogTitle className="pr-8 font-display text-[14px] font-bold leading-tight text-white">
          Confirmar Alteração?
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div className="min-w-0 space-y-2">
            <p className="break-words text-[12.5px] font-bold text-foreground">{property}</p>
            <div className="flex min-w-0 items-center gap-2">
              <div
                className="min-w-0 flex-1 rounded-[10px] border px-3 py-2"
                style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.05)" }}
              >
                <p className="text-[10.5px] font-semibold uppercase text-muted-foreground">De</p>
                <p className="truncate text-[15px] font-semibold line-through opacity-70">{from}</p>
              </div>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              <div
                className="min-w-0 flex-1 rounded-[10px] border px-3 py-2"
                style={{ background: "rgba(255,255,255,.10)", borderColor: "rgba(255,255,255,.12)" }}
              >
                <p className="text-[10.5px] font-semibold uppercase text-muted-foreground">Para</p>
                <p className="truncate text-[15px] font-bold text-white">{to}</p>
              </div>
            </div>
          </div>
        </AlertDialogDescription>
        <div className="flex gap-2">
          <AlertDialogCancel
            disabled={busy}
            className={`${btn} font-semibold text-muted-foreground`}
            style={{ background: "rgba(255,255,255,.04)", borderColor: "rgba(255,255,255,.05)" }}
          >
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            className={`${btn} font-bold text-white`}
            style={{ background: "rgba(255,255,255,.10)", borderColor: "rgba(255,255,255,.12)" }}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            Confirmar
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CleaningDayDetail(props: Parameters<typeof CleaningDayDetailContent>[0]) {
  return (
    <Dialog open onOpenChange={(v) => { if (!v) props.onClose(); }}>
      <DialogContent
        aria-label="Detalhe do dia"
        className="flex max-h-[90dvh] w-[calc(100vw-2rem)] flex-col sm:max-w-md gap-0 p-0 overflow-hidden rounded-[var(--win-radius)] border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.05)] [&>button.absolute]:hidden"
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
  // Quem pode alterar tipo, valor e prestador (08/10/2026). Enquanto a decisão
  // não chega — ou se ela falhar — NÃO mostramos botão: sem permissão confirmada,
  // o dado aparece como texto simples. O servidor continua sendo quem barra.
  const access = useAreaAccess([CLEANING_EDIT_PERMISSION], "WRITE");
  const canEdit = access.ready && access.can(CLEANING_EDIT_PERMISSION);
  // Janela de custo do período todo: "Custo por Serviço Realizado" (04/11/2026).
  const heading = source.mode === "cost" && date === "all" ? "Custo por Serviço Realizado" : (title ?? dayTitle(date));
  const [openKey, setOpenKey] = useState<string | null>(null);
  const toggle = (k: string) => setOpenKey((cur) => (cur === k ? null : k));
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
      <table className="w-full table-fixed border-collapse tabular-nums">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <PropertyCell name={r.propertyName} owner={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry}>
                <RowToggle open={openKey === `f:${r.id}`} onToggle={() => toggle(`f:${r.id}`)}>
                  Data de Saída: {dateISO(r.date)}
                </RowToggle>
                <Reveal open={openKey === `f:${r.id}`}>
                  <span className="block truncate text-[11.5px] font-semibold text-foreground/80">
                    Horário de Saída: {r.timeLabel ?? "—"}
                  </span>
                  <ValueLine label="Estimado">
                    <span>{brl(r.estimateCents)}</span>
                  </ValueLine>
                </Reveal>
              </PropertyCell>
            </tr>
          ))}
        </tbody>
      </table>
    );
    footer = rows.length > 0 && (
      <>
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          Estimativa · Limpeza Normal
        </span>
        <span className="font-display text-[15px] font-bold tabular-nums">{brl(total)}</span>
      </>
    );
  } else {
    const rows = source.items.filter((i) => date === "all" || i.date === date);
    const xrows = (source.extras ?? []).filter((i) => date === "all" || i.date === date);
    const counted = rows.filter((r) => !r.pending);
    const pending = rows.filter((r) => r.pending);
    const extrasTotal = xrows.reduce((n, r) => n + (r.priceCents ?? 0), 0);
    const total = counted.reduce((n, r) => n + (r.priceCents ?? 0), 0) + extrasTotal;
    const pendingTotal = pending.reduce((n, r) => n + (r.priceCents ?? 0), 0);
    const total_ = rows.length + xrows.length;

    if (source.mode === "done") {
      const cleaningWord = `${rows.length} ${rows.length === 1 ? "limpeza concluída" : "limpezas concluídas"}`;
      const extraWord = `${xrows.length} ${xrows.length === 1 ? "serviço extra" : "serviços extras"}`;
      subtitle =
        total_ === 0
          ? "Nenhum serviço concluído"
          : rows.length > 0 && xrows.length > 0
            ? `${cleaningWord} · ${extraWord}`
            : rows.length > 0
              ? cleaningWord
              : `${xrows.length} ${xrows.length === 1 ? "serviço concluído" : "serviços concluídos"}`;
      body = total_ > 0 && (
        <>
          {rows.length > 0 && (
        <table className="w-full table-fixed border-collapse tabular-nums">
          <tbody>
            {rows.map((r) => {
              const action = [dateSP(r.concludedAt), timeSP(r.concludedAt), r.doneByName]
                .filter(Boolean)
                .join(" · ");
              return (
                <tr key={r.id}>
                  <DoneCell
                    name={r.propertyName}
                    owner={r.ownerName}
                    phone={r.ownerPhone}
                    country={r.ownerPhoneCountry}
                    action={action}
                    tail={
                      r.logId || r.reservationId ? (
                        <CleaningProviderAvatar
                          propertyId={r.propertyId}
                          logId={r.logId ?? ""}
                          reservationId={r.reservationId}
                          look={canEdit ? "raised" : "plain"}
                        />
                      ) : null
                    }
                  >
                    <TypeToggle
                      statusId={r.id}
                      type={r.cleaningType}
                      pending={r.pending}
                      title={r.propertyName}
                      canEdit={canEdit}
                      open={openKey === `c:${r.id}`}
                      onToggle={() => toggle(`c:${r.id}`)}
                    />
                    <Reveal open={openKey === `c:${r.id}`}>
                      <ValueLine>
                        <EditablePrice statusId={r.id} cents={r.priceCents} title={r.propertyName} canEdit={canEdit} />
                      </ValueLine>
                    </Reveal>
                  </DoneCell>
                </tr>
              );
            })}
          </tbody>
        </table>
          )}
          {xrows.length > 0 && (
            <table className="w-full table-fixed border-collapse tabular-nums">
              <tbody>
                {xrows.map((r) => {
                  const action = [dateSP(r.concludedAt), timeSP(r.concludedAt), r.doneByName]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={r.id}>
                      <DoneCell name={r.propertyName} owner={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry} action={action}>
                        <RowToggle
                          open={openKey === `x:${r.id}`}
                          onToggle={() => toggle(`x:${r.id}`)}
                          title={`${r.situationName}: ${r.title}`}
                        >
                          Situação: {r.situationName}
                        </RowToggle>
                        <Reveal open={openKey === `x:${r.id}`}>
                          <span className="block truncate text-[11px] text-muted-foreground" title={r.title}>
                            {r.title}
                          </span>
                          <ValueLine>
                            <span className="whitespace-nowrap">{brl(r.priceCents ?? 0)}</span>
                          </ValueLine>
                        </Reveal>
                      </DoneCell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      );
    } else {
      // Uma linha por imóvel, do maior valor para o menor. O tipo resume o
      // que houve ali ("Normal", "Completa" ou os dois). Serviços extras entram
      // como linhas próprias (imóvel + situação), com a situação no lugar do tipo.
      type Agg = {
        key: string;
        name: string;
        owner: string | null;
        phone: string | null;
        country: string | null;
        count: number;
        cents: number;
        types: Set<string>;
        pending: boolean;
        label?: string;
      };
      const byProp = new Map<string, Agg>();
      for (const r of counted) {
        const cur = byProp.get(r.propertyId) ?? {
          key: r.propertyId,
          name: r.propertyName,
          owner: r.ownerName,
          phone: r.ownerPhone ?? null,
          country: r.ownerPhoneCountry ?? null,
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
      for (const r of xrows) {
        const k = `extra:${r.propertyId}:${r.situation}`;
        const cur = byProp.get(k) ?? {
          key: k,
          name: r.propertyName,
          owner: r.ownerName,
          phone: r.ownerPhone ?? null,
          country: r.ownerPhoneCountry ?? null,
          count: 0,
          cents: 0,
          types: new Set<string>(),
          pending: false,
          label: r.situationName,
        };
        cur.count += 1;
        cur.cents += r.priceCents ?? 0;
        byProp.set(k, cur);
      }
      for (const r of pending) {
        byProp.set(`pending:${r.id}`, {
          key: `pending:${r.id}`,
          name: r.propertyName,
          owner: r.ownerName,
          phone: r.ownerPhone ?? null,
          country: r.ownerPhoneCountry ?? null,
          count: 1,
          cents: r.priceCents ?? 0,
          types: new Set(["completa"]),
          pending: true,
        });
      }
      const aggs = Array.from(byProp.values()).sort(
        (a, b) => Number(a.pending) - Number(b.pending) || b.cents - a.cents,
      );
      const hasExtras = xrows.length > 0;
      const itemWord =
        hasExtras && rows.length === 0
          ? xrows.length === 1
            ? "serviço"
            : "serviços"
          : hasExtras
            ? "itens"
            : rows.length === 1
              ? "limpeza"
              : "limpezas";
      subtitle =
        total_ === 0
          ? "Nenhum custo neste dia"
          : `${total_} ${itemWord} · do maior para o menor valor`;
      body = aggs.length > 0 && (
        <table className="w-full table-fixed border-collapse tabular-nums">
          <tbody>
            {aggs.map((a) => (
              <tr key={a.key}>
                <PropertyCell name={a.name} owner={a.owner} phone={a.phone} country={a.country}>
                  <RowToggle open={openKey === `k:${a.key}`} onToggle={() => toggle(`k:${a.key}`)}>
                    Quantidade: {a.count} ·{" "}
                    {a.label ? (
                      a.label
                    ) : a.types.size > 1 ? (
                      "Normal + completa"
                    ) : (
                      <TypeLabel
                        type={(Array.from(a.types)[0] as "normal" | "completa" | undefined) ?? null}
                        pending={a.pending}
                      />
                    )}
                  </RowToggle>
                  <Reveal open={openKey === `k:${a.key}`}>
                    <ValueLine>
                      <span>{brl(a.cents)}</span>
                    </ValueLine>
                  </Reveal>
                </PropertyCell>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    footer = total_ > 0 && (
      <>
        <span className="text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
          {source.mode === "done" && pending.length > 0
            ? `Total · ${counted.length + xrows.length} no custo`
            : "VALOR TOTAL"}
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
    <div aria-label={`Detalhe de ${title ?? dayTitle(date)}`} className="flex min-h-0 shrink flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3 pt-5">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-foreground/[0.06] text-muted-foreground">
          <HeaderIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-base font-bold leading-tight break-words">{heading}</p>
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
      {body && <SnapScroll>{body}</SnapScroll>}
      {footer && (
        <div className="flex shrink-0 items-baseline justify-between gap-3 border-t border-border bg-foreground/[0.03] px-5 py-3.5">
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
  canEdit,
  open,
  onToggle,
}: {
  statusId: string;
  type: "normal" | "completa" | null;
  pending?: boolean;
  title: string;
  canEdit: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [target, setTarget] = useState<"normal" | "completa" | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useServerFn(setCleaningType);
  const qc = useQueryClient();
  if (!type) return <TypeLabel type={type} pending={pending} />;
  const typeText = type === "completa" ? "Completa" : "Normal";
  // Rótulo no mesmo estilo da linha do proprietário; só o DADO é botão.
  const labelCls = "mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] font-semibold text-foreground/80";
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
  const chevron = (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? "Recolher card" : "Expandir card"}
      onClick={onToggle}
      className="inline-grid size-4 shrink-0 place-items-center rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
    >
      <Chevron open={open} />
    </button>
  );
  const emAnalise = pending && (
    <span className="mt-0.5 block text-[9.5px] font-extrabold text-amber-500 dark:text-amber-400">em análise</span>
  );
  if (!canEdit) {
    return (
      <>
        <span className={labelCls} title={`Tipo da Limpeza: ${typeText}`}>
          <span className="min-w-0 truncate">Tipo da Limpeza: {typeText}</span>
          {chevron}
        </span>
        {emAnalise}
      </>
    );
  }
  return (
    <>
      <span className={labelCls}>
        <span className="shrink-0">Tipo da Limpeza:</span>
        <button
          type="button"
          onClick={() => setTarget(next)}
          title={`Mudar para ${next === "completa" ? "Completa" : "Normal"}`}
          className={`${EDIT_BTN} text-[11.5px] font-semibold leading-none`}
        >
          <span className="truncate">{typeText}</span>
          <Pencil className={EDIT_PENCIL} aria-hidden />
        </button>
        {chevron}
      </span>
      {emAnalise}
      <ConfirmChange
        open={!!target}
        onOpenChange={(v) => !v && setTarget(null)}
        property={title}
        from={typeText}
        to={next === "completa" ? "Completa" : "Normal"}
        busy={busy}
        onConfirm={() => void doSave()}
      />
    </>
  );
}

/** Valor clicável: edita no mesmo lugar, com a MESMA letra, e SEMPRE pede
 * confirmação antes de gravar. */
function EditablePrice({
  statusId,
  cents,
  title,
  canEdit,
}: {
  statusId: string;
  cents: number | null;
  title: string;
  canEdit: boolean;
}) {
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

  const same = "font-semibold text-[11.5px] leading-none";
  // Sem permissão: valor em texto simples, sem fundo de botão e sem toque.
  if (!canEdit) return <span className={`whitespace-nowrap ${same}`}>{brl(cents)}</span>;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setText(centsToReaisInput(cents));
          setEditing(true);
        }}
        title="Alterar valor"
        className={`${EDIT_BTN} whitespace-nowrap ${same}`}
      >
        {brl(cents)}
        <Pencil className={EDIT_PENCIL} aria-hidden />
      </button>
    );
  }
  const pill =
    "ds-3d ds-3d-hover inline-flex h-[18px] shrink-0 items-center rounded-[0.3rem] px-1.5 text-[11.5px] font-semibold leading-none disabled:opacity-50";
  return (
    <>
      <span className={`inline-flex min-w-0 items-baseline border-b border-current ${same}`}>
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
          className={`min-w-0 bg-transparent p-0 outline-none ${same}`}
        />
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1">
        <button type="button" className={`${pill} border border-border/70 bg-card`} onClick={() => setEditing(false)}>
          Cancelar
        </button>
        <button
          type="button"
          className={`${pill} bg-primary text-primary-foreground`}
          disabled={value == null || value === cents}
          onClick={() => setConfirm(true)}
        >
          OK
        </button>
      </span>
      <ConfirmChange
        open={confirm}
        onOpenChange={setConfirm}
        property={title}
        from={brl(cents)}
        to={brl(value)}
        busy={busy}
        onConfirm={() => void doSave()}
      />
    </>
  );
}
