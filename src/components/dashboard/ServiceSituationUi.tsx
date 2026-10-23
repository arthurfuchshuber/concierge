import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CalendarCheck,
  Check,
  Home,
  Layers,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { FILTER_PANEL_CLASS, FILTER_PANEL_OFFSET, FitPopoverContent } from "@/components/dashboard/filter-panel";
import { ACTION_BUTTON_TONE, ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import { ManualCleaningHost, useCanCreateCleaning } from "@/components/dashboard/ManualCleaningButton";
import { RecordSituationSheet } from "@/components/dashboard/RecordSituationSheet";
import { Choice, PickList, PropertyPickRow, Step, TrailDialog, ddmm, norm } from "@/components/dashboard/TrailParts";
import {
  createServiceSituation,
  deleteServiceSituation,
  listServiceSituations,
  updateServiceSituation,
} from "@/lib/service-situations.functions";
import {
  SITUATION_DETAIL_MAX,
  SITUATION_NAME_MAX,
  titleCaseSituation,
  type ServiceSituation,
} from "@/lib/service-situations";
import { getNewRecordOptions, type RecordCategory } from "@/lib/reservation-records.functions";
import { armarSituacao, desarmarSituacao } from "@/lib/offline/situation-outbox";
import { useImpersonation } from "@/hooks/useImpersonation";
import { cn } from "@/lib/utils";

/**
 * ABA SERVIÇOS — as peças de "situação" (mockups aprovados, 23/10/2026).
 *
 *  · `NewServiceButton`  o "+" da aba: abre "Sobre o que é a situação?".
 *      Limpeza cai no passo 1 de "Nova limpeza"; as demais abrem a trilha de
 *      duas perguntas (imóvel/reserva) e depois a folha de registro de sempre,
 *      já com a situação escolhida.
 *  · `SituationPickerDialog`  a janela da lista: casca grafite quente de 280px
 *      (a dos quadrantes de Filtros), 16px de folga da borda no celular,
 *      nunca mais alta que a tela. Título e busca fixos; a lista rola com
 *      barra fina; "Adicionar situação" fica fixo no pé.
 *  · `SituationFormDialog`  "Nova situação": só título (Title Case automático,
 *      menos de/da/do/das/dos/e) e Detalhamento, que vira a descrição da
 *      situação na lista.
 *  · `SituationFilterSegment` / `SituationOptionRow`  o filtro de situação
 *      (escolha única, com contagem, só das situações COM dado no período).
 */

const SHELL =
  "sg-elegant-scroll relative flex w-[min(280px,calc(100vw-32px))] max-w-none flex-col gap-0 overflow-hidden rounded-[var(--win-radius)] border border-[var(--panel-border)] bg-[var(--panel)] p-0 text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05)] before:pointer-events-none before:absolute before:inset-x-7 before:top-0 before:h-px before:content-[''] before:bg-[image:var(--panel-hair)] sm:max-w-none";

/** Botão retangular de 5px com o degradê da marca — o padrão dos botões de confirmar. */
const BTN_PRIMARY =
  "rounded-[5px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-4 py-2 text-xs font-bold text-white disabled:opacity-50";
const BTN_GHOST =
  "rounded-[5px] border border-border px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-foreground/[0.05] disabled:opacity-50";

/* ------------------------------------------------------------------------ */
/* Janela "Sobre o que é a situação?"                                        */
/* ------------------------------------------------------------------------ */

export function SituationPickerDialog({
  open,
  onOpenChange,
  situations,
  loading,
  canCreateCleaning,
  onPick,
  onAdd,
  onEdit,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  situations: ServiceSituation[];
  loading: boolean;
  canCreateCleaning: boolean;
  onPick: (s: ServiceSituation) => void;
  onAdd: () => void;
  onEdit: (s: ServiceSituation) => void;
  onDelete: (s: ServiceSituation) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<ServiceSituation | null>(null);
  const [busy, setBusy] = useState(false);

  const q = norm(query.trim());
  const shown = useMemo(
    () => (q ? situations.filter((s) => norm(`${s.name} ${s.detail ?? ""}`).includes(q)) : situations),
    [situations, q],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          // "Clique ao fundo volta uma janela": da confirmação, volta à lista.
          if (confirm && !busy) {
            setConfirm(null);
            return;
          }
          setQuery("");
          setConfirm(null);
        }
        onOpenChange(v);
      }}
    >
      <DialogContent
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(SHELL, "max-h-[min(560px,calc(100dvh-32px))]")}
      >
        <div className="shrink-0 px-3.5 pb-2.5 pt-3.5 pr-11">
          <DialogTitle className="font-display text-[14.5px] font-bold leading-snug text-foreground">
            Sobre o que é a situação?
          </DialogTitle>
          <DialogDescription className="sr-only">Escolha a situação do serviço.</DialogDescription>
        </div>

        {confirm ? (
          <div className="px-3.5 pb-3.5">
            <p className="text-[12.5px] leading-snug text-foreground">
              Excluir a situação <b className="break-words">{confirm.name}</b>?
            </p>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
              Os serviços já registrados continuam no histórico com esse nome.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" disabled={busy} onClick={() => setConfirm(null)} className={BTN_GHOST}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onDelete(confirm);
                    setConfirm(null);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-[5px] bg-[#c0504d] px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                {busy && <Loader2 className="size-3 animate-spin" />}
                Excluir
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="mx-3.5 mb-2 flex h-8 shrink-0 items-center gap-2 rounded-[9px] border border-border bg-[var(--panel-well)] px-2.5">
              <Search className="size-3.5 shrink-0 text-foreground/40" strokeWidth={2} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar situação…"
                className="min-w-0 flex-1 truncate bg-transparent text-xs text-foreground outline-none placeholder:text-foreground/40"
              />
            </label>

            <div className="sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-[var(--panel-div)]">
              {loading ? (
                <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">Carregando…</p>
              ) : shown.length === 0 ? (
                <p className="px-3.5 py-5 text-center text-xs text-muted-foreground">Nenhuma situação encontrada.</p>
              ) : (
                shown.map((s, i) => {
                  const blocked = s.id === "cleaning" && !canCreateCleaning;
                  return (
                    <div
                      key={s.id}
                      className={cn(
                        "flex items-stretch transition-colors hover:bg-foreground/[0.03]",
                        i < shown.length - 1 && "border-b border-[var(--panel-div)]",
                      )}
                    >
                      <button
                        type="button"
                        disabled={blocked}
                        onClick={() => onPick(s)}
                        title={blocked ? "Você não tem permissão para criar limpezas." : undefined}
                        className="min-w-0 flex-1 px-3.5 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <span className="block break-words text-[12.5px] font-bold leading-snug text-foreground">
                          {s.name}
                        </span>
                        {s.detail && (
                          <span className="mt-0.5 line-clamp-2 block break-words text-[10.5px] leading-snug text-muted-foreground">
                            {s.detail}
                          </span>
                        )}
                      </button>
                      {/* Lápis e lixeira SÓ nas situações criadas pelo usuário. */}
                      {!s.system && (
                        <span className="flex shrink-0 items-center gap-0.5 pr-2.5">
                          <button
                            type="button"
                            onClick={() => onEdit(s)}
                            aria-label={`Editar ${s.name}`}
                            title="Editar"
                            className="grid size-7 place-items-center rounded-[7px] text-foreground/55 transition-colors hover:bg-foreground/[0.07] hover:text-foreground"
                          >
                            <Pencil className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirm(s)}
                            aria-label={`Excluir ${s.name}`}
                            title="Excluir"
                            className="grid size-7 place-items-center rounded-[7px] text-foreground/55 transition-colors hover:bg-foreground/[0.07] hover:text-[#e07b78]"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <button
              type="button"
              onClick={onAdd}
              className="flex w-full shrink-0 items-center gap-2.5 border-t border-[var(--panel-div)] px-3.5 py-3 text-left transition-colors hover:bg-foreground/[0.03]"
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-[7px] bg-accent/[0.14] text-accent">
                <Plus className="size-3.5" strokeWidth={2.5} />
              </span>
              <span className="text-[12.5px] font-bold text-foreground">Adicionar situação</span>
            </button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------ */
/* Janela "Nova situação"                                                    */
/* ------------------------------------------------------------------------ */

export function SituationFormDialog({
  open,
  onOpenChange,
  initial,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Preenchido ao editar. */
  initial: ServiceSituation | null;
  busy: boolean;
  onSubmit: (v: { name: string; detail: string }) => void;
}) {
  // Montado só quando aberto: cada abertura nasce limpa (ou com a situação editada).
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      {open && <SituationForm initial={initial} busy={busy} onCancel={() => onOpenChange(false)} onSubmit={onSubmit} />}
    </Dialog>
  );
}

function SituationForm({
  initial,
  busy,
  onCancel,
  onSubmit,
}: {
  initial: ServiceSituation | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (v: { name: string; detail: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [detail, setDetail] = useState(initial?.detail ?? "");
  const normalized = titleCaseSituation(name);
  const valid = normalized.length > 0;
  return (
    <DialogContent
      onOpenAutoFocus={(e) => e.preventDefault()}
      className={cn(SHELL, "max-h-[min(520px,calc(100dvh-32px))]")}
    >
      <div className="shrink-0 px-3.5 pb-2 pt-3.5 pr-11">
        <DialogTitle className="font-display text-[14.5px] font-bold leading-snug text-foreground">
          {initial ? "Editar situação" : "Nova situação"}
        </DialogTitle>
        <DialogDescription className="sr-only">Dê um título e, se quiser, detalhe a situação.</DialogDescription>
      </div>
      <form
        className="sg-elegant-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 pb-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !busy) onSubmit({ name: normalized, detail: detail.trim() });
        }}
      >
        <label className="block">
          <span className="ds-eyebrow mb-1.5 block text-muted-foreground">Título</span>
          <input
            autoFocus
            value={name}
            maxLength={SITUATION_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && setName(titleCaseSituation(name))}
            placeholder="Ex.: Troca de Lâmpada"
            disabled={busy}
            className="h-9 w-full rounded-[9px] border border-border bg-[var(--panel-well)] px-2.5 text-[13px] font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="block">
          <span className="ds-eyebrow mb-1.5 flex items-center text-muted-foreground">
            Detalhamento
            <span className="ml-auto text-[9.5px] font-semibold tabular-nums">
              {detail.length}/{SITUATION_DETAIL_MAX}
            </span>
          </span>
          <textarea
            value={detail}
            maxLength={SITUATION_DETAIL_MAX}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
            placeholder="Quando usar esta situação (aparece na lista)"
            disabled={busy}
            className="block w-full resize-none rounded-[9px] border border-border bg-[var(--panel-well)] px-2.5 py-2 text-[12.5px] leading-snug text-foreground outline-none placeholder:text-foreground/40 focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" disabled={busy} onClick={onCancel} className={BTN_GHOST}>
            Cancelar
          </button>
          <button type="submit" disabled={!valid || busy} className={`${BTN_PRIMARY} inline-flex items-center gap-1.5`}>
            {busy && <Loader2 className="size-3 animate-spin" />}
            Salvar
          </button>
        </div>
      </form>
    </DialogContent>
  );
}

/* ------------------------------------------------------------------------ */
/* Filtro de situação (escolha única, com contagem)                          */
/* ------------------------------------------------------------------------ */

export type SituationOption = {
  /** `null` = "Todas as situações". */
  id: string | null;
  label: string;
  count: number;
};

/** Linha de escolha única com o total à direita — a lista do filtro, no desktop e no celular. */
export function SituationOptionRow({
  option,
  selected,
  onClick,
  last,
}: {
  option: SituationOption;
  selected: boolean;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-[9px] px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/[0.03]",
        !last && "border-b border-[var(--panel-div)]",
      )}
    >
      <Check className={cn("size-3.5 shrink-0 text-accent", selected ? "opacity-100" : "opacity-0")} strokeWidth={3} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[12.5px]",
          selected ? "font-bold text-foreground" : "font-medium text-foreground/80",
        )}
      >
        {option.label}
      </span>
      <span className="shrink-0 text-[11px] font-semibold tabular-nums text-muted-foreground">{option.count}</span>
    </button>
  );
}

/**
 * DESKTOP: o segmento que fica ANTES do "+", na linha da busca. Sem escolha
 * mostra "Todas as situações"; com escolha vira o chip rosa com o nome.
 * No celular ele some — a mesma escolha é a primeira linha do menu Filtros.
 */
export function SituationFilterSegment({
  options,
  value,
  onChange,
}: {
  options: SituationOption[];
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.id === value) ?? null;
  const label = current?.label ?? "Todas as situações";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Filtrar por situação"
          aria-label={`Situação: ${label}`}
          data-action-wide
          className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} max-lg:hidden lg:w-auto lg:gap-1.5 lg:px-3`}
        >
          <Layers className={ACTION_ICON} />
          {value ? (
            <span className="max-w-[160px] truncate rounded-full bg-accent/[0.14] px-[9px] py-[3px] text-[11px] font-bold text-accent">
              {label}
            </span>
          ) : (
            <span className="whitespace-nowrap text-xs">Todas as situações</span>
          )}
        </button>
      </PopoverTrigger>
      <FitPopoverContent
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        className={FILTER_PANEL_CLASS}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="relative flex items-center gap-2.5 border-b border-[var(--panel-div)] px-3.5 py-3">
          <span className="ds-eyebrow text-muted-foreground">Situação</span>
          <button
            type="button"
            disabled={!value}
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className="ml-auto text-[11px] font-semibold text-foreground/70 transition-colors hover:text-foreground disabled:pointer-events-none disabled:text-foreground/30"
          >
            Limpar
          </button>
        </div>
        {options.map((o, i) => (
          <SituationOptionRow
            key={o.id ?? "all"}
            option={o}
            selected={o.id === value}
            last={i === options.length - 1}
            onClick={() => {
              onChange(o.id);
              setOpen(false);
            }}
          />
        ))}
      </FitPopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------------ */
/* O "+" da aba Serviços                                                     */
/* ------------------------------------------------------------------------ */

const CATEGORY_OF: Record<string, RecordCategory> = {
  maintenance: "maintenance",
  damage: "damage",
};

export function NewServiceButton() {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const qc = useQueryClient();
  const canCreateCleaning = useCanCreateCleaning();
  const listFn = useServerFn(listServiceSituations);
  const createFn = useServerFn(createServiceSituation);
  const updateFn = useServerFn(updateServiceSituation);
  const deleteFn = useServerFn(deleteServiceSituation);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState<{ initial: ServiceSituation | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [cleaningOpen, setCleaningOpen] = useState(false);
  const [trail, setTrail] = useState<ServiceSituation | null>(null);

  const q = useQuery({
    queryKey: ["service-situations", ownerId],
    queryFn: () => listFn({ data: { ownerId } }),
    enabled: pickerOpen,
    staleTime: 30_000,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["service-situations"] });
    void qc.invalidateQueries({ queryKey: ["dash-service-extras"] });
  };

  async function submitForm(v: { name: string; detail: string }) {
    if (!form) return;
    setSaving(true);
    try {
      if (form.initial) {
        await updateFn({ data: { ownerId, id: form.initial.id, name: v.name, detail: v.detail || null } });
        toast.success("Situação atualizada.");
      } else {
        await createFn({ data: { ownerId, name: v.name, detail: v.detail || null } });
        toast.success("Situação criada.");
      }
      refresh();
      setForm(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar a situação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title="Novo serviço"
        aria-label="Novo serviço"
        onClick={() => setPickerOpen(true)}
        className={`${ACTION_SEGMENT} text-accent`}
      >
        <Plus className={ACTION_ICON} />
        <span className="lg:hidden">Serviço</span>
      </button>

      <SituationPickerDialog
        open={pickerOpen && !form}
        onOpenChange={setPickerOpen}
        situations={q.data?.situations ?? []}
        loading={q.isLoading}
        canCreateCleaning={canCreateCleaning}
        onPick={(s) => {
          setPickerOpen(false);
          if (s.id === "cleaning") setCleaningOpen(true);
          else setTrail(s);
        }}
        onAdd={() => setForm({ initial: null })}
        onEdit={(s) => setForm({ initial: s })}
        onDelete={async (s) => {
          try {
            await deleteFn({ data: { ownerId, id: s.id } });
            toast.success(`Situação “${s.name}” excluída.`);
            refresh();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : "Não foi possível excluir a situação.");
            throw e;
          }
        }}
      />

      <SituationFormDialog
        open={!!form}
        onOpenChange={(v) => !v && setForm(null)}
        initial={form?.initial ?? null}
        busy={saving}
        onSubmit={(v) => void submitForm(v)}
      />

      {/* "Limpeza" cai no passo 1 de "Nova limpeza". */}
      <ManualCleaningHost open={cleaningOpen} onOpenChange={setCleaningOpen} />

      {trail && (
        <ServiceRecordTrail
          situation={trail}
          ownerId={ownerId}
          onClose={() => setTrail(null)}
          onSaved={() => {
            for (const k of ["account-records", "reservation-records", "dash-tasks", "dash-service-extras"]) {
              void qc.invalidateQueries({ queryKey: [k] });
            }
          }}
        />
      )}
    </>
  );
}

/**
 * As duas perguntas que faltam depois da situação (a categoria já é a da
 * situação): vincular a imóvel ou reserva, e qual. Em seguida abre a folha
 * "Nova situação" de sempre — mídias, título, descrição, ditado e fila de envio
 * em segundo plano são os mesmos.
 */
function ServiceRecordTrail({
  situation,
  ownerId,
  onClose,
  onSaved,
}: {
  situation: ServiceSituation;
  ownerId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const optionsFn = useServerFn(getNewRecordOptions);
  const [step, setStep] = useState(1);
  const [link, setLink] = useState<"imovel" | "reserva" | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sheet, setSheet] = useState<{ propertyId: string; reservationId: string | null } | null>(null);

  const q = useQuery({
    queryKey: ["new-record-options", ownerId],
    queryFn: () => optionsFn({ data: { ownerId } }),
    staleTime: 60_000,
  });
  const properties = q.data?.properties ?? [];
  const reservations = q.data?.reservations ?? [];
  const property = properties.find((p) => p.id === propertyId) ?? null;
  const reservation = reservations.find((r) => r.id === reservationId) ?? null;
  const propName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Imóvel";
  const resLabel = (r: { label: string; checkin: string; checkout: string | null }) =>
    `${r.label || "Reserva"} · ${ddmm(r.checkin)} → ${ddmm(r.checkout)}`;

  const sq = norm(search.trim());
  const shownProps = sq
    ? properties.filter((p) => norm(`${p.name} ${p.ownerName ?? ""}`).includes(sq))
    : properties;
  const shownRes = sq
    ? reservations.filter((r) => norm(`${r.label} ${propName(r.propertyId)}`).includes(sq))
    : reservations;

  const answered = [!!link, link === "reserva" ? !!reservation : !!property];
  const answers = [
    link === "imovel" ? "Imóvel" : link === "reserva" ? "Reserva" : undefined,
    link === "reserva" ? (reservation ? resLabel(reservation) : undefined) : property?.name,
  ];
  const question2 = link === "reserva" ? "Qual reserva?" : link === "imovel" ? "Qual imóvel?" : "Qual imóvel ou reserva?";
  const ready = answered.every(Boolean);

  const category: RecordCategory = CATEGORY_OF[situation.id] ?? "other";
  const sheetProperty = sheet ? properties.find((p) => p.id === sheet.propertyId) : null;
  const sheetReservation = sheet?.reservationId ? reservations.find((r) => r.id === sheet.reservationId) : null;

  const pick = (pid: string, rid: string | null) => {
    setPropertyId(pid);
    setReservationId(rid);
    setSearch("");
    setStep(2);
  };

  return (
    <>
      <TrailDialog
        open={!sheet}
        onOpenChange={(v) => !v && onClose()}
        title={`Novo serviço · ${situation.name}`}
        progress={`${Math.min(step, 2)} de 2`}
        onBack={step > 1 ? () => setStep(step - 1) : undefined}
        footer={
          <button
            type="button"
            disabled={!ready}
            onClick={() => {
              if (!property) return;
              // Deixa a situação pronta: o registro que sair da folha a leva junto.
              armarSituacao(property.id, situation.id);
              setSheet({ propertyId: property.id, reservationId });
            }}
            className="ds-surface inline-flex h-10 w-full items-center justify-center gap-1.5 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2 text-[13px] font-bold text-white disabled:opacity-40"
          >
            <span className="truncate">Continuar</span>
          </button>
        }
      >
        <ol className="flex flex-col">
          <Step n={1} active={step === 1} done={answered[0]} question="Vincular a um imóvel ou a uma reserva?" answer={answers[0]} onReopen={() => setStep(1)}>
            <div role="radiogroup" className="flex gap-1.5">
              <Choice
                icon={Home}
                title="Imóvel"
                sub="Sem hóspede, só o imóvel"
                selected={link === "imovel"}
                onClick={() => {
                  if (link !== "imovel") {
                    setReservationId(null);
                    if (link) setPropertyId(null);
                  }
                  setLink("imovel");
                  setSearch("");
                  setStep(2);
                }}
              />
              <Choice
                icon={CalendarCheck}
                title="Reserva"
                sub="Ligado a uma estadia"
                selected={link === "reserva"}
                onClick={() => {
                  if (link !== "reserva") {
                    setReservationId(null);
                    setPropertyId(null);
                  }
                  setLink("reserva");
                  setSearch("");
                  setStep(2);
                }}
              />
            </div>
          </Step>
          <Step n={2} active={step === 2} done={answered[1]} last question={question2} answer={answers[1]} onReopen={() => answered[0] && setStep(2)}>
            {link === "reserva" ? (
              <PickList
                search={search}
                onSearch={setSearch}
                placeholder="Buscar hóspede ou imóvel…"
                empty={q.isLoading ? "Carregando…" : q.isError ? "Não foi possível carregar as reservas." : shownRes.length === 0 ? "Nenhuma reserva encontrada." : null}
              >
                {shownRes.map((r, i) => {
                  const p = properties.find((x) => x.id === r.propertyId);
                  return (
                    <PropertyPickRow
                      key={r.id}
                      extra={resLabel(r)}
                      name={propName(r.propertyId)}
                      photoUrl={p?.photoUrl}
                      ownerName={p?.ownerName}
                      city={p?.city}
                      selected={r.id === reservationId}
                      onClick={() => pick(r.propertyId, r.id)}
                      last={i === shownRes.length - 1}
                    />
                  );
                })}
              </PickList>
            ) : (
              <PickList
                search={search}
                onSearch={setSearch}
                placeholder="Buscar imóvel ou proprietário…"
                empty={q.isLoading ? "Carregando…" : q.isError ? "Não foi possível carregar os imóveis." : shownProps.length === 0 ? "Nenhum imóvel encontrado." : null}
              >
                {shownProps.map((p, i) => (
                  <PropertyPickRow
                    key={p.id}
                    name={p.name}
                    photoUrl={p.photoUrl}
                    ownerName={p.ownerName}
                    city={p.city}
                    selected={p.id === propertyId}
                    onClick={() => pick(p.id, null)}
                    last={i === shownProps.length - 1}
                  />
                ))}
              </PickList>
            )}
          </Step>
        </ol>
      </TrailDialog>

      {sheet && (
        <RecordSituationSheet
          open
          onOpenChange={(v) => {
            if (!v) {
              // Fechou sem registrar: a situação armada não vale mais.
              desarmarSituacao(sheet.propertyId);
              setSheet(null);
              onClose();
            }
          }}
          propertyId={sheet.propertyId}
          propertyLabel={sheetProperty?.name ?? "Imóvel"}
          owner={
            sheetProperty
              ? { name: sheetProperty.ownerName, phone: sheetProperty.ownerPhone, country: sheetProperty.ownerPhoneCountry }
              : null
          }
          contextLine={[situation.name, sheetReservation ? resLabel(sheetReservation) : null].filter(Boolean).join(" · ")}
          target={sheet.reservationId ? { reservationId: sheet.reservationId } : {}}
          cardMode={null}
          category={category}
          initial={null}
          initialTitle=""
          onSaved={onSaved}
        />
      )}
    </>
  );
}
