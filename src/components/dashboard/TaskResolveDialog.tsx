/**
 * "CONCLUIR PENDÊNCIA" — janela de prestação de contas da despesa.
 *
 * Implementação FIEL dos mockups aprovados em 23/10/2026:
 *   · 0i  "Despesa clean"       — a janela compacta;
 *   · 0j  "Diferença"           — confirmação quando "Valor a pagar" ≠ "Valor da resolução";
 *   · 0k  "Quem deve pagar"     — regras do seletor de partes.
 *
 * Substitui o `TaskResolveDialog` que morava dentro do `OperationWorkspace`
 * (que segue exportando o MESMO nome, agora vindo daqui — os dois gatilhos,
 * Pendências e checklist da limpeza, continuam intactos).
 *
 * REGRAS DO SELETOR "QUEM DEVE PAGAR" (mockup 0k — a situação está sempre
 * atrelada a um imóvel e, às vezes, a uma reserva; quem NÃO teve a ver com ela
 * não pode ser trocado):
 *   · Proprietário — FIXO: o dono do imóvel da pendência (campo travado);
 *   · Hóspede      — FIXO: o da reserva vinculada (travado). Sem reserva, a
 *                    opção fica indisponível;
 *   · Anfitrião    — a própria empresa da conta (nome fantasia cadastrado, em
 *                    UMA linha com reticências). Sem campo extra;
 *   · Prestador    — o ÚNICO escolhível: "Qual prestador?" abre a lista dos
 *                    prestadores cadastrados (busca por nome, cidade ou tipo).
 * O servidor repete essas regras (tasks.functions.ts → resolveParty): a tela
 * guia, o servidor garante.
 *
 * DIFERENÇA: se "Valor a pagar" ≠ "Valor da resolução" (para cima OU para
 * baixo), ao Concluir pergunta-se para quem vai a diferença. Não existe
 * "ninguém, só registrar" (removido a pedido).
 *
 * Tudo é OPCIONAL, como sempre: dá para concluir com tudo em branco.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock3,
  FileText,
  Home,
  Image as ImageIcon,
  Lock,
  Mic,
  Paperclip,
  User,
  Video,
  Camera,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MoneyInput } from "@/components/ui/money-input";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { AudioRecorderButton } from "@/components/handoff/AudioRecorderButton";
import { AttachmentsSending, type PendingAttachment } from "@/components/dashboard/TaskAttachments";
import type { TaskLinkProvider, TaskParty, TaskRow } from "@/lib/tasks-types";

/** Tudo que a janela devolve ao gatilho (Pendências ou checklist da limpeza). */
export type ResolveValues = {
  /** "Valor da resolução". */
  amountSpentCents: number | null;
  /** "Quem resolveu". */
  providerId: string | null;
  note: string | null;
  files: PendingAttachment[];
  /** "Já recebeu" do valor da resolução. */
  resolutionReceived: boolean;
  /** "Valor a pagar". */
  amountDueCents: number | null;
  /** "Quem deve pagar" (+ id só para prestador; o servidor deriva o resto). */
  costPayer: TaskParty | null;
  costPayerId: string | null;
  /** "Quem pagou" / "Valor pago" — só quando "Já foi pago". */
  paidBy: TaskParty | null;
  paidById: string | null;
  amountPaidCents: number | null;
  /** Diferença com sinal (valor a pagar − valor da resolução) e destino. */
  differenceCents: number | null;
  differenceTo: TaskParty | null;
  differenceToId: string | null;
};

/** Campos de despesa no formato que o servidor espera (setTaskStatus e
 * toggleCleaningCompletion aceitam os mesmos nomes). */
export function settlementToServer(v: ResolveValues) {
  return {
    amountSpentCents: v.amountSpentCents,
    resolvedByProviderId: v.providerId,
    resolutionNote: v.note,
    resolutionReceived: v.resolutionReceived,
    amountDueCents: v.amountDueCents,
    costPayer: v.costPayer,
    costPayerId: v.costPayerId,
    paidBy: v.paidBy,
    paidById: v.paidById,
    amountPaidCents: v.amountPaidCents,
    differenceCents: v.differenceCents,
    differenceTo: v.differenceTo,
    differenceToId: v.differenceToId,
  };
}

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
function fmtBRL(cents: number): string {
  return BRL.format(cents / 100).replace(/ /g, " ");
}

