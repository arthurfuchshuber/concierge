import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, CalendarDays, Check, Clock, Plus, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { centsToReaisInput, parseReaisInputToCents } from "@/components/ui/money-input";
import { WIDE_WINDOW_CLASS } from "@/components/dashboard/wide-window";
import { WINDOW_SUBTITLE_CLASS, WINDOW_TITLE_CLASS } from "@/components/dashboard/window-header";
import {
  CalendarWindow,
  isoToLocalDate,
  localDateToIso,
  todaySaoPauloDate,
} from "@/components/dashboard/CalendarWindow";

/**
 * JANELAS DE EDIÇÃO DO FINANCEIRO (mockups Fin-14 a Fin-21, aprovados em 18/11/2026).
 *
 * Tocar num campo alterável do detalhe de um lançamento (limpeza ou serviço extra) abre a janela daquele
 * campo: cabeçalho com título (iniciais maiúsculas) e subtítulo que dizem a AÇÃO, o quadrante do imóvel
 * como contexto, o campo e o rodapé Cancelar / Salvar. Valor, tipo e data passam pelo "Confirmar
 * Alteração?" (De → Para) antes de gravar. Lista de escolha: no máximo 5 opções visíveis, com busca.
 */

/* ---------------------------------------------------------------- peças ---------------------------------------------------------------- */

/** Quadrante das janelas do Financeiro (Fin-05/06/22): MESMA cor neutra da janela, contorno fino e sombra leve. */
export const FIN_CARD =
  "rounded-[12px] bg-[var(--panel)] px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent),0_1px_2px_rgba(40,25,10,.06),0_3px_8px_rgba(40,25,10,.05)]";
/** Rótulo pequeno em caixa alta dos quadrantes. */
export const FIN_CAP = "text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--faint)]";
/** Corpo das janelas: quadrantes separados por 20px na cor do fundo da janela. */
export const FIN_BODY = "flex flex-col gap-5 px-3 py-3.5";
/** Faixa do rodapé (Valor / botões), de fora a fora, sem filete em cima. */
export const FIN_FOOT = "shrink-0 bg-foreground/[0.03]";

const BTN_CANCEL =
  "ds-surface inline-flex h-9 flex-1 items-center justify-center px-3 text-[13px] font-semibold text-foreground/80 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_16%,transparent)] transition-colors hover:bg-foreground/[0.04] disabled:opacity-60";
const BTN_PRIMARY =
  "ds-surface inline-flex h-9 flex-1 items-center justify-center gap-2 px-4 text-[13px] font-semibold bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const FIELD =
  "flex h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[12px] bg-card px-3 text-[14px] font-semibold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] outline-none transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_55%,transparent)] focus:shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_55%,transparent)]";

function Label({ children }: { children: ReactNode }) {
  return <div className={cn(FIN_CAP, "mb-1.5")}>{children}</div>;
}

/** Imóvel + proprietário (só o nome), contexto de toda janela de edição. */
export function PropertyContextCard({ name, owner }: { name: string; owner: string | null }) {
  return (
    <div className={FIN_CARD}>
      <div className="truncate text-[14px] font-bold leading-5 text-foreground" title={name}>
        {name}
      </div>
      {owner ? (
        <div
          className="mt-0.5 truncate text-[12.5px] font-medium leading-4 text-muted-foreground"
          title={owner}
        >
          {owner}
        </div>
      ) : null}
    </div>
  );
}

