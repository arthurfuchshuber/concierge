import { useRef, useState } from "react";
import { ArrowRight, CalendarDays, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { centsToReaisInput, parseReaisInputToCents } from "@/components/ui/money-input";
import { CleaningProviderAvatar, useCleaningProviderName } from "@/components/dashboard/CleaningProviderAvatar";
import { EDIT_BTN, EDIT_INPUT } from "@/components/dashboard/edit-frame";
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

/** Letra das linhas de informação do card. */
const LINE = "text-[11.5px] font-semibold text-foreground/80";

/**
 * LINHA INFERIOR DO CARD (07/11/2026): à esquerda a informação (data · hora ·
 * quem concluiu + prestador, ou horário/quantidade), que encolhe com
 * reticências; à direita o VALOR, na mesma coluna do "Valor Total" do rodapé.
 * Anti-corte: o valor nunca encolhe e a esquerda nunca vaza (360–390px).
 */
function BottomRow({ children, value }: { children: React.ReactNode; value: React.ReactNode }) {
  return (
    <div data-bottom-row="" className={`mt-0.5 flex min-w-0 items-center justify-between gap-2 ${LINE}`}>
      <span className="flex min-w-0 items-center gap-1.5">{children}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1 text-[11.5px] font-semibold tabular-nums">{value}</span>
    </div>
  );
}

const sameName = (a: string | null | undefined, b: string | null | undefined) => {
  const n = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
  return !!a && !!b && n(a) === n(b);
};

/**
 * Texto da ação (07/11/2026): data · hora e quem concluiu no sistema. Se quem
 * concluiu é o próprio prestador atribuído, o nome NÃO se repete — o botão de
 * iniciais ao lado já diz quem foi. Pessoas diferentes (ou prestador "?"):
 * o nome de quem concluiu aparece por extenso.
 */
function actionText(
  concludedAt: string | null,
  doneByName: string | null,
  providerName: string | null,
): string {
  const who = sameName(doneByName, providerName) ? null : doneByName;
  return [dateSP(concludedAt), timeSP(concludedAt), who].filter(Boolean).join(" · ");
}

function ActionText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="min-w-0 truncate" title={text}>
      {text}
    </span>
  );
}