/** Botão rotulado do padrão da casa (mesmo de "Registrar situação"). */
const BTN_PRIMARY =
  "rounded-[5px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-4 py-2 text-xs font-bold text-white disabled:opacity-60";
const BTN_GHOST = "rounded-md px-2.5 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50";

/** Caixa de campo (44px) com rótulo de 9px — comum a todos os campos da janela. */
function Field({
  label,
  locked,
  children,
  className = "",
}: {
  label: string;
  locked?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex h-11 min-w-0 flex-col justify-center rounded-lg border px-2.5 ${
        locked ? "border-border/60 bg-muted/30" : "border-input bg-background"
      } ${className}`}
    >
      <span className="block text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

const MONEY_CLASS =
  "h-auto w-full rounded-none border-0 bg-transparent p-0 text-[12.5px] font-bold shadow-none focus-visible:ring-0 focus-visible:ring-offset-0";

/** Alternador de dois estados (Não recebeu | Já recebeu, A pagar | Já foi pago). */
function TwoState({
  a,
  b,
  value,
  onChange,
  disabled,
}: {
  a: string;
  b: string;
  value: 0 | 1;
  onChange: (v: 0 | 1) => void;
  disabled?: boolean;
}) {
  const cell = (label: string, idx: 0 | 1) => {
    const active = value === idx;
    return (
      <button
        key={label}
        type="button"
        disabled={disabled}
        aria-pressed={active}
        onClick={() => onChange(idx)}
        className={`flex h-8 items-center justify-center gap-1.5 rounded-lg text-[12.5px] transition-colors ${
          active
            ? "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] font-bold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_60%,transparent)]"
            : "font-semibold text-muted-foreground"
        }`}
      >
        {idx === 0 ? (
          <Clock3 className={`size-3.5 ${active ? "text-[var(--accent)]" : ""}`} />
        ) : (
          <Check className={`size-3.5 ${active ? "text-[var(--accent)]" : ""}`} strokeWidth={3} />
        )}
        {label}
      </button>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-[3px] rounded-[10px] bg-foreground/[0.045] p-[3px]">
      {cell(a, 0)}
      {cell(b, 1)}
    </div>
  );
}

/** Lista de prestadores cadastrados (busca por nome, cidade ou tipo) dentro
 * de um popover — a MESMA do "Quem resolveu" e do "Qual prestador?". */
function ProviderPicker({
  label,
  placeholder,
  providers,
  value,
  onChange,
  allowClear,
}: {
  label: string;
  placeholder: string;
  providers: TaskLinkProvider[];
  value: string | null;
  onChange: (id: string | null) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = providers.find((p) => p.id === value) ?? null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full min-w-0 flex-col justify-center rounded-lg border border-input bg-background px-2.5 text-left"
        >
          <span className="block text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className={`min-w-0 flex-1 truncate text-[12.5px] ${selected ? "font-bold" : "font-normal text-muted-foreground"}`}
            >
              {selected ? selected.name : placeholder}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Buscar por nome, cidade ou tipo…" />
          <CommandList className="sg-elegant-scroll max-h-56">
            <CommandEmpty>Nenhum prestador encontrado.</CommandEmpty>
            <CommandGroup>
              {allowClear && selected && (
                <CommandItem
                  value="__limpar__ remover"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="cursor-pointer text-muted-foreground"
                >
                  <X className="size-3.5 shrink-0" /> Sem responsável
                </CommandItem>
              )}
              {providers.map((p) => (
                <CommandItem
                  key={p.id}
                  // O `value` é o que a busca do Command filtra: nome + cidade
                  // + categorias, atendendo os três critérios.
                  value={`${p.name} ${p.city ?? ""} ${p.categories.join(" ")}`}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                  className="cursor-pointer"
                >
                  <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border/60 bg-secondary/50 text-[9px] font-bold text-muted-foreground">
                    {p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{p.name}</span>
                    {(p.city || p.categories.length > 0) && (
                      <span className="block truncate text-[10px] capitalize text-muted-foreground">
                        {[p.categories.join(" · "), p.city].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                  {value === p.id && <Check className="size-3.5 shrink-0 text-emerald-500" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Seletor das quatro partes. O nome do anfitrião é o da empresa cadastrada,
 * numa linha só (reticências). Opções sem vínculo ficam indisponíveis. */
function PartyPicker({
  label,
  value,
  onChange,
  labels,
  available,
}: {
  label: string;
  value: TaskParty;
  onChange: (p: TaskParty) => void;
  labels: Record<TaskParty, string>;
  available: Record<TaskParty, string | null>; // null = disponível; texto = motivo
}) {
  const [open, setOpen] = useState(false);
  const order: TaskParty[] = ["owner", "guest", "company", "provider"];
  const shown = (p: TaskParty) => (p === "owner" ? "Proprietário" : p === "guest" ? "Hóspede" : p === "provider" ? "Prestador" : labels.company);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-11 w-full min-w-0 flex-col justify-center rounded-lg border border-input bg-background px-2.5 text-left"
        >
          <span className="block text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{shown(value)}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-1">
        {order.map((p) => {
          const reason = available[p];
          return (
            <button
              key={p}
              type="button"
              disabled={!!reason}
              title={reason ?? undefined}
              onClick={() => {
                onChange(p);
                setOpen(false);
              }}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{shown(p)}</span>
              {value === p && <Check className="size-3.5 shrink-0 text-emerald-500" />}
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

/** Campo TRAVADO (proprietário/hóspede da situação — não se troca). */
function LockedField({ label, value }: { label: string; value: string }) {
  return (
    <Field label={label} locked>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{value}</span>
        <Lock className="size-3.5 shrink-0 text-muted-foreground" aria-label="Não editável" />
      </span>
    </Field>
  );
}

/** Comprovação: texto + Foto/Vídeo/Galeria/Arquivo/microfone numa só caixa. */
function ProofBox({
  note,
  onNote,
  files,
  onFiles,
  disabled,
}: {
  note: string;
  onNote: (v: string) => void;
  files: PendingAttachment[];
  onFiles: (f: PendingAttachment[]) => void;
  disabled?: boolean;
}) {
  const photoRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);

  function kindOf(mime: string): PendingAttachment["kind"] {
    if (mime.startsWith("image/")) return "photo";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "file";
  }
  function add(blob: Blob, name: string, mime: string, durationMs?: number) {
    onFiles([...files, { key: crypto.randomUUID(), blob, name, mime, durationMs, kind: kindOf(mime) }]);
  }
  function picked(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) add(f, f.name, f.type || "application/octet-stream");
  }
  const iconBtn =
    "grid h-7 w-[30px] place-items-center rounded-md text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50";

  return (
    <div className="rounded-lg border border-input bg-background px-2.5 pb-1.5 pt-2">
      <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={picked} />
      <input ref={videoRef} type="file" accept="video/*" capture="environment" className="hidden" onChange={picked} />
      <input ref={galRef} type="file" accept="image/*,video/*" className="hidden" onChange={picked} />
      <input ref={fileRef} type="file" className="hidden" onChange={picked} />
      <textarea
        value={note}
        onChange={(e) => onNote(e.target.value)}
        rows={2}
        maxLength={2000}
        disabled={disabled}
        placeholder="Como foi resolvido…"
        className="block min-h-[38px] w-full resize-none bg-transparent text-[12.5px] leading-[1.4] outline-none placeholder:text-muted-foreground"
      />
      {files.length > 0 && (
        <div className="mb-1 mt-1 flex flex-col gap-1">
          {files.map((f) => (
            <div key={f.key} className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2 py-1">
              {f.kind === "photo" ? (
                <Camera className="size-3.5 shrink-0 text-muted-foreground" />
              ) : f.kind === "video" ? (
                <Video className="size-3.5 shrink-0 text-muted-foreground" />
              ) : f.kind === "audio" ? (
                <Mic className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">{f.name}</span>
              <button
                type="button"
                onClick={() => onFiles(files.filter((x) => x.key !== f.key))}
                aria-label="Remover anexo"
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-destructive"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {recording ? (
        <AudioRecorderButton
          autoStart
          maxSeconds={120}
          compact
          onCancel={() => setRecording(false)}
          onRecorded={(a) => {
            setRecording(false);
            add(a.blob, `audio-${Date.now()}.${a.mime.includes("mp4") ? "m4a" : "webm"}`, a.mime, a.durationMs);
          }}
        />
      ) : (
        <div className="-mx-1 flex items-center gap-0.5">
          <button type="button" disabled={disabled} className={iconBtn} title="Foto" aria-label="Foto" onClick={() => photoRef.current?.click()}>
            <Camera className="size-[15px]" />
          </button>
          <button type="button" disabled={disabled} className={iconBtn} title="Vídeo" aria-label="Vídeo" onClick={() => videoRef.current?.click()}>
            <Video className="size-[15px]" />
          </button>
          <button type="button" disabled={disabled} className={iconBtn} title="Galeria" aria-label="Galeria" onClick={() => galRef.current?.click()}>
            <ImageIcon className="size-[15px]" />
          </button>
          <button type="button" disabled={disabled} className={iconBtn} title="Arquivo" aria-label="Arquivo" onClick={() => fileRef.current?.click()}>
            <Paperclip className="size-[15px]" />
          </button>
          <button
            type="button"
            disabled={disabled}
            className={`${iconBtn} ml-auto`}
            title="Gravar áudio"
            aria-label="Gravar áudio"
            onClick={() => setRecording(true)}
          >
            <Mic className="size-[15px]" />
          </button>
        </div>
      )}
    </div>
  );
}

export function TaskResolveDialog({
  state,
  onOpenChange,
  providers,
  companyName,
  guestName,
  onConfirm,
}: {
  state: { kind: "status" | "cleaning"; task: TaskRow } | null;
  onOpenChange: (v: boolean) => void;
  providers: TaskLinkProvider[];
  /** Nome fantasia da empresa da conta (o "Anfitrião Sigma"). */
  companyName?: string | null;
  /** Nome do hóspede da reserva da pendência, quando o gatilho sabe. */
  guestName?: string | null;
  onConfirm: (v: ResolveValues) => Promise<void>;
}) {
  const task = state?.task;
  const hasOwner = !!(task?.ownerContactId || task?.ownerName);
  const hasStay = !!(task?.reservationId || task?.logId);
  const ownerName = task?.ownerName ?? "";
  const guestLabel = guestName?.trim() || "Hóspede";

  const [providerId, setProviderId] = useState<string | null>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [received, setReceived] = useState<0 | 1>(0);
  const [payer, setPayer] = useState<TaskParty>("company");
  const [payerProvider, setPayerProvider] = useState<string | null>(null);
  const [dueCents, setDueCents] = useState<number | null>(null);
  const [dueTouched, setDueTouched] = useState(false);
  const [paid, setPaid] = useState<0 | 1>(0);
  const [paidBy, setPaidBy] = useState<TaskParty>("company");
  const [paidProvider, setPaidProvider] = useState<string | null>(null);
  const [paidCents, setPaidCents] = useState<number | null>(null);
  const [paidTouched, setPaidTouched] = useState(false);
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [askDiff, setAskDiff] = useState(false);
  const [diffTo, setDiffTo] = useState<TaskParty | null>(null);
  /** Prestador do destino da diferença — só pedido quando nenhum prestador foi
   * escolhido antes (nem em "Quem resolveu", nem em "Quem deve pagar"). */
  const [diffProvider, setDiffProvider] = useState<string | null>(null);

  // Reabrir a janela para outra pendência não pode herdar o que foi digitado
  // na anterior.
  useEffect(() => {
    if (!state) return;
    const t = state.task;
    const spent = t.amountSpentCents ?? null;
    setProviderId(null);
    setCents(spent);
    setReceived(0); // pré-selecionado: "Não recebeu"
    setPayer(t.ownerContactId || t.ownerName ? "owner" : "company");
    setPayerProvider(null);
    setDueCents(spent); // "Valor a pagar" nasce com o valor total
    setDueTouched(false);
    setPaid(0); // pré-selecionado: "A pagar"
    setPaidBy(t.ownerContactId || t.ownerName ? "owner" : "company");
    setPaidProvider(null);
    setPaidCents(spent);
    setPaidTouched(false);
    setNote("");
    setFiles([]);
    setSaving(false);
    setAskDiff(false);
    setDiffTo(null);
    setDiffProvider(null);
  }, [state?.task.id, state?.kind]);

  const labels: Record<TaskParty, string> = {
    company: companyName?.trim() || "Anfitrião",
    owner: "Proprietário",
    provider: "Prestador",
    guest: "Hóspede",
  };
  const available: Record<TaskParty, string | null> = {
    company: null,
    provider: null,
    owner: hasOwner ? null : "Esta situação não tem proprietário vinculado.",
    guest: hasStay ? null : "Esta situação não tem reserva (hóspede) vinculada.",
  };

  function onSpent(v: number | null) {
    setCents(v);
    // O valor a pagar acompanha o total até a pessoa mexer nele.
    if (!dueTouched) {
      setDueCents(v);
      if (!paidTouched) setPaidCents(v);
    }
  }
  function onDue(v: number | null) {
    setDueTouched(true);
    setDueCents(v);
    if (!paidTouched) setPaidCents(v);
  }
  function setPaidState(v: 0 | 1) {
    setPaid(v);
    if (v === 1) {
      // "Quem pagou" começa igual a "Quem deve pagar"; "Valor pago" = a pagar.
      setPaidBy(payer);
      setPaidProvider(payerProvider);
      if (!paidTouched) setPaidCents(dueCents);
    }
  }

  /** Linha de "Qual…?" / campo travado que acompanha uma parte. */
  function qualRow(party: TaskParty, prov: string | null, setProv: (id: string | null) => void) {
    if (party === "owner") return <LockedField label="Proprietário" value={ownerName || "—"} />;
    if (party === "guest") return <LockedField label="Hóspede" value={guestLabel} />;
    if (party === "provider")
      return (
        <ProviderPicker
          label="Qual prestador?"
          placeholder="Selecione o prestador"
          providers={providers}
          value={prov}
          onChange={setProv}
        />
      );
    return null; // anfitrião: sem campo extra
  }

  /** Prestador já conhecido da situação (o do "Quem deve pagar" ou o que resolveu). */
  const knownProvider = (payer === "provider" ? payerProvider : null) ?? providerId ?? null;
  const spentN = cents ?? 0;
  const dueN = dueCents ?? 0;
  const hasMoney = spentN > 0 || dueN > 0;
  const diff = cents != null && dueCents != null ? dueCents - cents : 0;

  function buildValues(to: TaskParty | null): ResolveValues {
    const money = hasMoney;
    const toId =
      to === "provider" ? (knownProvider ?? diffProvider) : null; // owner/guest/company: o servidor deriva
    return {
      amountSpentCents: cents,
      providerId,
      note: note.trim() || null,
      files,
      resolutionReceived: received === 1,
      amountDueCents: dueCents,
      costPayer: money ? payer : null,
      costPayerId: money && payer === "provider" ? payerProvider : null,
      paidBy: money && paid === 1 ? paidBy : null,
      paidById: money && paid === 1 && paidBy === "provider" ? paidProvider : null,
      amountPaidCents: money && paid === 1 ? paidCents : null,
      differenceCents: cents != null && dueCents != null ? diff : null,
      differenceTo: diff !== 0 ? to : null,
      differenceToId: diff !== 0 ? toId : null,
    };
  }

  async function finish(to: TaskParty | null) {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm(buildValues(to));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não consegui concluir a pendência.");
      setSaving(false);
    }
  }

  function submit() {
    if (saving) return;
    if (hasMoney && payer === "provider" && !payerProvider) {
      toast.error("Quem deve pagar: escolha o prestador.");
      return;
    }
    if (hasMoney && paid === 1 && paidBy === "provider" && !paidProvider) {
      toast.error("Quem pagou: escolha o prestador.");
      return;
    }
    if (diff !== 0) {
      // Valor a pagar ≠ valor da resolução → decidir o destino da diferença.
      setAskDiff(true);
      return;
    }
    void finish(null);
  }

  // Destinos possíveis da diferença (mockup 0j) e por que algum fica indisponível.
  // Prestador sempre pode: se nenhum foi escolhido antes, pede-se qual logo abaixo.
  const diffAvail: Record<TaskParty, string | null> = {
    owner: available.owner,
    guest: available.guest,
    company: null,
    provider: null,
  };
  const needDiffProvider = diffTo === "provider" && !knownProvider;

  return (
    <>
      <Dialog open={!!state && !askDiff} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[480px]">
          <DialogTitle className="sr-only">Concluir pendência</DialogTitle>
          <DialogDescription className="sr-only">
            Registre quem resolveu, quanto custou, quem deve pagar e a comprovação.
          </DialogDescription>

          {/* Cabeçalho: título + imóvel + proprietário (com o ícone de mensagem). */}
          <div className="border-b border-border/60 px-4 pb-3 pt-4">
            <h2 className="ds-page-title truncate pr-9">Concluir pendência</h2>
            {task?.propertyName && (
              <div className="mt-1.5 flex min-w-0 items-center gap-[5px] text-[11px] font-medium text-foreground/70">
                <Home className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">{task.propertyName}</span>
              </div>
            )}
            {task?.ownerName && (
              <div className="mt-[3px] flex min-w-0 items-center gap-[5px] text-[11px] font-medium text-foreground/70">
                <User className="size-3 shrink-0 text-muted-foreground" />
                <span className="truncate">Proprietário(a): {task.ownerName}</span>
                <PhoneActionButton
                  phone={task.ownerPhone}
                  country={task.ownerPhoneCountry}
                  size={13}
                  alwaysShow
                  className="!p-0"
                />
              </div>
            )}
          </div>

          <div className="sg-elegant-scroll flex max-h-[62vh] flex-col gap-2 overflow-y-auto px-4 py-3.5">
            {/* A situação (somente leitura) — deixa claro DO QUE se trata. */}
            <div className="rounded-lg border border-border/60 bg-foreground/[0.04] px-2.5 py-[7px]">
              <div className="text-[9px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                Situação
              </div>
              <div className="mt-0.5 text-[12.5px] font-bold leading-[1.35]">{task?.title}</div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ProviderPicker
                label="Quem resolveu"
                placeholder="Selecione"
                providers={providers}
                value={providerId}
                onChange={setProviderId}
                allowClear
              />
              <Field label="Valor da resolução">
                <MoneyInput cents={cents} onChange={onSpent} placeholder="0,00" className={MONEY_CLASS} />
              </Field>
            </div>
            <TwoState a="Não recebeu" b="Já recebeu" value={received} onChange={setReceived} />

            <div className="grid grid-cols-2 gap-2">
              <PartyPicker
                label="Quem deve pagar"
                value={payer}
                onChange={(p) => {
                  setPayer(p);
                  if (p !== "provider") setPayerProvider(null);
                }}
                labels={labels}
                available={available}
              />
              <Field label="Valor a pagar">
                <MoneyInput cents={dueCents} onChange={onDue} placeholder="0,00" className={MONEY_CLASS} />
              </Field>
            </div>
            {qualRow(payer, payerProvider, setPayerProvider)}
            <TwoState a="A pagar" b="Já foi pago" value={paid} onChange={setPaidState} />

            {paid === 1 && (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <PartyPicker
                    label="Quem pagou"
                    value={paidBy}
                    onChange={(p) => {
                      setPaidBy(p);
                      if (p !== "provider") setPaidProvider(null);
                    }}
                    labels={labels}
                    available={available}
                  />
                  <Field label="Valor pago">
                    <MoneyInput
                      cents={paidCents}
                      onChange={(v) => {
                        setPaidTouched(true);
                        setPaidCents(v);
                      }}
                      placeholder="0,00"
                      className={MONEY_CLASS}
                    />
                  </Field>
                </div>
                {qualRow(paidBy, paidProvider, setPaidProvider)}
              </>
            )}

            <ProofBox note={note} onNote={setNote} files={files} onFiles={setFiles} disabled={saving} />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-2.5">
            {saving && <AttachmentsSending count={files.length} />}
            <button type="button" onClick={() => onOpenChange(false)} disabled={saving} className={BTN_GHOST}>
              Cancelar
            </button>
            <button type="button" onClick={submit} disabled={saving} className={BTN_PRIMARY}>
              {saving ? "Concluindo…" : "Concluir"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 0j — "Há uma diferença de valores". */}
      <Dialog
        open={!!state && askDiff}
        onOpenChange={(v) => {
          if (!v && !saving) setAskDiff(false);
        }}
      >
        <DialogContent className="w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0 sm:max-w-[440px]">
          <DialogDescription className="sr-only">
            Escolha para quem vai a diferença entre o valor a pagar e o valor da resolução.
          </DialogDescription>
          <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
            <span className="grid size-8 shrink-0 place-items-center rounded-[9px] bg-[rgba(201,169,98,.14)] text-[#c9a962]">
              <AlertTriangle className="size-[17px]" />
            </span>
            <div className="min-w-0 pr-8">
              <DialogTitle className="ds-page-title truncate">Há uma diferença de valores</DialogTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                Antes de concluir, decida o destino dela.
              </p>
            </div>
          </div>

          <div className="mx-4 flex flex-col gap-1.5 rounded-[10px] border border-border/60 bg-foreground/[0.04] px-3 py-2.5">
            <SumRow label="Valor da resolução" value={fmtBRL(spentN)} />
            <SumRow label="Valor a pagar" value={fmtBRL(dueN)} />
            <span className="h-px bg-border/70" />
            <SumRow
              label={`Diferença (${diff < 0 ? "a menos" : "a mais"})`}
              value={`${diff < 0 ? "−" : "+"} ${fmtBRL(Math.abs(diff))}`}
              strong
            />
          </div>

          <div className="px-4 pb-1 pt-3.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            Para quem vai essa diferença?
          </div>
          <div className="grid grid-cols-2 gap-1.5 px-4 pb-3.5 pt-1.5">
            {(["owner", "company", "provider", "guest"] as TaskParty[]).map((p) => {
              const reason = diffAvail[p];
              const sel = diffTo === p;
              return (
                <button
                  key={p}
                  type="button"
                  disabled={!!reason || saving}
                  title={reason ?? undefined}
                  aria-pressed={sel}
                  onClick={() => setDiffTo(p)}
                  className={`flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    sel
                      ? "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] font-bold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--accent)_60%,transparent)]"
                      : "bg-foreground/[0.045] font-semibold text-foreground/75"
                  }`}
                >
                  {sel && <Check className="size-3.5 shrink-0 text-[var(--accent)]" strokeWidth={3} />}
                  <span className="min-w-0 truncate">
                    {p === "owner" ? "Proprietário" : p === "guest" ? "Hóspede" : p === "provider" ? "Prestador" : labels.company}
                  </span>
                </button>
              );
            })}
          </div>

          {needDiffProvider && (
            <div className="px-4 pb-3.5">
              <ProviderPicker
                label="Qual prestador?"
                placeholder="Selecione o prestador"
                providers={providers}
                value={diffProvider}
                onChange={setDiffProvider}
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-border/60 px-4 py-2.5">
            <button type="button" onClick={() => setAskDiff(false)} disabled={saving} className={BTN_GHOST}>
              Voltar
            </button>
            <button
              type="button"
              disabled={!diffTo || (needDiffProvider && !diffProvider) || saving}
              onClick={() => void finish(diffTo)}
              className={BTN_PRIMARY}
            >
              {saving ? "Concluindo…" : "Confirmar e concluir"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SumRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2.5">
      <span className={strong ? "text-[12.5px] font-semibold" : "text-[12.5px] text-muted-foreground"}>{label}</span>
      <span
        className={`tabular-nums ${strong ? "text-sm font-bold text-[#c9a962]" : "text-[12.5px] font-bold"}`}
      >
        {value}
      </span>
    </div>
  );
}
