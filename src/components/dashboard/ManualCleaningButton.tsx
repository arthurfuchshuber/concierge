import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CalendarCheck,
  Home,
  Layers,
  Plus,
  PlusCircle,
  Replace,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { MoneyInput } from "@/components/ui/money-input";
import { FilterDateCalendar, FilterScreenHeader } from "@/components/dashboard/filter-panel";
import { ACTION_ICON, ACTION_SEGMENT } from "@/components/dashboard/panel-chrome";
import {
  createManualCleaning,
  getManualCleaningAccess,
  getManualCleaningOptions,
  type ManualCleaningConflict,
} from "@/lib/manual-cleaning.functions";
import { createServiceRecord } from "@/lib/service-situations.functions";
import { ServiceDetailsFields } from "@/components/dashboard/ServiceDetailsFields";
import { enfileirarSituacao } from "@/lib/offline/situation-outbox";
import { draftItemFrom, type DraftItem } from "@/components/dashboard/record-draft";
import {
  apagarRascunhoServico,
  gravarRascunhoServico,
  lerRascunhoServico,
} from "@/lib/offline/service-draft";
import { useImpersonation } from "@/hooks/useImpersonation";
import { cn } from "@/lib/utils";
import {
  Choice,
  PickList,
  PropertyPickRow,
  PropertySummary,
  guestShort,
  ProviderPickRow,
  Step,
  TrailDialog,
  ddmm,
  norm,
} from "@/components/dashboard/TrailParts";

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
 *
 * ABA SERVIÇOS (23/10/2026): quem abre esta trilha, ali, é a janela "Sobre o
 * que é a situação?" — escolher "Limpeza" cai no passo 1 daqui. Por isso o
 * painel também aceita ser CONTROLADO de fora (`ManualCleaningHost`), sem o
 * gatilho "+" próprio.
 */

const QUESTIONS = [
  "Vincular a um imóvel ou a uma reserva?",
  "Qual imóvel ou reserva?",
  "Para qual prestador?",
  "Para qual data?",
  "Qual tipo de limpeza?",
  "Confirme o valor desta limpeza!",
] as const;

/**
 * Situação de SERVIÇO que usa esta mesma trilha (Manutenção, Danos, Outro e as
 * criadas pelo usuário). Sem situação (ou "cleaning") a trilha é a Nova
 * limpeza de sempre, com 6 perguntas; com situação são 5 — sai o "tipo de
 * limpeza" — e o fim cria o serviço em vez da limpeza.
 */
export type TrailSituation = { id: string; name: string };

