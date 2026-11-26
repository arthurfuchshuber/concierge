import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Funnel, Headphones, LoaderCircle, MessageCircle } from "lucide-react";
import { listHandoffConversations, getAtendimentoAccess } from "@/lib/handoff.functions";
import { countHandoffQueues, listAtendimentoProperties, listRegionalSituations } from "@/lib/atendimento.functions";
import { ConversationList, ConversationView, useMyUserId } from "@/components/handoff/ConversationView";
import { buildStayView } from "@/components/handoff/stay-view";
import { useConversationStay } from "@/components/handoff/useConversationStay";
import { selectConversationStay } from "@/lib/handoff-stay";
import { DEFAULT_QUEUE, QUEUES, QUEUE_EMPTY, type Queue } from "@/lib/handoff-queues";
import { useImpersonation } from "@/hooks/useImpersonation";
import { useIsMobile } from "@/hooks/use-mobile";
import { PageShell } from "@/components/ds/PageShell";
import { Stepper } from "@/components/editor/Stepper";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { PropertyFilterWindow } from "@/components/handoff/PropertyFilterWindow";
import { RegionalBanner } from "@/components/handoff/RegionalWindow";

const searchSchema = z.object({
  conv: z.string().uuid().optional(),
});

export const Route = createFileRoute("/_authenticated/admin/atendimento")({
  head: () => ({
    meta: [
      { title: "Atendimento aos hóspedes | ConciergeIA" },
      { name: "description", content: "Central de atendimento ConciergeIA: conversas, reservas e acompanhamento dos hóspedes." },
      { property: "og:title", content: "Atendimento aos hóspedes | ConciergeIA" },
      { property: "og:description", content: "Conversas e acompanhamento das reservas na central de atendimento ConciergeIA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (s) => searchSchema.parse(s),
  component: AtendimentoPage,
});

const SUBTITLE = "Hóspedes que precisam de ajuda humana.";
const SEARCH_PH = "Buscar hóspede, imóvel, reserva, telefone…";

/**
 * PÁGINA ATENDIMENTO (mockups ATD-D01…D18 / M01…M21, aprovados em 23–26/11/2026).
 * Desktop: cabeçalho de página, abas Meus · Precisa Humano · Com a IA · Resolvidas (com contagem), busca com o
 * filtro de imóveis, e abaixo a lista de cards SEM fundo próprio (420px) ao lado da conversa num painel elevado
 * (opção A). Celular: a mesma página com abas curtas, os cards em lista e a conversa em tela cheia.
 * Situação regional ativa: faixa acima da lista. "Meus" é a aba padrão ao abrir.
 */
function AtendimentoPage() {
  const { conv } = useSearch({ from: "/_authenticated/admin/atendimento" });
  const accessFn = useServerFn(getAtendimentoAccess);
  const listFn = useServerFn(listHandoffConversations);
  const countsFn = useServerFn(countHandoffQueues);
  const regionalFn = useServerFn(listRegionalSituations);
  const propsFn = useServerFn(listAtendimentoProperties);
  const myUserId = useMyUserId();
  const isMobile = useIsMobile();

  const access = useQuery({
    queryKey: ["handoff-access"],
    // Falha transitória = "ainda carregando": mantém a última decisão, nunca nega.
    queryFn: () => accessFn(),
    staleTime: 5 * 60_000,
    retry: 2,
    retryDelay: (n) => 1000 * (n + 1),
  });

  const { impersonation } = useImpersonation();
  const activeAccountId = impersonation?.userId ?? null;
  const [queue, setQueue] = useState<Queue>(DEFAULT_QUEUE);
  const [activeId, setActiveId] = useState<string | null>(conv ?? null);
  const stayFresh = useConversationStay(activeId);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [propFilter, setPropFilter] = useState<string[]>([]);

  useEffect(() => {
    if (conv) setActiveId(conv);
  }, [conv]);

  const allowed = access.data?.allowed === true;
  const list = useQuery({
    queryKey: ["handoff-list", queue, activeAccountId ?? "self"],
    queryFn: async () => {
      try {
        return await listFn({ data: { queue, limit: 100, accountOwnerId: activeAccountId } });
      } catch {
        return { conversations: [], details: {} };
      }
    },
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });
  const counts = useQuery({
    queryKey: ["handoff-queue-counts", activeAccountId ?? "self"],
    queryFn: () => countsFn({ data: { accountOwnerId: activeAccountId } }),
    enabled: allowed,
    refetchInterval: 15_000,
    retry: false,
  });
  const regional = useQuery({
    queryKey: ["regional-situations", activeAccountId ?? "self"],
    queryFn: () => regionalFn({ data: { accountOwnerId: activeAccountId } }),
    enabled: allowed,
    refetchInterval: 30_000,
    retry: false,
  });
  const properties = useQuery({
    queryKey: ["atendimento-properties", activeAccountId ?? "self"],
    queryFn: () => propsFn({ data: { accountOwnerId: activeAccountId } }),
    enabled: allowed && filterOpen,
    staleTime: 60_000,
  });

  const conversations = list.data?.conversations ?? [];
  const details = list.data?.details ?? {};
  const filteredConversations = useMemo(() => {
    const term = search.trim().toLowerCase();
    const digits = term.replace(/\D+/g, "");
    return conversations.filter((c) => {
      const prop = Array.isArray(c.properties) ? c.properties[0] : c.properties;
      if (propFilter.length && !propFilter.includes(String((prop as { id?: string } | null)?.id ?? c.property_id ?? ""))) return false;
      if (!term) return true;
      const d = details[c.id];
      const checkin = d?.checkinDate ?? null;
      const hay = [
        d?.name ?? c.guest_name ?? "",
        prop?.name ?? "",
        d?.reservationCode ?? "",
        c.handoff_reason ?? "",
        checkin ?? "",
        checkin ? new Date(checkin).toLocaleDateString("pt-BR") : "",
      ]
        .join(" ")
        .toLowerCase();
      if (hay.includes(term)) return true;
      return !!(digits && d?.phone && d.phone.replace(/\D+/g, "").includes(digits));
    });
  }, [conversations, details, search, propFilter]);

  if (access.isLoading) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  if (!allowed) {
    return (
      <div className="ds-page w-full max-w-none px-3.5 py-5 sm:px-5 lg:px-8 lg:pl-4 lg:py-8">
        <PageShell title="Atendimento" subtitle={SUBTITLE} />
        <div className="ds-3d rounded-[14px] bg-card p-6">
          <div className="mb-2 inline-flex items-center gap-2">
            <Headphones className="size-4 text-accent" />
            <span className="font-display text-[15px] font-bold">Central de Atendimento</span>
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            A Central de Atendimento humano com encaminhamento da IA faz parte da assinatura ConciergeIA, com todos os recursos incluídos.
          </p>
          <a href="/admin/assinatura" className="inline-flex h-9 items-center rounded-[10px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] px-4 text-[12.5px] font-bold text-white">
            Ativar Assinatura
          </a>
        </div>
      </div>
    );
  }

  // A consulta própria prevalece quando encontra a reserva; sem match, preserva o cruzamento mais amplo da lista.
  const stayRes = selectConversationStay(stayFresh?.res, list.data?.reservations?.[activeId ?? ""]);
  const activeStay =
    activeId && stayRes
      ? buildStayView({ detail: details[activeId] ?? null, res: stayRes, viewers: list.data?.guideViewers?.[activeId] ?? 0 })
      : null;
  const activeOwner = activeId ? (list.data?.owners?.[activeId] ?? null) : null;

  const c = counts.data;
  const countOf: Record<Queue, number | undefined> = {
    assigned_to_me: c?.mine,
    all_active: c?.human,
    needs_human: c?.human,
    ai_only: c?.ai,
    resolved: c?.resolved,
    all: undefined,
  };
  const steps = QUEUES.map((qq) => ({ value: qq.key, label: isMobile ? qq.short : qq.label, icon: qq.icon, count: countOf[qq.key] ?? 0 }));
  const empty =
    search.trim() || propFilter.length
      ? { title: "Nenhuma conversa encontrada.", sub: "Tente outro nome, imóvel, reserva ou telefone." }
      : QUEUE_EMPTY[queue];
  const banners = (regional.data ?? []).map((s) => <RegionalBanner key={s.id} situation={s} />);

  const filterBtn = (
    <button
      type="button"
      aria-label="Filtrar por imóvel"
      onClick={() => setFilterOpen(true)}
      className="relative flex w-12 flex-none items-center justify-center gap-2 px-0 text-[12px] font-bold leading-none text-muted-foreground lg:w-[52px]"
    >
      <Funnel className="size-[15px] shrink-0" />
      {propFilter.length ? (
        <span className="absolute right-2 top-2 grid h-4 min-w-4 place-items-center rounded-full bg-[#c9a962]/30 px-1 text-[9.5px] font-extrabold text-[#6b5214]">
          {propFilter.length}
        </span>
      ) : null}
    </button>
  );

  const head = (
    <>
      <PageShell title="Atendimento" subtitle={SUBTITLE} />
      <Stepper steps={steps} current={queue} onChange={(v) => setQueue(v as Queue)} withIcons={!isMobile} compact={isMobile} />
      <SearchActionRow value={search} onChange={setSearch} placeholder={SEARCH_PH} actions={filterBtn} />
    </>
  );

  const listEl = (
    <ConversationList
      conversations={filteredConversations as never}
      details={details}
      assignedNames={list.data?.assignedNames ?? {}}
      reservations={list.data?.reservations ?? {}}
      guideViewers={list.data?.guideViewers ?? {}}
      owners={list.data?.owners ?? {}}
      activeId={activeId}
      onSelect={setActiveId}
      layout={isMobile ? "mobile" : "desktop"}
      resolved={queue === "resolved"}
      empty={empty}
    />
  );

  const filterWindow = (
    <PropertyFilterWindow
      open={filterOpen}
      onOpenChange={setFilterOpen}
      loading={properties.isLoading}
      options={properties.data ?? []}
      value={propFilter}
      onApply={(v) => {
        setPropFilter(v);
        setFilterOpen(false);
      }}
    />
  );

  if (isMobile) {
    return (
      <div className="ds-page w-full max-w-none px-3.5 py-5">
        {head}
        {banners}
        <div className="ds-card-grid grid-cols-[minmax(0,1fr)]">{list.isLoading ? <ListLoading /> : listEl}</div>
        {activeId ? (
          <div className="fixed inset-0 z-30 flex flex-col bg-background">
            <ConversationView
              conversationId={activeId}
              myUserId={myUserId}
              stay={activeStay}
              owner={activeOwner}
              layout="mobile"
              onBack={() => setActiveId(null)}
            />
          </div>
        ) : null}
        {filterWindow}
      </div>
    );
  }

  return (
    <div className="ds-page h-screen w-full max-w-none px-8 pl-4 py-8">
      {head}
      <div className="flex min-h-0 flex-1 gap-6">
        <div className="sg-elegant-scroll -m-4 flex w-[420px] shrink-0 flex-col gap-[var(--ds-grid-gap)] overflow-y-auto overflow-x-hidden p-4">
          {banners}
          {list.isLoading ? <ListLoading /> : listEl}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-[22px] bg-card shadow-[0_30px_70px_-30px_rgba(40,20,60,0.35),0_2px_10px_rgba(40,20,60,0.06)]">
          {activeId ? (
            <ConversationView conversationId={activeId} myUserId={myUserId} stay={activeStay} owner={activeOwner} layout="desktop" />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <span className="mx-auto mb-2 grid size-9 place-items-center rounded-[10px] bg-foreground/[0.06] text-muted-foreground">
                  <MessageCircle className="size-4" />
                </span>
                <p className="text-[13px] font-semibold">Selecione uma conversa</p>
                <p className="mt-1 text-[12px] text-muted-foreground">Ela abre aqui, ao lado da lista.</p>
              </div>
            </div>
          )}
        </div>
      </div>
      {filterWindow}
    </div>
  );
}

function ListLoading() {
  return (
    <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
      <LoaderCircle className="size-3.5 animate-spin" /> Carregando…
    </div>
  );
}
