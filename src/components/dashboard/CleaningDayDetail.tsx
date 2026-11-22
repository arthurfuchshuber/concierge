import { useState } from "react";
import { TELA_CHEIA_CLASS } from "@/lib/tela-cheia";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCleaningProviderControl } from "@/components/dashboard/CleaningProviderAvatar";
import { EditProviderWindow } from "@/components/dashboard/FinanceEditWindows";
import { FINANCE_WINDOW_CLASS } from "@/components/dashboard/wide-window";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WINDOW_HEADER_CLASS, WINDOW_SUBTITLE_CLASS, WINDOW_TITLE_CLASS } from "./window-header";
import { FinanceEntryDetail, type FinanceEntry } from "@/components/dashboard/FinanceEntryDetail";
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

/** Etiqueta neutra dos cartões (tipo da limpeza, situação do serviço extra). */
const TAG =
  "shrink-0 whitespace-nowrap rounded-[6px] bg-card px-2 py-0.5 text-[11.5px] font-medium text-foreground/75 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_9%,transparent)]";

/** "18/11 · 15:58" no fuso de São Paulo. */
function whenShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const day = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });
  return `${day} · ${timeSP(iso)}`;
}

/**
 * CARTÃO DE LANÇAMENTO (mockups Fin-01 a Fin-04): altura fixa por tipo para a lista sempre parar numa linha
 * inteira (anti-corte). Clicar em qualquer lugar, menos nos botões, abre o detalhe na mesma janela.
 */
function EntryRow({
  name,
  owner,
  value,
  onOpen,
  extra,
  tight,
  children,
}: {
  name: string;
  owner: string | null;
  value: string;
  onOpen?: () => void;
  extra?: React.ReactNode;
  /** Serviços extras (Fin-03): última linha 5px abaixo do proprietário, em vez de 7px. */
  tight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-clip-row=""
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={
        onOpen
          ? (e) => {
              // Cliques que vêm de uma janela aberta por cima (portal) não abrem o detalhe.
              if (!e.currentTarget.contains(e.target as Node)) return;
              if ((e.target as HTMLElement).closest("button, a, input")) return;
              onOpen();
            }
          : undefined
      }
      onKeyDown={onOpen ? (e) => e.key === "Enter" && e.target === e.currentTarget && onOpen() : undefined}
      className={cn(
        "snap-start border-b border-border/60 px-4 py-3.5 outline-none last:border-b-0",
        onOpen && "cursor-pointer active:bg-foreground/[0.04] focus-visible:bg-foreground/[0.04]",
      )}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2.5">
        <span className="ds-card-title min-w-0 leading-5 text-foreground" title={name}>
          {name}
        </span>
        <span className="shrink-0 whitespace-nowrap font-display text-[13.5px] font-bold tabular-nums tracking-[-0.2px] text-foreground">
          {value}
        </span>
      </div>
      {owner ? (
        <div className="mt-[3px] truncate text-[12.5px] font-medium leading-4 text-muted-foreground" title={owner}>
          {owner}
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-h-[22px] min-w-0 items-center text-[12px] font-medium text-muted-foreground",
          tight ? "mt-[5px] gap-2.5" : "mt-[7px] gap-2",
        )}
      >
        {children}
      </div>
      {extra}
    </div>
  );
}

/**
 * Etiqueta do prestador (mockup Fin-01): etiqueta neutra, SEM seta; o nome sublinhado pontilhado indica que dá para trocar; quem pode alterar toca e abre a janela
 * "Alterar Prestador" (5 opções à vista + busca). Sem permissão, só a etiqueta.
 */