/** Casca das janelas de edição: cabeçalho, corpo que rola e rodapé Cancelar / Salvar. */
function EditWindow({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  onSave,
  saveLabel = "Salvar",
  canSave = true,
  busy = false,
  bodyClassName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle: string;
  children: ReactNode;
  onSave: () => void;
  saveLabel?: string;
  canSave?: boolean;
  busy?: boolean;
  bodyClassName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(WIDE_WINDOW_CLASS, "sm:!p-0 sm:max-w-sm")}
      >
        <DialogHeader className="shrink-0 space-y-0 py-3 pl-4 pr-14 text-left">
          <DialogTitle className={WINDOW_TITLE_CLASS}>{title}</DialogTitle>
          <p className={WINDOW_SUBTITLE_CLASS}>{subtitle}</p>
        </DialogHeader>
        <div
          className={cn(
            "sg-elegant-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain",
            FIN_BODY,
            bodyClassName,
          )}
        >
          {children}
        </div>
        <div className={cn(FIN_FOOT, "flex gap-2 px-4 pb-4 pt-3")}>
          <button
            type="button"
            className={BTN_CANCEL}
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy || !canSave}
            onClick={onSave}
          >
            {saveLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------- Fin-20 ------------------------------------------------------------- */

/** "Confirmar Alteração?": o imóvel e dois quadrantes, De (riscado) → Para. */
export function ConfirmChangeWindow({
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
  return (
    <EditWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Confirmar Alteração?"
      subtitle="Confira a mudança antes de salvar"
      onSave={onConfirm}
      saveLabel="Confirmar"
      busy={busy}
      bodyClassName="gap-2 px-4"
    >
      <p className="truncate text-[13px] font-bold text-foreground" title={property}>
        {property}
      </p>
      <div className="flex min-w-0 items-center gap-2">
        <div className={cn(FIN_CARD, "min-w-0 flex-1")}>
          <div className={FIN_CAP}>De</div>
          <div className="mt-[3px] truncate text-[15px] font-semibold text-foreground line-through opacity-60">
            {from}
          </div>
        </div>
        <ArrowRight className="size-4 shrink-0 text-[var(--faint)]" strokeWidth={2.2} />
        <div className={cn(FIN_CARD, "min-w-0 flex-1")}>
          <div className={FIN_CAP}>Para</div>
          <div className="mt-[3px] truncate text-[15px] font-bold text-foreground">{to}</div>
        </div>
      </div>
    </EditWindow>
  );
}

function brl(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Salva com o "Confirmar Alteração?" no meio: Salvar abre a confirmação, Confirmar grava. */
function useConfirmedSave(save: () => Promise<void>, onDone: () => void) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try {
      await save();
      setConfirm(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }
  return { confirm, setConfirm, busy, run };
}

type Ctx = { property: string; owner: string | null };

/* ------------------------------------------------------------- Fin-14 ------------------------------------------------------------- */

export function EditValueWindow({
  open,
  onOpenChange,
  ctx,
  subtitle,
  cents,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: Ctx;
  subtitle: string;
  cents: number | null;
  onSave: (cents: number) => Promise<void>;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (open) setText(centsToReaisInput(cents));
  }, [open, cents]);
  const value = parseReaisInputToCents(text);
  const changed = value != null && value > 0 && value !== cents;
  const c = useConfirmedSave(
    () => onSave(value!),
    () => onOpenChange(false),
  );
  return (
    <>
      <EditWindow
        open={open && !c.confirm}
        onOpenChange={onOpenChange}
        title="Editar Valor"
        subtitle={subtitle}
        canSave={changed}
        onSave={() => c.setConfirm(true)}
      >
        <PropertyContextCard name={ctx.property} owner={ctx.owner} />
        <div>
          <Label>Valor</Label>
          <label className={FIELD}>
            <span className="shrink-0">R$</span>
            <input
              autoFocus
              inputMode="decimal"
              aria-label="Novo valor"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter" && changed) c.setConfirm(true);
              }}
              className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
            />
          </label>
        </div>
      </EditWindow>
      <ConfirmChangeWindow
        open={open && c.confirm}
        onOpenChange={(v) => !v && c.setConfirm(false)}
        property={ctx.property}
        from={brl(cents)}
        to={brl(value)}
        busy={c.busy}
        onConfirm={() => void c.run()}
      />
    </>
  );
}

/* ------------------------------------------------------------- Fin-15 ------------------------------------------------------------- */

const ROW_H = 48;
const VISIBLE = 5;

