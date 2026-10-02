import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarCheck,
  Check,
  Home,
  Layers,
  Plus,
  PlusCircle,
  Replace,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MoneyInput } from "@/components/ui/money-input";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterDateCalendar,
  FilterOptionRow,
  FilterScreenHeader,
} from "@/components/dashboard/filter-panel";
import { ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import {
  createManualCleaning,
  getManualCleaningAccess,
  getManualCleaningOptions,
  type ManualCleaningConflict,
} from "@/lib/manual-cleaning.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { cn } from "@/lib/utils";

/**
 * "NOVA LIMPEZA" — o "+" ao lado de Filtros e o quadrante em perguntas
 * (mockup "Nova limpeza em perguntas · v2.1", aprovado 02/10/2026).
 *
 * Por que é assim:
 *  · O cliente recusou a primeira versão (uma lista de campos) e pediu
 *    "campos de perguntas... mais clean, mais bonito": virou uma trilha de
 *    seis perguntas, UMA aberta por vez. A respondida recolhe, ganha o check
 *    verde e mostra a resposta; tocar nela reabre para trocar.
 *  · A trilha usa o mesmo desenho do passo a passo do quadrante "Acesso"
 *    (círculo de 22px + fio), para não nascer uma linguagem visual nova.
 *  · Casca, folga lateral e distância do botão são as dos Filtros
 *    (`FILTER_PANEL_CLASS`, 300px). Véu com desfoque, limite de 75% da altura
 *    e anti-corte vêm do `PopoverContent` base.
 *  · "Clique ao fundo retorna à página anterior": com o aviso "Já existe uma
 *    limpeza" aberto, tocar fora VOLTA para a trilha em vez de fechar.
 *  · RETICÊNCIAS, NUNCA QUEBRA (pedido explícito, 02/10/2026, duas vezes no
 *    mesmo mockup): o campo de busca e os atalhos de data ficam sempre em uma
 *    linha; o que não cabe corta com "…".
 *  · "Criar limpeza" só acende com as seis respostas dadas.
 *  · O valor nasce com o preço do tipo escolhido e acompanha a troca de tipo
 *    — a menos que já tenha sido alterado à mão, aí ele é respeitado.
 *  · O "+" só aparece para quem pode criar (ver `manual-cleaning.functions.ts`).
 */

const QUESTIONS = [
  "Vincular a um imóvel ou a uma reserva?",
  "Qual imóvel ou reserva?",
  "Para qual prestador?",
  "Para qual data?",
  "Qual tipo de limpeza?",
  "Confirme o valor desta limpeza!",
] as const;

function brl(c: number | null | undefined) {
  if (c == null) return "Sem preço cadastrado";
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function ddmm(iso: string | null) {
  return iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "";
}
function isoOf(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** "Hoje" em São Paulo, como data local do calendário. */
function todaySP(): Date {
  const iso = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function dateLabel(d: Date, today: Date) {
  const diff = Math.round((d.getTime() - today.getTime()) / 86400_000);
  const wd = d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const dm = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prefix = diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : null;
  return prefix ? `${prefix}, ${wd}. ${dm}` : `${wd.charAt(0).toUpperCase()}${wd.slice(1)}., ${dm}`;
}
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Uma pergunta da trilha: respondida, ativa ou futura. */
function Step({
  n,
  active,
  done,
  last,
  question,
  answer,
  onReopen,
  children,
}: {
  n: number;
  active: boolean;
  done: boolean;
  last?: boolean;
  question: string;
  answer?: string;
  onReopen: () => void;
  children?: ReactNode;
}) {
  return (
    <li className="relative grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 pb-3.5">
      {!last && (
        <span
          aria-hidden
          className="absolute bottom-0.5 left-[10.5px] top-6 w-px bg-[var(--panel-div)]"
        />
      )}
      <span
        className={cn(
          "relative z-[1] grid size-[22px] place-items-center rounded-full text-[10.5px] font-extrabold",
          done
            ? "bg-[rgba(127,183,154,.16)] text-[#7fb79a]"
            : active
              ? "bg-accent/[0.14] text-accent"
              : "bg-foreground/[0.05] text-foreground/35",
        )}
      >
        {done ? <Check className="size-3" strokeWidth={3} /> : n}
      </span>
      <div className="min-w-0 pt-[3px]">
        {done && !active ? (
          <button
            type="button"
            onClick={onReopen}
            title="Alterar esta resposta"
            className="block w-full min-w-0 text-left"
          >
            <span className="block truncate text-[10.5px] leading-tight text-muted-foreground">
              {question}
            </span>
            <span className="mt-0.5 block truncate text-[13px] font-bold leading-snug text-foreground">
              {answer}
            </span>
          </button>
        ) : (
          <span
            className={cn(
              "block text-[13px] leading-snug",
              active ? "font-bold text-foreground" : "font-medium text-foreground/40",
            )}
          >
            {question}
          </span>
        )}
        {active && children ? <div className="mt-2.5">{children}</div> : null}
      </div>
    </li>
  );
}

/** Cartão de escolha (passos 1 e 5) — mesmo poço dos chips do quadrante "Acesso". */
function Choice({
  icon: Icon,
  title,
  sub,
  selected,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1 rounded-[10px] px-2.5 py-2.5 text-left transition-colors",
        selected
          ? "bg-accent/[0.12] ring-1 ring-inset ring-accent/60"
          : "bg-[var(--panel-well)] hover:bg-foreground/[0.07]",
      )}
    >
      <Icon
        className={cn("size-4", selected ? "text-accent" : "text-muted-foreground")}
        strokeWidth={2}
      />
      <span className="truncate text-[12.5px] font-bold text-foreground">{title}</span>
      <span className="text-[10.5px] leading-tight text-muted-foreground">{sub}</span>
    </button>
  );
}

/** Lista em poço, com busca opcional em UMA linha (reticências, nunca quebra). */
function PickList({
  search,
  onSearch,
  placeholder,
  empty,
  children,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  empty: string | null;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] bg-[var(--panel-well)]">
      {onSearch && (
        <label className="flex h-8 min-w-0 items-center gap-2 border-b border-[var(--panel-div)] px-2.5">
          <Search className="size-3.5 shrink-0 text-foreground/40" />
          <input
            value={search ?? ""}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={placeholder}
            className="min-w-0 flex-1 truncate bg-transparent text-[12px] text-foreground outline-none placeholder:text-foreground/40"
          />
        </label>
      )}
      <div className="sg-elegant-scroll max-h-[168px] overflow-y-auto overscroll-contain">
        {empty ? (
          <p className="px-3.5 py-3 text-[12px] text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/** Linha de decisão do aviso "Já existe uma limpeza". */
function Decision({
  icon: Icon,
  title,
  sub,
  accent,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  sub: string;
  accent?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-2.5 border-t border-[var(--panel-div)] px-3.5 py-[11px] text-left transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-[9px]",
          accent ? "bg-accent/[0.14] text-accent" : "bg-foreground/[0.06] text-foreground",
        )}
      >
        <Icon className="size-[15px]" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-foreground">{title}</span>
        <span className="block text-[11px] leading-snug text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

export function ManualCleaningButton() {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const accessFn = useServerFn(getManualCleaningAccess);
  const access = useQuery({
    queryKey: ["manual-cleaning-access", ownerId],
    queryFn: () => accessFn({ data: { ownerId } }),
    staleTime: 5 * 60_000,
  });
  if (!access.data?.canCreate) return null;
  return <ManualCleaningPanel ownerId={ownerId} />;
}

type Link = "imovel" | "reserva";

function ManualCleaningPanel({ ownerId }: { ownerId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [link, setLink] = useState<Link | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [type, setType] = useState<"normal" | "completa" | null>(null);
  const [cents, setCents] = useState<number | null>(null);
  const [centsEdited, setCentsEdited] = useState(false);
  const [search, setSearch] = useState("");
  const [conflict, setConflict] = useState<ManualCleaningConflict | null>(null);
  const [busy, setBusy] = useState(false);

  const optionsFn = useServerFn(getManualCleaningOptions);
  const createFn = useServerFn(createManualCleaning);
  const q = useQuery({
    queryKey: ["manual-cleaning-options", ownerId],
    queryFn: () => optionsFn({ data: { ownerId } }),
    enabled: open,
    staleTime: 60_000,
  });
  const today = useMemo(() => todaySP(), [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const properties = q.data?.properties ?? [];
  const providers = q.data?.providers ?? [];
  const reservations = q.data?.reservations ?? [];
  const property = properties.find((p) => p.id === propertyId) ?? null;
  const reservation = reservations.find((r) => r.id === reservationId) ?? null;
  const provider = providers.find((p) => p.id === providerId) ?? null;
  const propName = (id: string) => properties.find((p) => p.id === id)?.name ?? "Imóvel";
  const resLabel = (r: { label: string; checkin: string; checkout: string | null }) =>
    `${r.label || "Reserva"} · ${ddmm(r.checkin)} → ${ddmm(r.checkout)}`;

  const reset = () => {
    setStep(1);
    setLink(null);
    setPropertyId(null);
    setReservationId(null);
    setProviderId(null);
    setDate(undefined);
    setType(null);
    setCents(null);
    setCentsEdited(false);
    setSearch("");
    setConflict(null);
  };

  /**
   * Depois de responder a pergunta `n`, abre a PRÓXIMA SEM RESPOSTA — quem
   * reabriu uma resposta antiga só para corrigi-la não precisa repassar as
   * seguintes. `keep` diz quais das respostas 3–5 continuam valendo.
   */
  const nextStep = (n: number, keep: { provider: boolean; date: boolean; type: boolean }) => {
    const done = [true, true, keep.provider, keep.date, keep.type];
    for (let i = n; i < 5; i += 1) if (!done[i]) return i + 1;
    return 6;
  };

  /** Imóvel definido (direto ou pela reserva): zera o que dependia do anterior. */
  const pickProperty = (id: string, resId: string | null) => {
    const changed = id !== propertyId;
    setPropertyId(id);
    setReservationId(resId);
    if (changed) {
      const p = properties.find((x) => x.id === id);
      setProviderId(null);
      if (!centsEdited && type)
        setCents(type === "completa" ? (p?.fullCents ?? null) : (p?.normalCents ?? null));
    }
    setSearch("");
    setStep(nextStep(2, { provider: !changed && !!providerId, date: !!date, type: !!type }));
  };
  const pickType = (t: "normal" | "completa") => {
    setType(t);
    if (!centsEdited)
      setCents(t === "completa" ? (property?.fullCents ?? null) : (property?.normalCents ?? null));
    setStep(6);
  };
  const keepAll = { provider: !!providerId, date: !!date, type: !!type };

  const answers = [
    link === "imovel" ? "Imóvel" : link === "reserva" ? "Reserva" : undefined,
    link === "reserva" ? (reservation ? resLabel(reservation) : undefined) : property?.name,
    provider?.name,
    date ? dateLabel(date, today) : undefined,
    type === "normal" ? "Normal" : type === "completa" ? "Completa" : undefined,
    undefined,
  ];
  const answered = [
    !!link,
    link === "reserva" ? !!reservation : !!property,
    !!provider,
    !!date,
    !!type,
    false,
  ];
  const ready = answered.slice(0, 5).every(Boolean) && cents != null && step === 6;
  const question2 =
    link === "reserva" ? "Qual reserva?" : link === "imovel" ? "Qual imóvel?" : QUESTIONS[1];

  const sq = norm(search.trim());
  const shownProps = sq
    ? properties.filter((p) => norm(`${p.name} ${p.ownerName ?? ""}`).includes(sq))
    : properties;
  const shownRes = sq
    ? reservations.filter((r) => norm(`${r.label} ${propName(r.propertyId)}`).includes(sq))
    : reservations;
  // Prestador padrão do imóvel sempre em primeiro.
  const defaultProviderId = property?.defaultProviderId ?? null;
  const orderedProviders = [...providers].sort((a, b) =>
    a.id === defaultProviderId ? -1 : b.id === defaultProviderId ? 1 : 0,
  );

  async function submit(onConflict: "ask" | "add" | "replace") {
    if (!property || !provider || !date || !type || cents == null) return;
    setBusy(true);
    try {
      const res = await createFn({
        data: {
          ownerId,
          propertyId: property.id,
          reservationId: link === "reserva" ? reservationId : null,
          providerId: provider.id,
          date: isoOf(date),
          cleaningType: type,
          cents,
          onConflict,
        },
      });
      if (!res.ok) {
        setConflict(res.conflict);
        return;
      }
      const future = isoOf(date) > isoOf(today);
      const base =
        res.mode === "replaced"
          ? "Limpeza da reserva atualizada."
          : future
            ? `Limpeza criada para ${ddmm(isoOf(date))}. Ela entra na fila nesse dia.`
            : "Limpeza criada. Já está na Fila de Limpeza.";
      // O prestador é avisado por push; se ele não tem login ou não ativou as
      // notificações, quem criou precisa saber que o aviso não saiu.
      toast.success(
        res.notified
          ? `${base} ${provider.name} foi avisado(a).`
          : `${base} ${provider.name} não tem notificação ativa — avise por fora.`,
      );
      void qc.invalidateQueries({ predicate: (x) => x.queryKey[0] === "dash-list" });
      void qc.invalidateQueries({ queryKey: ["cleaning-board"] });
      void qc.invalidateQueries({ queryKey: ["cleaning-price-info"] });
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar a limpeza.");
    } finally {
      setBusy(false);
    }
  }

  const stepNumber = Math.min(step, 6);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          return;
        }
        // "Clique ao fundo retorna à página anterior": do aviso, o toque fora
        // volta para a trilha; só da trilha é que fecha.
        if (conflict) {
          setConflict(null);
          return;
        }
        setOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Nova limpeza"
          aria-label="Nova limpeza"
          className={`${ACTION_SEGMENT} text-accent`}
        >
          <Plus className={ACTION_ICON} />
          <span className="lg:hidden">Limpeza</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={FILTER_PANEL_OFFSET}
        collisionPadding={FILTER_PANEL_COLLISION}
        className={`${FILTER_PANEL_CLASS} w-[300px]`}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {conflict ? (
          <>
            <FilterScreenHeader
              icon={AlertTriangle}
              title="Já existe uma limpeza"
              onBack={() => setConflict(null)}
            />
            <div className="mx-3.5 mb-3 flex gap-2 rounded-[10px] bg-[rgba(201,169,98,.07)] px-3 py-2.5 text-[11.5px] leading-[1.45] text-foreground/85 shadow-[inset_0_0_0_1px_rgba(201,169,98,.2)]">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-[#c9a962]" />
              <span className="min-w-0 break-words">
                A reserva de <b>{reservation?.label || "hóspede"}</b> já tem{" "}
                {conflict.concluded ? "uma limpeza finalizada" : "a limpeza da saída"}:{" "}
                <b>
                  {[
                    conflict.providerName ?? "Sem prestador",
                    conflict.cleaningType === "completa"
                      ? "Completa"
                      : conflict.cleaningType === "normal"
                        ? "Normal"
                        : null,
                    conflict.priceCents != null ? brl(conflict.priceCents) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </b>
                . O que deseja fazer?
              </span>
            </div>
            <Decision
              icon={PlusCircle}
              accent
              disabled={busy}
              title="Somar as duas"
              sub="Cria uma limpeza extra. As duas contam nos totais."
              onClick={() => void submit("add")}
            />
            <Decision
              icon={Replace}
              disabled={busy}
              title="Substituir a existente"
              sub={`Troca para ${provider?.name ?? "o prestador"} · ${type === "completa" ? "Completa" : "Normal"} · ${brl(cents)}.`}
              onClick={() => void submit("replace")}
            />
            <Decision
              icon={X}
              disabled={busy}
              title="Cancelar"
              sub="Não cria nada e volta à tela anterior."
              onClick={() => setConflict(null)}
            />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--panel-div)] px-3.5 py-3">
              <span className="ds-eyebrow text-muted-foreground">Nova limpeza</span>
              <span className="text-[11px] font-semibold tabular-nums text-foreground/55">
                {stepNumber} de 6
              </span>
            </div>
            <ol className="flex flex-col px-3.5 pb-0 pt-3.5">
              <Step
                n={1}
                active={step === 1}
                done={answered[0]}
                question={QUESTIONS[0]}
                answer={answers[0]}
                onReopen={() => setStep(1)}
              >
                <div role="radiogroup" className="flex gap-1.5">
                  <Choice
                    icon={Home}
                    title="Imóvel"
                    sub="Limpeza avulsa, sem hóspede"
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
                    sub="Ligada a uma estadia"
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
              <Step
                n={2}
                active={step === 2}
                done={answered[1]}
                question={question2}
                answer={answers[1]}
                onReopen={() => answered[0] && setStep(2)}
              >
                {link === "reserva" ? (
                  <PickList
                    search={search}
                    onSearch={setSearch}
                    placeholder="Buscar hóspede ou código…"
                    empty={
                      q.isLoading
                        ? "Carregando…"
                        : q.isError
                          ? "Não foi possível carregar as reservas."
                          : shownRes.length === 0
                            ? "Nenhuma reserva encontrada."
                            : null
                    }
                  >
                    {shownRes.map((r, i) => (
                      <FilterOptionRow
                        key={r.id}
                        label={`${resLabel(r)} · ${propName(r.propertyId)}`}
                        selected={r.id === reservationId}
                        onClick={() => pickProperty(r.propertyId, r.id)}
                        last={i === shownRes.length - 1}
                      />
                    ))}
                  </PickList>
                ) : (
                  <PickList
                    search={search}
                    onSearch={setSearch}
                    placeholder="Buscar imóvel ou proprietário…"
                    empty={
                      q.isLoading
                        ? "Carregando…"
                        : q.isError
                          ? "Não foi possível carregar os imóveis."
                          : shownProps.length === 0
                            ? "Nenhum imóvel encontrado."
                            : null
                    }
                  >
                    {shownProps.map((p, i) => (
                      <FilterOptionRow
                        key={p.id}
                        label={p.name}
                        selected={p.id === propertyId}
                        onClick={() => pickProperty(p.id, null)}
                        last={i === shownProps.length - 1}
                      />
                    ))}
                  </PickList>
                )}
              </Step>
              <Step
                n={3}
                active={step === 3}
                done={answered[2]}
                question={QUESTIONS[2]}
                answer={answers[2]}
                onReopen={() => answered[1] && setStep(3)}
              >
                <PickList
                  empty={orderedProviders.length === 0 ? "Nenhum prestador cadastrado." : null}
                >
                  {orderedProviders.map((p, i) => (
                    <FilterOptionRow
                      key={p.id}
                      label={
                        p.id === property?.defaultProviderId
                          ? `${p.name} · padrão deste imóvel`
                          : p.name
                      }
                      selected={p.id === providerId}
                      onClick={() => {
                        setProviderId(p.id);
                        setStep(nextStep(3, { ...keepAll, provider: true }));
                      }}
                      last={i === orderedProviders.length - 1}
                    />
                  ))}
                </PickList>
              </Step>
              <Step
                n={4}
                active={step === 4}
                done={answered[3]}
                question={QUESTIONS[3]}
                answer={answers[3]}
                onReopen={() => answered[2] && setStep(4)}
              >
                <div className="-mx-1">
                  <FilterDateCalendar
                    value={date}
                    onChange={(d) => {
                      setDate(d);
                      setStep(nextStep(4, { ...keepAll, date: true }));
                    }}
                    today={today}
                    min={today}
                    quickNoWrap
                  />
                </div>
              </Step>
              <Step
                n={5}
                active={step === 5}
                done={answered[4]}
                question={QUESTIONS[4]}
                answer={answers[4]}
                onReopen={() => answered[3] && setStep(5)}
              >
                <div role="radiogroup" className="flex gap-1.5">
                  <Choice
                    icon={Layers}
                    title="Normal"
                    sub={brl(property?.normalCents)}
                    selected={type === "normal"}
                    onClick={() => pickType("normal")}
                  />
                  <Choice
                    icon={Layers}
                    title="Completa"
                    sub={brl(property?.fullCents)}
                    selected={type === "completa"}
                    onClick={() => pickType("completa")}
                  />
                </div>
              </Step>
              <Step
                n={6}
                active={step === 6}
                done={false}
                last
                question={QUESTIONS[5]}
                onReopen={() => {}}
              >
                <MoneyInput
                  cents={cents}
                  onChange={(c) => {
                    setCents(c);
                    setCentsEdited(true);
                  }}
                  placeholder="0,00"
                  disabled={busy}
                />
                <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
                  Preenchido com o valor da limpeza {type === "completa" ? "completa" : "normal"}{" "}
                  deste imóvel. Altere se precisar.
                </span>
              </Step>
            </ol>
            <div className="border-t border-[var(--panel-div)] px-3.5 py-3">
              <button
                type="button"
                disabled={!ready || busy}
                onClick={() => void submit("ask")}
                className="ds-surface inline-flex h-8 w-full items-center justify-center gap-1.5 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2 text-[12px] font-bold text-white disabled:opacity-40"
              >
                <Plus className="size-3 shrink-0" />
                <span className="truncate">{busy ? "Criando…" : "Criar limpeza"}</span>
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