function ProviderTag({
  propertyId,
  logId,
  reservationId,
  propertyName,
  ownerName,
  canEdit,
}: {
  propertyId: string;
  logId: string;
  reservationId: string | null;
  propertyName: string;
  ownerName: string | null;
  canEdit: boolean;
}) {
  const ctl = useCleaningProviderControl(propertyId, logId, reservationId);
  const [open, setOpen] = useState(false);
  /* Etiqueta neutra (22/11/2026): a cor azul saiu — quem diz que dá para trocar é o sublinhado pontilhado
     no próprio nome (`ds-editable`), o padrão único de informação editável. */
  const tag = cn(TAG, "inline-flex min-w-0 max-w-[60%] items-center");
  const editable = canEdit && ctl.editable;
  const label = (
    <span className={cn("min-w-0 truncate", editable && "ds-editable [text-underline-offset:2px]")}>{ctl.currentName ?? "Sem prestador"}</span>
  );
  if (!editable) return <span className={tag}>{label}</span>;
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        title="Alterar prestador"
        className={tag}
      >
        {label}
      </button>
      <EditProviderWindow
        open={open}
        onOpenChange={setOpen}
        ctx={{ property: propertyName, owner: ownerName }}
        subtitle="Escolha quem executou a limpeza"
        providers={ctl.providers}
        currentId={ctl.currentId}
        onSave={async (id) => {
          try {
            await ctl.set(id);
            toast.success("Prestador alterado.");
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Não foi possível alterar o prestador.");
            throw e;
          }
        }}
      />
    </>
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
      <span className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap text-[11.5px] font-bold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

export function CleaningDayDetail({
  onClose,
  ...props
}: Parameters<typeof CleaningDayDetailContent>[0] & { onClose: () => void }) {
  return <CleaningDayDetailWindow open onOpenChange={(v) => { if (!v) onClose(); }} {...props} />;
}

/**
 * Janela completa da lista de lançamentos: clicar numa linha troca o conteúdo
 * da MESMA janela pelo detalhe e o "X" do canto vira "‹ Voltar" (11/11/2026).
 */
export function CleaningDayDetailWindow({
  open,
  onOpenChange,
  ...props
}: Parameters<typeof CleaningDayDetailContent>[0] & { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [entry, setEntryState] = useState<FinanceEntry | null>(null);
  /* "‹ Voltar" de uma subtela do lançamento (Detalhes da Reserva) volta para o lançamento, não para a lista. */
  const [subBack, setSubBack] = useState<(() => void) | null>(null);
  const setEntry = (e: FinanceEntry | null) => {
    setSubBack(null);
    setEntryState(e);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setEntry(null);
        onOpenChange(v);
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className={cn(FINANCE_WINDOW_CLASS, TELA_CHEIA_CLASS)}
        onBack={subBack ?? (entry ? () => setEntry(null) : undefined)}
      >
        {entry ? (
          <FinanceEntryDetail
            key={entry.item.id}
            entry={entry}
            onSubBack={(fn) => setSubBack(() => fn)}
            onNavigate={() => {
              setEntry(null);
              onOpenChange(false);
            }}
          />
        ) : (
          <CleaningDayDetailContent {...props} onEntryChange={setEntry} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function CleaningDayDetailContent({
  date,
  source,
  caretX,
  title,
  onEntryChange,
}: {
  /** Quando informado, as linhas do modo "done" abrem o detalhe do lançamento. */
  onEntryChange?: (e: FinanceEntry) => void;
  /** "all" = todas as limpezas do período (janela dos cards do topo). */
  date: string;
  title?: string;
  source: DayDetailSource;
  /** Posição da seta, em px a partir da borda esquerda do cartão. */
  caretX: number | null;
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
    // Linha sem valor (0 ou em branco) NUNCA aparece nas listas do Financeiro (pedido explícito, 10/11/2026).
    const rows = source.items.filter((i) => (date === "all" || i.date === date) && (i.estimateCents ?? 0) > 0);
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
    // Linha sem valor (0 ou em branco) NUNCA aparece nas listas do Financeiro (pedido explícito, 10/11/2026).
    const rows = source.items.filter((i) => (date === "all" || i.date === date) && (i.priceCents ?? 0) > 0);
    const xrows = (source.extras ?? []).filter((i) => (date === "all" || i.date === date) && (i.priceCents ?? 0) > 0);
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
      // MOCKUPS Fin-01 a Fin-04 (18/11/2026): um cartão por lançamento — título + valor, proprietário e,
      // embaixo, data · hora com as etiquetas (tipo e prestador na limpeza; situação no serviço extra,
      // com a descrição numa linha própria). Tocar em qualquer lugar do cartão (fora dos botões) abre o
      // detalhe na mesma janela; os campos alteráveis são editados lá.
      body = total_ > 0 && (
        <div className="-mx-4">
          {rows.map((r) => (
            <EntryRow
              key={r.id}
              name={r.propertyName}
              owner={r.ownerName}
              value={brl(r.priceCents)}
              onOpen={onEntryChange ? () => onEntryChange({ kind: "cleaning", item: r }) : undefined}
            >
              <span className="whitespace-nowrap">{whenShort(r.concludedAt)}</span>
              {r.cleaningType ? <span className={TAG}>{r.cleaningType === "completa" ? "Completa" : "Normal"}</span> : null}
              {r.pending ? (
                <span className="shrink-0 text-[9.5px] font-extrabold text-amber-500 dark:text-amber-400">em análise</span>
              ) : null}
              {r.logId || r.reservationId ? (
                <ProviderTag
                  propertyId={r.propertyId}
                  logId={r.logId ?? ""}
                  reservationId={r.reservationId}
                  propertyName={r.propertyName}
                  ownerName={r.ownerName}
                  canEdit={canEdit}
                />
              ) : null}
            </EntryRow>
          ))}
          {xrows.map((r) => (
            <EntryRow
              key={r.id}
              name={r.propertyName}
              owner={r.ownerName}
              value={brl(r.priceCents ?? 0)}
              onOpen={onEntryChange ? () => onEntryChange({ kind: "extra", item: r }) : undefined}
              tight
            >
              {/* Mockup Fin-03: "data · hora · título da situação" na última linha e a etiqueta do
                  tipo da situação no canto direito, alinhada ao meio dessa linha. */}
              <span
                className="min-w-0 flex-1 truncate leading-4"
                title={[whenShort(r.concludedAt), r.title].filter(Boolean).join(" · ")}
              >
                {[whenShort(r.concludedAt), r.title].filter(Boolean).join(" · ")}
              </span>
              <span className={cn(TAG, "ml-auto max-w-[45%] shrink-0 truncate")} title={r.situationName}>
                {r.situationName}
              </span>
            </EntryRow>
          ))}
        </div>
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
      {/* CABEÇALHO UNIVERSAL DE JANELA AMPLA (07/11/2026, referência: "Check-ins
          amanhã"): sem ícone, título 14px negrito em 1 linha e subtítulo 12px;
          o `pr-14` deixa o "X" oficial (canto superior direito) livre. */}
      <DialogHeader className={cn(WINDOW_HEADER_CLASS, "sm:mx-6")}>
        <DialogTitle className={WINDOW_TITLE_CLASS} title={heading}>
          {heading}
        </DialogTitle>
        <p className={WINDOW_SUBTITLE_CLASS}>{subtitle}</p>
      </DialogHeader>
      {/* O rodapé reserva a mesma calha da barra de rolagem da lista, para o
          "Valor Total" cair exatamente na coluna dos valores dos cards. */}
      {/* Rolagem NATIVA (sem JS mexendo na altura): o iOS não congela e o rodapé nunca sai da tela.
          Anti-corte: `snap-start` nas linhas faz a lista parar numa linha inteira. */}
      {body && (
        <div
          className={cn(
            "sg-elegant-scroll min-h-0 flex-1 snap-y snap-proximity overflow-y-auto overscroll-contain touch-pan-y px-4 sm:mx-6 [scrollbar-gutter:stable] [&>table:first-of-type>tbody>tr:first-child>td]:border-t-0",
            // Cartões dos lançamentos (Fin-01..04) encostam no cabeçalho e no rodapé.
            source.mode === "done" ? "py-0" : "pb-1 pt-2.5",
          )}
        >
          {body}
        </div>
      )}
      {footer && (
        <div className="flex shrink-0 items-baseline justify-between gap-3 overflow-hidden border-t border-border bg-foreground/[0.03] px-4 py-3.5 sm:px-10 [scrollbar-gutter:stable]">
          {footer}
        </div>
      )}
    </div>
  );
}