/** Ação de uma limpeza com prestador: compara quem concluiu com o prestador. */
function CleaningAction({
  propertyId,
  logId,
  reservationId,
  concludedAt,
  doneByName,
  canEdit,
}: {
  propertyId: string;
  logId: string;
  reservationId: string | null;
  concludedAt: string | null;
  doneByName: string | null;
  canEdit: boolean;
}) {
  const provider = useCleaningProviderName(propertyId, logId, reservationId);
  return (
    <>
      <ActionText text={actionText(concludedAt, doneByName, provider)} />
      <CleaningProviderAvatar
        propertyId={propertyId}
        logId={logId}
        reservationId={reservationId}
        look={canEdit ? "raised" : "plain"}
      />
    </>
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
            <tr key={r.id} className="snap-start">
              <PropertyCell name={r.propertyName} owner={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry}>
                <span className={`mt-0.5 block truncate ${LINE}`}>Data de Saída: {dateISO(r.date)}</span>
                <BottomRow value={<span className="whitespace-nowrap">{brl(r.estimateCents)}</span>}>
                  <span className="min-w-0 truncate">Horário de Saída: {r.timeLabel ?? "—"}</span>
                </BottomRow>
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
            {rows.map((r) => (
              <tr key={r.id} className="snap-start">
                <PropertyCell name={r.propertyName} owner={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry}>
                  <TypeToggle
                    statusId={r.id}
                    type={r.cleaningType}
                    pending={r.pending}
                    title={r.propertyName}
                    canEdit={canEdit}
                  />
                  <BottomRow
                    value={
                      <EditablePrice statusId={r.id} cents={r.priceCents} title={r.propertyName} canEdit={canEdit} />
                    }
                  >
                    {r.logId || r.reservationId ? (
                      <CleaningAction
                        propertyId={r.propertyId}
                        logId={r.logId ?? ""}
                        reservationId={r.reservationId}
                        concludedAt={r.concludedAt}
                        doneByName={r.doneByName}
                        canEdit={canEdit}
                      />
                    ) : (
                      <ActionText text={actionText(r.concludedAt, r.doneByName, null)} />
                    )}
                  </BottomRow>
                </PropertyCell>
              </tr>
            ))}
          </tbody>
        </table>
          )}
          {xrows.length > 0 && (
            <table className="w-full table-fixed border-collapse tabular-nums">
              <tbody>
                {xrows.map((r) => (
                  <tr key={r.id} className="snap-start">
                    <PropertyCell name={r.propertyName} owner={r.ownerName} phone={r.ownerPhone} country={r.ownerPhoneCountry}>
                      <span className={`mt-0.5 block truncate ${LINE}`} title={`${r.situationName}: ${r.title}`}>
                        Situação: {r.situationName}
                      </span>
                      <span className="block truncate text-[11px] text-muted-foreground" title={r.title}>
                        {r.title}
                      </span>
                      <BottomRow value={<span className="whitespace-nowrap">{brl(r.priceCents ?? 0)}</span>}>
                        <ActionText text={actionText(r.concludedAt, r.doneByName, null)} />
                      </BottomRow>
                    </PropertyCell>
                  </tr>
                ))}
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
              <tr key={a.key} className="snap-start">
                <PropertyCell name={a.name} owner={a.owner} phone={a.phone} country={a.country}>
                  <BottomRow value={<span className="whitespace-nowrap">{brl(a.cents)}</span>}>
                    <span className="min-w-0 truncate">
                      Quantidade: {a.count} ·{" "}
                      {a.label ? a.label : a.types.size > 1 ? "Normal + completa" : (a.types.has("completa") ? "Completa" : "Normal")}
                    </span>
                    {a.pending && (
                      <span className="shrink-0 text-[9.5px] font-extrabold text-amber-500 dark:text-amber-400">em análise</span>
                    )}
                  </BottomRow>
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
    <div aria-label={`Detalhe de ${title ?? dayTitle(date)}`} className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
      {/* O rodapé reserva a mesma calha da barra de rolagem da lista, para o
          "Valor Total" cair exatamente na coluna dos valores dos cards. */}
      {/* Rolagem NATIVA (sem JS mexendo na altura): o iOS não congela e o rodapé nunca sai da tela.
          Anti-corte: `snap-start` nas linhas faz a lista parar numa linha inteira. */}
      {body && (
        <div className="sg-elegant-scroll min-h-0 flex-1 snap-y snap-proximity overflow-y-auto overscroll-contain touch-pan-y px-5 pb-1 pt-1 [scrollbar-gutter:stable]">
          {body}
        </div>
      )}
      {footer && (
        <div className="flex shrink-0 items-baseline justify-between gap-3 overflow-hidden border-t border-border bg-foreground/[0.03] px-5 py-3.5 [scrollbar-gutter:stable]">
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
}: {
  statusId: string;
  type: "normal" | "completa" | null;
  pending?: boolean;
  title: string;
  canEdit: boolean;
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
  const emAnalise = pending && (
    <span className="mt-0.5 block text-[9.5px] font-extrabold text-amber-500 dark:text-amber-400">em análise</span>
  );
  if (!canEdit) {
    return (
      <>
        <span className={labelCls} title={`Tipo da Limpeza: ${typeText}`}>
          <span className="min-w-0 truncate">Tipo da Limpeza: {typeText}</span>
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
          className={EDIT_BTN}
        >
          {typeText}
        </button>
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

/**
 * Valor clicável (07/11/2026): ao tocar, vira um campo na MESMA posição e
 * altura, já com foco — sem botões "Cancelar"/"OK", que espremiam a data no
 * celular. Enter ou sair do campo grava: valor alterado abre o "Confirmar
 * Alteração?" (De → Para); valor igual ou Escape descarta sem perguntar.
 */
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
  // Escape descarta: o blur que vem logo depois não pode gravar.
  const discarded = useRef(false);
  const save = useServerFn(setCleaningPriceOverride);
  const qc = useQueryClient();
  const value = parseReaisInputToCents(text);

  function close() {
    setConfirm(false);
    setEditing(false);
  }

  function commit() {
    if (discarded.current || confirm) return;
    if (value == null || value === cents) close();
    else setConfirm(true);
  }

  async function doSave() {
    if (value == null) return;
    setBusy(true);
    try {
      await save({ data: { statusId, cents: value, reason: null } });
      toast.success(`Valor de ${title} alterado para ${brl(value)}.`);
      close();
      void qc.invalidateQueries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível alterar o valor.");
    } finally {
      setBusy(false);
    }
  }

  // Sem permissão: valor em texto simples, sem moldura e sem toque.
  if (!canEdit) return <span className="whitespace-nowrap">{brl(cents)}</span>;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          discarded.current = false;
          setText(centsToReaisInput(cents));
          setEditing(true);
        }}
        title="Alterar valor"
        className={`${EDIT_BTN} whitespace-nowrap tabular-nums`}
      >
        {brl(cents)}
      </button>
    );
  }
  return (
    <>
      <input
        autoFocus
        aria-label={`Valor de ${title}`}
        inputMode="decimal"
        value={text}
        disabled={busy}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            discarded.current = true;
            close();
          }
        }}
        className={EDIT_INPUT}
      />
      <ConfirmChange
        open={confirm}
        onOpenChange={(v) => {
          // Cancelar (ou fechar) a confirmação descarta a edição.
          if (!v) close();
        }}
        property={title}
        from={brl(cents)}
        to={brl(value)}
        busy={busy}
        onConfirm={() => void doSave()}
      />
    </>
  );
}