function brl(c: number | null | undefined) {
  if (c == null) return "Sem preço cadastrado";
  return (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

function useManualCleaningAccess(ownerId: string | null) {
  const accessFn = useServerFn(getManualCleaningAccess);
  return useQuery({
    queryKey: ["manual-cleaning-access", ownerId],
    queryFn: () => accessFn({ data: { ownerId } }),
    staleTime: 5 * 60_000,
  });
}

export function ManualCleaningButton() {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const access = useManualCleaningAccess(ownerId);
  if (!access.data?.canCreate) return null;
  return <ManualCleaningPanel ownerId={ownerId} />;
}

/**
 * A mesma trilha, sem o "+" próprio, aberta de fora (aba Serviços). Se a
 * pessoa não pode criar limpeza, não desenha nada.
 */
export function ManualCleaningHost({
  open,
  onOpenChange,
  situation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  situation?: TrailSituation | null;
}) {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  const access = useManualCleaningAccess(ownerId);
  if (!access.data?.canCreate) return null;
  return (
    <ManualCleaningPanel
      ownerId={ownerId}
      situation={situation ?? null}
      controlled={{ open, onOpenChange }}
    />
  );
}

/** Diz se a pessoa pode criar limpeza (usado pela janela "Sobre o que é a situação?"). */
export function useCanCreateCleaning(): boolean {
  const ownerId = useImpersonation().impersonation?.userId ?? null;
  return !!useManualCleaningAccess(ownerId).data?.canCreate;
}

type Link = "imovel" | "reserva";

function ManualCleaningPanel({
  ownerId,
  situation = null,
  controlled,
}: {
  ownerId: string | null;
  situation?: TrailSituation | null;
  controlled?: { open: boolean; onOpenChange: (open: boolean) => void };
}) {
  const isClean = !situation || situation.id === "cleaning";
  /** Quantas perguntas tem a trilha (e qual é a do valor). */
  const TOTAL = isClean ? 6 : 5;
  const qc = useQueryClient();
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlled ? controlled.open : innerOpen;
  const setOpen = controlled ? controlled.onOpenChange : setInnerOpen;
  const [step, setStep] = useState(1);
  const [link, setLink] = useState<Link | null>(null);
  const [propertyId, setPropertyId] = useState<string | null>(null);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [type, setType] = useState<"normal" | "completa" | null>(null);
  const [cents, setCents] = useState<number | null>(isClean ? null : 0);
  const [centsEdited, setCentsEdited] = useState(false);
  const [note, setNote] = useState("");
  /** Serviço: título (até 50) e mídias da última pergunta (mockup 0l). */
  const [svcTitle, setSvcTitle] = useState("");
  const [svcItems, setSvcItems] = useState<DraftItem[]>([]);
  const [search, setSearch] = useState("");
  const [conflict, setConflict] = useState<ManualCleaningConflict | null>(null);
  const [busy, setBusy] = useState(false);

  const optionsFn = useServerFn(getManualCleaningOptions);
  const createFn = useServerFn(createManualCleaning);
  const createServiceFn = useServerFn(createServiceRecord);
  const q = useQuery({
    queryKey: ["manual-cleaning-options", ownerId, isClean ? "clean" : "service"],
    queryFn: () => optionsFn({ data: { ownerId, forService: !isClean } }),
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
  const resLabel = (r: { guestLine: string; checkin: string; checkout: string | null }) =>
    `${r.guestLine} · ${ddmm(r.checkin)} → ${ddmm(r.checkout)}`;

  const reset = () => {
    setStep(1);
    setLink(null);
    setPropertyId(null);
    setReservationId(null);
    setProviderId(null);
    setDate(undefined);
    setType(null);
    setCents(isClean ? null : 0);
    setNote("");
    setSvcTitle("");
    setSvcItems([]);
    setCentsEdited(false);
    setSearch("");
    setConflict(null);
  };

  /**
   * RASCUNHO DO SERVIÇO (23/10/2026): só no "Novo serviço". Ao abrir, devolve o que a
   * pessoa já tinha respondido (inclusive fotos/vídeos); a cada resposta, guarda no
   * aparelho (IndexedDB). Some ao criar o serviço e em 48 horas.
   */
  const draftReady = useRef(false);
  const situationKey = isClean ? null : (situation?.id ?? null);
  useEffect(() => {
    if (!open || !situationKey) return;
    let cancelled = false;
    draftReady.current = false;
    void lerRascunhoServico(situationKey).then((r) => {
      if (cancelled) return;
      if (r) {
        setStep(Math.min(Math.max(1, r.step), TOTAL));
        setLink(r.link);
        setPropertyId(r.propertyId);
        setReservationId(r.reservationId);
        setProviderId(r.providerId);
        setDate(r.date ? new Date(`${r.date}T12:00:00`) : undefined);
        setCents(r.cents);
        setCentsEdited(r.centsEdited);
        setSvcTitle(r.title);
        setNote(r.note);
        setSvcItems(r.midias.map((m) => draftItemFrom(m.blob, { name: m.name, mime: m.mime, durationMs: m.durationMs })));
      }
      draftReady.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [open, situationKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !situationKey || !draftReady.current) return;
    const t = window.setTimeout(() => {
      void gravarRascunhoServico({
        criadoEm: Date.now(),
        situationId: situationKey,
        step,
        link,
        propertyId,
        reservationId,
        providerId,
        date: date ? isoOf(date) : null,
        cents,
        centsEdited,
        title: svcTitle,
        note,
        midias: svcItems.map((it) => ({
          key: it.key,
          blob: it.blob,
          kind: it.kind,
          mime: it.mime,
          name: it.name,
          durationMs: it.durationMs,
        })),
      });
    }, 500);
    return () => window.clearTimeout(t);
  }, [open, situationKey, step, link, propertyId, reservationId, providerId, date, cents, centsEdited, svcTitle, note, svcItems]);

  /**
   * Depois de responder a pergunta `n`, abre a PRÓXIMA SEM RESPOSTA — quem
   * reabriu uma resposta antiga só para corrigi-la não precisa repassar as
   * seguintes. `keep` diz quais das respostas 3–5 continuam valendo.
   */
  const nextStep = (n: number, keep: { provider: boolean; date: boolean; type: boolean }) => {
    const done = isClean
      ? [true, true, keep.provider, keep.date, keep.type]
      : [true, true, keep.provider, keep.date];
    for (let i = n; i < TOTAL - 1; i += 1) if (!done[i]) return i + 1;
    return TOTAL;
  };

  /** Imóvel definido (direto ou pela reserva): zera o que dependia do anterior. */
  const pickProperty = (id: string, resId: string | null) => {
    const changed = id !== propertyId;
    setPropertyId(id);
    setReservationId(resId);
    if (changed) {
      const p = properties.find((x) => x.id === id);
      // Mockup 3: o prestador do imóvel já vem marcado (✓ "Nome · Atividade"),
      // mas a pergunta continua aberta para confirmar ou trocar.
      setProviderId(p?.defaultProviderId ?? null);
      if (isClean && !centsEdited && type)
        setCents(type === "completa" ? (p?.fullCents ?? null) : (p?.normalCents ?? null));
      setSearch("");
      setStep(3);
      return;
    }
    setSearch("");
    setStep(nextStep(2, { provider: !!providerId, date: !!date, type: !!type }));
  };
  const pickType = (t: "normal" | "completa") => {
    setType(t);
    if (!centsEdited)
      setCents(t === "completa" ? (property?.fullCents ?? null) : (property?.normalCents ?? null));
    setStep(TOTAL);
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
    isClean ? !!type : false,
    false,
  ];
  /** Resposta estruturada do passo 2 (mockup 0m): uma informação por linha. */
  const step2Summary =
    link === "reserva" && reservation && property ? (
      <PropertySummary
        name={property.name}
        guest={guestShort(reservation.guestLine)}
        period={`${ddmm(reservation.checkin)} → ${ddmm(reservation.checkout)}`}
        ownerName={property.ownerName}
        ownerPhone={property.ownerPhone}
        ownerPhoneCountry={property.ownerPhoneCountry}
      />
    ) : link === "imovel" && property ? (
      <PropertySummary
        showMaps
        name={property.name}
        ownerName={property.ownerName}
        ownerPhone={property.ownerPhone}
        ownerPhoneCountry={property.ownerPhoneCountry}
        address={property.address}
        mapsUrl={property.mapsUrl}
        garageMapsUrl={property.garageMapsUrl}
      />
    ) : undefined;
  const ready =
    answered.slice(0, TOTAL - 1).every(Boolean) &&
    cents != null &&
    step === TOTAL &&
    (isClean || svcTitle.trim().length > 0);
  const question2 =
    link === "reserva" ? "Qual reserva?" : link === "imovel" ? "Qual imóvel?" : QUESTIONS[1];

  const sq = norm(search.trim());
  const shownProps = sq
    ? properties.filter((p) => norm(`${p.name} ${p.ownerName ?? ""}`).includes(sq))
    : properties;
  // Ordem fixa (pedido de 23/10/2026): check-out do MAIS RECENTE para o MAIS ANTIGO — com ou sem busca.
  const resSorted = [...reservations].sort((x, y) =>
    String(y.checkout ?? y.checkin).localeCompare(String(x.checkout ?? x.checkin)),
  );
  const shownRes = sq
    ? resSorted.filter((r) =>
        norm(`${r.label} ${r.guestLine} ${propName(r.propertyId)}`).includes(sq),
      )
    : resSorted;
  // Prestador do imóvel sempre em primeiro.
  const defaultProviderId = property?.defaultProviderId ?? null;
  const orderedProviders = [...providers].sort((a, b) =>
    a.id === defaultProviderId ? -1 : b.id === defaultProviderId ? 1 : 0,
  );

  /** Fim da trilha de SERVIÇO: cria o serviço (alimenta Serviços Extras). */
  async function submitService() {
    if (!situation || !property || !provider || !date || cents == null) return;
    setBusy(true);
    try {
      const groupId = crypto.randomUUID();
      // Teto de espera: a tela nunca fica presa em "Criando…".
      const TIMEOUT = Symbol("timeout");
      const res = await Promise.race([
        createServiceFn({
          data: {
            ownerId,
            situation: situation.id,
            propertyId: property.id,
            reservationId: link === "reserva" ? reservationId : null,
            providerId: provider.id,
            date: isoOf(date),
            cents,
            title: svcTitle.trim(),
            description: note.trim() || null,
            groupId,
          },
        }),
        new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), 30000)),
      ]);
      if (res === TIMEOUT) {
        for (const k of ["dash-service-extras", "dash-tasks"]) {
          void qc.invalidateQueries({ predicate: (x) => x.queryKey[0] === k });
        }
        toast.error(
          "A resposta demorou demais. Confira em Serviços Extras se o serviço já aparece antes de criar de novo.",
        );
        return;
      }
      // Fecha a janela já: o serviço está gravado. As mídias seguem pela fila
      // do aparelho em segundo plano, sem segurar a tela.
      const items = svcItems;
      const sit = situation;
      const prop = property;
      const resvId = link === "reserva" ? (reservationId ?? undefined) : undefined;
      const title = svcTitle.trim();
      const desc = note.trim() || null;
      toast.success(`Serviço “${sit.name}” criado. Entra em Serviços Extras de ${ddmm(isoOf(date))}.`);
      for (const k of ["dash-service-extras", "dash-tasks", "dash-list", "account-records"]) {
        void qc.invalidateQueries({ predicate: (x) => x.queryKey[0] === k });
      }
      draftReady.current = false;
      void apagarRascunhoServico(sit.id);
      setOpen(false);
      reset();
      if (items.length > 0) {
        if (!res.groupId) {
          toast.error("O serviço foi criado, mas as mídias não puderam ser anexadas. Anexe de novo em Registros.");
        } else {
          void Promise.race([
            enfileirarSituacao({
              groupId: res.groupId,
              criadoEm: Date.now(),
              propertyId: prop.id,
              reservationId: resvId,
              cardMode: null,
              category: sit.id === "maintenance" ? "maintenance" : sit.id === "damage" ? "damage" : "other",
              title,
              description: desc,
              situationId: sit.id,
              criada: true,
              taskId: res.id,
              taskCreated: true,
              midias: items.map((it) => ({
                key: it.key,
                blob: it.blob,
                kind: it.kind,
                mime: it.mime,
                name: it.name,
                durationMs: it.durationMs,
              })),
            }),
            new Promise<boolean>((r) => setTimeout(() => r(false), 15000)),
          ])
            .then((ok) => {
              if (ok) toast.message("Enviando as mídias em segundo plano", { position: "top-center" });
              else toast.error("O serviço foi criado, mas não consegui guardar as mídias no aparelho. Anexe de novo em Registros.");
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível criar o serviço.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(onConflict: "ask" | "add" | "replace") {
    if (!isClean) return submitService();
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
          note: note.trim() || null,
          onConflict,
        },
      });
      if (!res.ok) {
        setConflict(res.conflict);
        return;
      }
      const future = isoOf(date) > isoOf(today);
      const past = isoOf(date) < isoOf(today);
      const base =
        res.mode === "replaced"
          ? "Limpeza da reserva atualizada."
          : past
            ? `Limpeza criada em ${ddmm(isoOf(date))}.`
            : future
              ? `Limpeza criada para ${ddmm(isoOf(date))}. Ela entra na fila nesse dia.`
              : "Limpeza criada. Já está na Fila de Limpeza.";
      // O prestador é avisado por push; se ele não tem login ou não ativou as
      // notificações, quem criou precisa saber que o aviso não saiu.
      toast.success(
        past
          ? base
          : res.notified
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

  const stepNumber = Math.min(step, TOTAL);

  return (
    <>
      {!controlled && (
        <button
          type="button"
          title="Nova limpeza"
          aria-label="Nova limpeza"
          onClick={() => setOpen(true)}
          className={`${ACTION_SEGMENT} text-accent`}
        >
          <Plus className={ACTION_ICON} />
          <span className="lg:hidden">Limpeza</span>
        </button>
      )}
    <TrailDialog
      open={open}
      title={conflict ? "Já existe uma limpeza" : isClean ? "Nova limpeza" : "Novo serviço"}
      subtitle={conflict || isClean ? null : situation?.name}
      progress={conflict ? "" : `${stepNumber} de ${TOTAL}`}
      onBack={conflict ? () => setConflict(null) : step > 1 && !busy ? () => setStep(step - 1) : undefined}
      footer={conflict ? null : (
              <button
                type="button"
                disabled={!ready || busy}
                onClick={() => void submit("ask")}
                className="ds-surface inline-flex h-10 w-full items-center justify-center gap-1.5 bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-2 text-[13px] font-bold text-white disabled:opacity-40"
              >
                <Plus className="size-3.5 shrink-0" />
                <span className="truncate">
                  {busy ? "Criando…" : isClean ? "Criar limpeza" : "Criar serviço"}
                </span>
              </button>
      )}
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
            <ol className="flex flex-col">
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
                bleed
                active={step === 2}
                done={answered[1]}
                question={question2}
                answer={answers[1]}
                answerNode={step2Summary}
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
                    {shownRes.map((r, i) => {
                      const p = properties.find((x) => x.id === r.propertyId);
                      return (
                        <PropertyPickRow
                          key={r.id}
                          name={propName(r.propertyId)}
                          photoUrl={p?.photoUrl}
                          ownerName={p?.ownerName}
                          ownerPhone={p?.ownerPhone}
                          ownerPhoneCountry={p?.ownerPhoneCountry}
                          hideMaps
                          lines={[
                            {
                              icon: "user",
                              text: guestShort(r.guestLine),
                              suffix: `${ddmm(r.checkin)} → ${ddmm(r.checkout)}`,
                            },
                          ]}
                          selected={r.id === reservationId}
                          onClick={() => pickProperty(r.propertyId, r.id)}
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
                      <PropertyPickRow
                        key={p.id}
                        name={p.name}
                        photoUrl={p.photoUrl}
                        ownerName={p.ownerName}
                        ownerPhone={p.ownerPhone}
                        ownerPhoneCountry={p.ownerPhoneCountry}
                        city={p.city}
                        address={p.address}
                        mapsUrl={p.mapsUrl}
                        garageMapsUrl={p.garageMapsUrl}
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
                    <ProviderPickRow
                      key={p.id}
                      name={p.name}
                      activity={p.activity}
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
                    quickNoWrap
                  />
                </div>
              </Step>
              {isClean && (
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
              )}
              <Step
                n={TOTAL}
                active={step === TOTAL}
                done={false}
                last
                question={isClean ? QUESTIONS[5] : "Informe os detalhes do serviço:"}
                onReopen={() => {}}
              >
                {isClean ? (
                  <>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-[14px] font-bold text-muted-foreground">
                    R$
                  </span>
                  <MoneyInput
                    cents={cents}
                    onChange={(c) => {
                      setCents(c);
                      setCentsEdited(true);
                    }}
                    placeholder="0,00"
                    disabled={busy}
                    className="h-11 pl-10 font-display text-[16px] font-bold tabular-nums"
                  />
                </div>
                <span className="mt-1.5 block text-[11px] leading-snug text-muted-foreground">
                  {isClean
                    ? `Preenchido com o valor da limpeza ${type === "completa" ? "completa" : "normal"} deste imóvel. Altere se precisar.`
                    : "Quanto custou este serviço. Pode ficar em R$ 0,00."}
                </span>
                <label className="mt-4 block">
                  <span className="mb-1.5 block font-display text-[13px] font-semibold text-foreground">
                    Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
                  </span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 1000))}
                    disabled={busy}
                    rows={3}
                    placeholder={
                      isClean
                        ? "Ex.: limpeza após manutenção, trocar roupa de cama…"
                        : "Ex.: troca do chuveiro, retirada do entulho…"
                    }
                    className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-[14px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                  </>
                ) : (
                  <ServiceDetailsFields
                    propertyId={property?.id ?? ""}
                    title={svcTitle}
                    onTitle={setSvcTitle}
                    cents={cents}
                    onCents={(c) => {
                      setCents(c);
                      setCentsEdited(true);
                    }}
                    description={note}
                    onDescription={setNote}
                    items={svcItems}
                    onItems={setSvcItems}
                    disabled={busy}
                  />
                )}
              </Step>
            </ol>
          </>
        )}
    </TrailDialog>
    </>
  );
}