export function EditProviderWindow({
  open,
  onOpenChange,
  ctx,
  subtitle,
  providers,
  currentId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: Ctx;
  subtitle: string;
  providers: Array<{ id: string; name: string }>;
  currentId: string | null;
  onSave: (providerId: string | null) => Promise<void>;
}) {
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<string | null>(currentId);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setQ("");
      setPick(currentId);
    }
  }, [open, currentId]);
  const rows = useMemo(() => {
    const norm = (s: string) =>
      s
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
    // O atual primeiro; "Sem prestador" sempre no fim da lista.
    const list = [...providers]
      .filter((p) => norm(p.name).includes(norm(q)))
      .sort(
        (a, b) =>
          Number(b.id === currentId) - Number(a.id === currentId) ||
          a.name.localeCompare(b.name, "pt-BR"),
      );
    return [
      ...list.map((p) => ({ id: p.id as string | null, name: p.name })),
      ...(norm("Sem prestador").includes(norm(q)) ? [{ id: null, name: "Sem prestador" }] : []),
    ];
  }, [providers, q, currentId]);
  return (
    <EditWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Alterar Prestador"
      subtitle={subtitle}
      busy={busy}
      canSave={pick !== currentId}
      onSave={async () => {
        setBusy(true);
        try {
          await onSave(pick);
          onOpenChange(false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <PropertyContextCard name={ctx.property} owner={ctx.owner} />
      <label className={cn(FIELD, "justify-start font-medium")}>
        <Search className="size-4 shrink-0 text-[var(--faint)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar prestador"
          aria-label="Buscar prestador"
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[var(--faint)]"
        />
      </label>
      <div>
        <Label>Prestadores · {providers.length}</Label>
        {/* No máximo 5 opções à vista; passou disso, rola com a barra fina e para numa linha inteira. */}
        <div
          className={cn(
            FIN_CARD,
            "sg-elegant-scroll snap-y snap-mandatory overflow-y-auto overscroll-contain p-0",
          )}
          style={{ maxHeight: ROW_H * VISIBLE }}
        >
          {rows.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">
              Nenhum prestador encontrado.
            </p>
          ) : (
            rows.map((p) => {
              const on = p.id === pick;
              return (
                <button
                  key={p.id ?? "none"}
                  type="button"
                  onClick={() => setPick(p.id)}
                  className={cn(
                    "flex w-full snap-start items-center justify-between gap-2 border-b border-foreground/[0.08] px-3 text-left text-[14px] last:border-b-0",
                    on ? "font-bold" : "font-semibold",
                    p.id ? "text-foreground" : "text-[var(--faint)]",
                  )}
                  style={{ height: ROW_H }}
                >
                  <span className="min-w-0 truncate">{p.name}</span>
                  {on ? <Check className="size-4 shrink-0" strokeWidth={2.4} /> : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </EditWindow>
  );
}

/* ------------------------------------------------------------- Fin-16 ------------------------------------------------------------- */

export function EditTypeWindow({
  open,
  onOpenChange,
  ctx,
  type,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: Ctx;
  type: "normal" | "completa";
  onSave: (t: "normal" | "completa") => Promise<void>;
}) {
  const [pick, setPick] = useState(type);
  useEffect(() => {
    if (open) setPick(type);
  }, [open, type]);
  const c = useConfirmedSave(
    () => onSave(pick),
    () => onOpenChange(false),
  );
  const name = (t: string) => (t === "completa" ? "Completa" : "Normal");
  return (
    <>
      <EditWindow
        open={open && !c.confirm}
        onOpenChange={onOpenChange}
        title="Alterar Tipo"
        subtitle="Limpeza normal ou completa"
        canSave={pick !== type}
        onSave={() => c.setConfirm(true)}
      >
        <PropertyContextCard name={ctx.property} owner={ctx.owner} />
        <div>
          <Label>Tipo</Label>
          {/* Seletor segmentado padrão das janelas: trilha única, aba ativa em pastilha clara elevada. */}
          <div className="flex rounded-[12px] bg-foreground/[0.06] p-[3px]">
            {(["normal", "completa"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setPick(t)}
                className={cn(
                  "h-9 flex-1 rounded-[10px] text-[13px] transition-colors",
                  pick === t
                    ? "bg-card font-bold text-foreground shadow-[0_1px_2px_rgba(40,25,10,.12),0_3px_8px_rgba(40,25,10,.06)]"
                    : "font-semibold text-muted-foreground",
                )}
              >
                {name(t)}
              </button>
            ))}
          </div>
        </div>
      </EditWindow>
      <ConfirmChangeWindow
        open={open && c.confirm}
        onOpenChange={(v) => !v && c.setConfirm(false)}
        property={ctx.property}
        from={name(type)}
        to={name(pick)}
        busy={c.busy}
        onConfirm={() => void c.run()}
      />
    </>
  );
}

/* ------------------------------------------------------------- Fin-17 / Fin-21 ------------------------------------------------------------- */

/** Data (yyyy-mm-dd) e hora (HH:MM) de um instante, no fuso de São Paulo. */
function splitSP(iso: string | null): { date: string; time: string } {
  const d = iso ? new Date(iso) : new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
  const time = d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return { date, time };
}
/** Brasil sem horário de verão desde 2019: São Paulo = UTC−03:00. */
function joinSP(date: string, time: string): string {
  return `${date}T${time}:00-03:00`;
}
function maskTime(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
}
const validTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export function EditDateTimeWindow({
  open,
  onOpenChange,
  ctx,
  subtitle,
  iso,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: Ctx;
  subtitle: string;
  iso: string | null;
  onSave: (iso: string) => Promise<void>;
}) {
  const start = splitSP(iso);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [calendar, setCalendar] = useState(false);
  const timeRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      const s = splitSP(iso);
      setDate(s.date);
      setTime(s.time);
    }
  }, [open, iso]);
  const next = validTime(time) ? joinSP(date, time) : null;
  const future = next ? new Date(next).getTime() > Date.now() + 60_000 : false;
  const changed = !!next && !future && (date !== start.date || time !== start.time);
  const c = useConfirmedSave(
    () => onSave(next!),
    () => onOpenChange(false),
  );
  const show = (d: string, t: string) =>
    `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} · ${t}`;
  return (
    <>
      <EditWindow
        open={open && !c.confirm && !calendar}
        onOpenChange={onOpenChange}
        title="Alterar Data e Hora"
        subtitle={subtitle}
        canSave={changed}
        onSave={() => c.setConfirm(true)}
      >
        <PropertyContextCard name={ctx.property} owner={ctx.owner} />
        <div className="flex gap-2.5">
          <div className="min-w-0 flex-[1.3]">
            <Label>Data</Label>
            <button
              type="button"
              className={FIELD}
              onClick={() => setCalendar(true)}
              aria-label="Escolher nova data"
            >
              <span className="tabular-nums">{`${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`}</span>
              <CalendarDays className="size-4 shrink-0 text-[var(--faint)]" />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <Label>Hora</Label>
            <label className={FIELD}>
              <input
                ref={timeRef}
                inputMode="numeric"
                aria-label="Hora"
                placeholder="hh:mm"
                value={time}
                onChange={(e) => setTime(maskTime(e.target.value))}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 bg-transparent tabular-nums outline-none"
              />
              <Clock className="size-4 shrink-0 text-[var(--faint)]" />
            </label>
          </div>
        </div>
        {future ? (
          <p className="-mt-3 text-[12px] font-semibold text-destructive">
            A conclusão não pode ficar no futuro.
          </p>
        ) : null}
      </EditWindow>
      <CalendarWindow
        open={open && calendar}
        onOpenChange={setCalendar}
        title="Escolher Nova Data"
        value={isoToLocalDate(date)}
        max={todaySaoPauloDate()}
        onPick={(d) => setDate(localDateToIso(d))}
      />
      <ConfirmChangeWindow
        open={open && c.confirm}
        onOpenChange={(v) => !v && c.setConfirm(false)}
        property={ctx.property}
        from={show(start.date, start.time)}
        to={show(date, time)}
        busy={c.busy}
        onConfirm={() => void c.run()}
      />
    </>
  );
}

/* ------------------------------------------------------------- Fin-18 ------------------------------------------------------------- */

export function EditSituationWindow({
  open,
  onOpenChange,
  title,
  description,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string | null;
  onSave: (v: { title: string; description: string | null }) => Promise<void>;
}) {
  const [t, setT] = useState(title);
  const [d, setD] = useState(description ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setT(title);
      setD(description ?? "");
    }
  }, [open, title, description]);
  const changed =
    t.trim().length > 0 && (t.trim() !== title.trim() || d.trim() !== (description ?? "").trim());
  return (
    <EditWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Editar Situação"
      subtitle="Título e descrição do serviço extra"
      busy={busy}
      canSave={changed}
      onSave={async () => {
        setBusy(true);
        try {
          await onSave({ title: t.trim(), description: d.trim() || null });
          onOpenChange(false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <Label>Título</Label>
        <input
          value={t}
          maxLength={200}
          onChange={(e) => setT(e.target.value)}
          aria-label="Título"
          className={FIELD}
        />
      </div>
      <div>
        <Label>Descrição</Label>
        <textarea
          value={d}
          maxLength={4000}
          onChange={(e) => setD(e.target.value)}
          aria-label="Descrição"
          rows={4}
          className={cn(
            FIELD,
            "block h-auto min-h-[88px] resize-none py-3 text-[14px] font-medium leading-5",
          )}
        />
      </div>
    </EditWindow>
  );
}

/* ------------------------------------------------------------- Fin-19 ------------------------------------------------------------- */

export type EditableMedia = { id: string; kind: string; url: string | null };

export function EditMediaWindow({
  open,
  onOpenChange,
  media,
  onRemove,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  media: EditableMedia[];
  /** Remove já (o arquivo vai para a lixeira de 30 dias, como nos Registros). */
  onRemove: (id: string) => Promise<void>;
  onAdd: (files: File[]) => Promise<void>;
}) {
  const [removed, setRemoved] = useState<string[]>([]);
  const [added, setAdded] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) {
      setRemoved([]);
      setAdded([]);
    }
  }, [open]);
  const previews = useMemo(() => added.map((f) => ({ f, url: URL.createObjectURL(f) })), [added]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);
  const tile = "relative h-20 w-24 shrink-0 overflow-hidden rounded-[10px]";
  const rm = (onClick: () => void) => (
    <button
      type="button"
      aria-label="Remover"
      onClick={onClick}
      className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white"
    >
      <X className="size-2.5" strokeWidth={3} />
    </button>
  );
  const thumb = (url: string | null, kind: string) =>
    url && kind === "photo" ? (
      <img src={url} alt="" className="size-full object-cover" />
    ) : url && kind === "video" ? (
      <video src={url} muted playsInline preload="metadata" className="size-full object-cover" />
    ) : (
      <span className="grid size-full place-items-center bg-foreground/[0.08] text-[11px] font-semibold text-muted-foreground">
        Arquivo
      </span>
    );
  return (
    <EditWindow
      open={open}
      onOpenChange={onOpenChange}
      title="Editar Fotos e Vídeos"
      subtitle="Adicione ou remova arquivos"
      busy={busy}
      canSave={removed.length > 0 || added.length > 0}
      onSave={async () => {
        setBusy(true);
        try {
          for (const id of removed) await onRemove(id);
          if (added.length > 0) await onAdd(added);
          onOpenChange(false);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap gap-2">
        {media
          .filter((m) => !removed.includes(m.id))
          .map((m) => (
            <div key={m.id} className={tile}>
              {thumb(m.url, m.kind)}
              {rm(() => setRemoved((r) => [...r, m.id]))}
            </div>
          ))}
        {previews.map((p, i) => (
          <div key={p.url} className={tile}>
            {thumb(p.url, p.f.type.startsWith("video/") ? "video" : "photo")}
            {rm(() => setAdded((a) => a.filter((_, j) => j !== i)))}
          </div>
        ))}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className={cn(
            tile,
            "flex flex-col items-center justify-center gap-1 border-[1.5px] border-dashed border-foreground/25 text-[11.5px] font-semibold text-muted-foreground",
          )}
        >
          <Plus className="size-[18px]" strokeWidth={2.2} />
          Adicionar
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => {
            const fs = Array.from(e.target.files ?? []);
            if (fs.length) setAdded((a) => [...a, ...fs]);
            e.target.value = "";
          }}
        />
      </div>
    </EditWindow>
  );
}
