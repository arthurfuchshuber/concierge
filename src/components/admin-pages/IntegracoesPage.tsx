import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  MessageCircle,
  CalendarDays,
  FileSignature,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Plug,
  Sparkles,
  Home,
  Filter,
  Settings2,
  Ellipsis,
  Landmark,
  Wallet,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WhatsappBusinessPage } from "@/components/admin-pages/WhatsappBusinessPage";
import { ClicksignPanel } from "@/components/admin-pages/ClicksignPanel";
import { GoogleCalendarPanel } from "@/components/admin-pages/GoogleCalendarPanel";
import { INTEGRATION_WINDOW_CLASS } from "@/components/admin-pages/integration-window";
import { ChannexPanel } from "@/components/admin-pages/ChannexPanel";
import { AsaasPanel, BancosPanel, bankSummaryRows, useBankConnections } from "@/components/admin-pages/BancosPanel";
import { asaasItem, onlyBanks } from "@/lib/bank-account-label";
import { getMyGoogleCalendarStatus } from "@/lib/google-calendar.functions";
import { getMyWhatsappConfig } from "@/lib/whatsapp.functions";
import { getMyClicksignConfig } from "@/lib/clicksign.functions";
import { getChannexStatus } from "@/lib/channex.functions";
import { SearchActionRow } from "@/components/dashboard/SearchActionRow";
import { ActionButton } from "@/components/admin-pages/admin-mobile-ui";
import { cn } from "@/lib/utils";
import { useImpersonation } from "@/hooks/useImpersonation";

// ---------------------------------------------------------------------------
// Racional importado do Orks Tech: busca + filtros com contadores, cards
// compactos com expansividade única (apenas um aberto por vez), badges de
// status e ordenação Ativas → Não conectadas → Em breve. Só listamos
// integrações que o anfitrião conecta — módulos internos da plataforma
// (mapas, pagamentos, IA, e-mail) não aparecem aqui.
// ---------------------------------------------------------------------------

type StatusKey = "ativa" | "inativa" | "em_breve";

type IntegrationConfig = {
  key: string;
  nome: string;
  descricao: string;
  /** Linha curta sob o nome, nos cards (celular e computador). */
  subtitulo: string;
  categoria: "Comunicação" | "Operação" | "Documentos" | "Financeiro";
  icon: typeof MessageCircle;
  detalhe: string;
};

const INTEGRATIONS: IntegrationConfig[] = [
  {
    key: "clicksign",
    nome: "ClickSign",
    descricao: "Importe todos os contratos assinados e vincule a proprietários e hóspedes.",
    subtitulo: "Contratos digitais",
    categoria: "Documentos",
    icon: FileSignature,
    detalhe:
      "Informe a chave de API para importar o histórico completo de documentos. Cada contrato é vinculado automaticamente ao proprietário, prestador ou hóspede correspondente pelo CPF/CNPJ, e-mail ou nome do signatário.",
  },
  {
    key: "gcal",
    nome: "Google Agenda",
    descricao: "Espelhe chegadas, saídas, limpezas, gravações e transcrições da equipe.",
    subtitulo: "Agendas do Gmail",
    categoria: "Operação",
    icon: CalendarDays,
    detalhe:
      "Conecte a conta Google desta operação (OAuth). Importamos todas as agendas, eventos e os arquivos de gravação e transcrição gerados pelo Google Meet vinculados a cada evento.",
  },
  {
    key: "bancos",
    nome: "Bancos",
    descricao: "Contas bancárias da empresa conectadas via Open Finance.",
    subtitulo: "Integração bancária",
    categoria: "Financeiro",
    icon: Landmark,
    detalhe:
      "Conecte as contas da empresa pelo Open Finance para importar saldos e transações, em modo somente leitura.",
  },
  {
    key: "asaas",
    nome: "Asaas PJ",
    descricao: "Extrato e transações da conta digital PJ.",
    subtitulo: "Extrato e transações",
    categoria: "Financeiro",
    icon: Wallet,
    detalhe:
      "Conta digital PJ do Asaas sincronizada automaticamente pela API: saldo, extrato e transações.",
  },
  {
    key: "channex",
    nome: "Channex (Airbnb)",
    descricao: "Importe os anúncios do Airbnb conectados e mantenha os imóveis sincronizados.",
    subtitulo: "Anúncios do Airbnb",
    categoria: "Operação",
    icon: Home,
    detalhe:
      "Traz para o painel os anúncios do Airbnb conectados via Channex. Cada anúncio vira um imóvel, com tipo de quarto e tarifa padrão em BRL criados automaticamente.",
  },
  {
    key: "whatsapp",
    nome: "WhatsApp Business",
    descricao: "Receba e responda mensagens dos hóspedes direto no Atendimento.",
    subtitulo: "Mensagens dos hóspedes",
    categoria: "Comunicação",
    icon: MessageCircle,
    detalhe:
      "Conecte o número oficial da sua operação para centralizar as conversas dos hóspedes no painel de Atendimento.",
  },
];

const COMING_SOON = new Set<string>([]);

type FilterKey = "todas" | "ativas" | "inativas" | "em_breve";

const FILTERS: Array<{ key: FilterKey; label: string; icon: typeof Plug }> = [
  { key: "todas", label: "Todas", icon: Plug },
  { key: "ativas", label: "Ativas", icon: CheckCircle2 },
  { key: "inativas", label: "Inativas", icon: XCircle },
  { key: "em_breve", label: "Em breve", icon: Clock },
];

// Cache quente: navegar entre as abas do Administrativo reaproveita o resultado sem piscar nem refetch.
const QUERY_STALE_MS = 5 * 60 * 1000;
const QUERY_GC_MS = 30 * 60 * 1000;

const STATUS_ORDER: Record<StatusKey, number> = { ativa: 0, inativa: 1, em_breve: 2 };

/**
 * Status das integrações (WhatsApp, ClickSign, Google Agenda, Channex), com cache quente.
 * O Administrativo chama este hook ao abrir QUALQUER aba, então quando a pessoa toca em
 * "Integrações" os dados já estão no cache e a aba abre instantânea (pedido 08/11/2026).
 */
export function useIntegrationStatusQueries() {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const waFn = useServerFn(getMyWhatsappConfig);
  const wa = useQuery({
    queryKey: ["whatsapp-config", accountOwnerId],
    queryFn: () => waFn({ data: { ownerId: accountOwnerId } }),
    retry: false,
    staleTime: QUERY_STALE_MS,
    gcTime: QUERY_GC_MS,
  });

  const csFn = useServerFn(getMyClicksignConfig);
  const cs = useQuery({
    queryKey: ["clicksign-config", accountOwnerId],
    queryFn: () => csFn({ data: { ownerId: accountOwnerId } }),
    retry: false,
    staleTime: QUERY_STALE_MS,
    gcTime: QUERY_GC_MS,
  });

  const gcalFn = useServerFn(getMyGoogleCalendarStatus);
  const gcal = useQuery({
    queryKey: ["gcal-status", accountOwnerId],
    queryFn: () => gcalFn({ data: { ownerId: accountOwnerId } }),
    retry: false,
    staleTime: QUERY_STALE_MS,
    gcTime: QUERY_GC_MS,
  });

  const channexFn = useServerFn(getChannexStatus);
  const channex = useQuery({
    queryKey: ["channex-status"],
    queryFn: () => channexFn(),
    retry: false,
    staleTime: QUERY_STALE_MS,
    gcTime: QUERY_GC_MS,
  });

  // Bancos e Asaas PJ: status da conta em tela (mesma resolução das demais integrações).
  const banks = useBankConnections(true, accountOwnerId);
  return { wa, cs, gcal, channex, banks };
}

export function IntegracoesPage() {
  const { impersonation } = useImpersonation();
  const accountOwnerId = impersonation?.userId ?? null;
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todas");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);

  const { wa, cs, gcal, channex, banks } = useIntegrationStatusQueries();
  const waActive = false; // WhatsApp em standby (10/11/2026) até a Cloud API oficial da Meta
  const csActive = !!cs.data?.hasToken;
  const gcalActive = !!gcal.data?.connected;
  const channexActive = !!channex.data?.configured;
  const bankItems = onlyBanks(banks.data?.items ?? []);
  const bancosActive = bankItems.length > 0;
  const asaasRow = asaasItem(banks.data?.items ?? []);
  const asaasActive = !!asaasRow;
  const bankRows = bankSummaryRows(banks.data?.items ?? [], banks.data?.accounts ?? []);
  // Todos os cards abrem recolhidos (pedido 10/11/2026): a lista de bancos só aparece ao tocar na seta.
  const [bancosOpen, setBancosOpen] = useState(false);

  // Primeira carga: até cada consulta responder não sabemos se a integração está ativa.
  // Nunca declarar "inativa"/"Conectar" nesse intervalo (evita o flash e o layout shift).
  const mobileLoading =
    (cs.isLoading && !cs.data) || (gcal.isLoading && !gcal.data) || (banks.isLoading && !banks.data);
  const isLoading =
    (cs.isLoading && !cs.data) || (gcal.isLoading && !gcal.data) || (wa.isLoading && !wa.data) || (channex.isLoading && !channex.data);

  const items = useMemo(
    () =>
      INTEGRATIONS.map((cfg) => {
        let statusKey: StatusKey = "inativa";
        if (COMING_SOON.has(cfg.key)) statusKey = "em_breve";
        else if (cfg.key === "whatsapp") statusKey = waActive ? "ativa" : "inativa";
        else if (cfg.key === "clicksign") statusKey = csActive ? "ativa" : "inativa";
        else if (cfg.key === "channex") statusKey = channexActive ? "ativa" : "inativa";
        else if (cfg.key === "gcal") statusKey = gcalActive ? "ativa" : "inativa";
        else if (cfg.key === "bancos") statusKey = bancosActive ? "ativa" : "inativa";
        else if (cfg.key === "asaas") statusKey = asaasActive ? "ativa" : "inativa";
        return { cfg, statusKey };
      })
        .sort(
          (a, b) =>
            STATUS_ORDER[a.statusKey] - STATUS_ORDER[b.statusKey] || a.cfg.nome.localeCompare(b.cfg.nome, "pt-BR"),
        ),
    [waActive, csActive, gcalActive, channexActive, bancosActive, asaasActive],
  );

  // Bancos e Asaas PJ: por enquanto só no celular (decisão de 10/11/2026); o computador fica como estava.
  const deskItems = useMemo(() => items.filter(({ cfg }) => cfg.key !== "bancos" && cfg.key !== "asaas"), [items]);
  const counts = useMemo(
    () => ({
      todas: deskItems.length,
      ativas: deskItems.filter((i) => i.statusKey === "ativa").length,
      inativas: deskItems.filter((i) => i.statusKey === "inativa").length,
      em_breve: deskItems.filter((i) => i.statusKey === "em_breve").length,
    }),
    [deskItems],
  );

  const filtered = deskItems.filter(({ cfg, statusKey }) => {
    if (filter === "ativas" && statusKey !== "ativa") return false;
    if (filter === "inativas" && statusKey !== "inativa") return false;
    if (filter === "em_breve" && statusKey !== "em_breve") return false;
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return `${cfg.nome} ${cfg.descricao} ${cfg.categoria}`.toLowerCase().includes(term);
  });

  // CELULAR — mockup "Proposta · Integrações" (05/11/2026): quadradinhos compactos, sem rótulos de seção;
  // a faixa verde da esquerda marca a conectada. O WhatsApp ainda não aparece (não temos a integração).
  const [panel, setPanel] = useState<string | null>(null);
  const mobileItems = items
    .filter(({ cfg }) => cfg.key !== "whatsapp" && cfg.key !== "channex")
    // Ativas primeiro; dentro de cada grupo, na ordem dos mockups: ClickSign, Google Agenda, Bancos, Asaas PJ.
    .sort((a, b) => STATUS_ORDER[a.statusKey] - STATUS_ORDER[b.statusKey] || INTEGRATIONS.indexOf(a.cfg) - INTEGRATIONS.indexOf(b.cfg))
    .filter(({ cfg }) => {
    const term = q.trim().toLowerCase();
    return !term || `${cfg.nome} ${cfg.descricao} ${cfg.categoria}`.toLowerCase().includes(term);
  });
  const panelCfg = INTEGRATIONS.find((i) => i.key === panel) ?? null;

  return (
    <>
    <div className="ds-stack lg:hidden">
      <SearchActionRow
        value={q}
        onChange={setQ}
        placeholder="Buscar Integração…"
        actions={
          <span title="Filtros" className="grid w-12 place-items-center text-foreground/70">
            <Filter className="size-4" strokeWidth={1.8} />
          </span>
        }
      />
      <div className="grid grid-cols-2 items-start gap-2.5" aria-busy={mobileLoading}>
        {mobileLoading
          ? mobileItems.map(({ cfg }) => <IntegrationSkeletonMobile key={cfg.key} />)
          : mobileItems.map(({ cfg, statusKey }) => {
          const act = statusKey === "ativa";
          const isBancos = cfg.key === "bancos";
          const canToggle = isBancos && act && bankRows.length > 0;
          const open = canToggle && bancosOpen;
          return (
            <div
              key={cfg.key}
              className="relative min-h-[108px] min-w-0 overflow-hidden rounded-[12px] border border-border/70 bg-card py-3.5 pl-[17px] pr-3.5 shadow-sm"
            >
              {act && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-emerald-500" />}
              <div className="flex min-h-[79px] flex-col">
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="truncate font-display text-[12.5px] font-bold leading-[1.3] tracking-[-0.01em] text-foreground">{cfg.nome}</div>
                    {canToggle && (
                      <button
                        type="button"
                        aria-label={open ? "Recolher bancos" : "Expandir bancos"}
                        aria-expanded={open}
                        onClick={() => setBancosOpen((v) => !v)}
                        className="-mr-0.5 grid size-4 flex-none cursor-pointer place-items-center text-muted-foreground"
                      >
                        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                      </button>
                    )}
                  </div>
                  <div className="mt-[3px] min-h-[15px] truncate text-[11px] leading-[15px] text-muted-foreground">{cfg.subtitulo}</div>
                </div>
                {open && (
                  <div className="mt-2.5 min-w-0">
                    {bankRows.map((r, i) => (
                      <div key={r.id} className={cn("min-w-0", i > 0 && "mt-[9px] border-t border-border/60 pt-[9px]")}>
                        <div className="truncate text-[11px] font-semibold leading-[14px] text-muted-foreground">{r.name}</div>
                        {r.account && <div className="mt-0.5 truncate text-[11px] leading-[14px] text-muted-foreground">{r.account}</div>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-auto flex items-center gap-1.5 pt-2.5">
                  {act ? (
                    <>
                      <ActionButton full icon={<Settings2 className="size-3" strokeWidth={2.2} />} onClick={() => setPanel(cfg.key)}>
                        Gerenciar
                      </ActionButton>
                      <button
                        type="button"
                        aria-label="Mais opções"
                        title="Mais opções"
                        onClick={() => setPanel(cfg.key)}
                        className="grid size-7 flex-none cursor-pointer place-items-center rounded-[8px] border border-border/60 bg-muted text-[11.5px] font-medium text-foreground transition-colors hover:bg-muted/80"
                      >
                        <Ellipsis className="size-3.5" strokeWidth={2} />
                      </button>
                    </>
                  ) : (
                    <ActionButton kind="primary" full className="bg-primary text-primary-foreground hover:bg-primary/90" icon={<Plug className="size-3" strokeWidth={2.2} />} onClick={() => setPanel(cfg.key)}>
                      Conectar
                    </ActionButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* Janelas das integrações (mockups aprovados, 08/11/2026): o próprio painel monta cabeçalho,
          botões suaves, lista com anticorte e rodapé. */}
      <Dialog open={!!panelCfg} onOpenChange={(v) => !v && setPanel(null)}>
        <DialogContent aria-describedby={undefined} className={INTEGRATION_WINDOW_CLASS}>
          {panelCfg?.key === "gcal" ? (
            <GoogleCalendarPanel accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId} inWindow />
          ) : panelCfg?.key === "clicksign" ? (
            <ClicksignPanel accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId} inWindow />
          ) : panelCfg?.key === "bancos" ? (
            <BancosPanel inWindow readOnly={!!accountOwnerId} ownerId={accountOwnerId} />
          ) : panelCfg?.key === "asaas" ? (
            <AsaasPanel inWindow readOnly={!!accountOwnerId} ownerId={accountOwnerId} />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
    <div className="hidden w-full space-y-5 lg:block">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar integração..."
            className="pl-9 rounded-full"
            autoComplete="off"
          />
        </div>
        <div className="ds-scroll-x gap-1.5">
          {FILTERS.map((f) => {
            const Icon = f.icon;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {f.label}
                <span
                  className={cn(
                    "ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold",
                    active ? "bg-primary-foreground/20" : "bg-muted",
                  )}
                >
                  {isLoading ? "–" : counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-busy>
          {deskItems.map(({ cfg }) => (
            <IntegrationSkeletonDesktop key={cfg.key} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nenhuma integração encontrada com esses filtros.
        </p>
      ) : (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(({ cfg, statusKey }) => {
            const Icon = cfg.icon;
            const isOpen = expanded === cfg.key;
            return (
              <div
                key={cfg.key}
                className={cn(
                  "ds-surface border bg-card p-4 transition-all",
                  isOpen ? "border-primary/30 shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.35)]" : "border-border",
                  statusKey === "em_breve" && "opacity-80",
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : cfg.key)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-xl",
                      statusKey === "ativa" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <Icon className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="ds-card-title truncate leading-tight">{cfg.nome}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={statusKey} />
                    </div>
                  </div>
                  <ChevronDown
                    className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")}
                  />
                </button>

                {isOpen && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <p className="ds-card-desc">{cfg.detalhe}</p>

                    {statusKey === "em_breve" ? (
                      <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                        <Sparkles className="size-4 shrink-0 text-amber-500" />
                        Em desenvolvimento — estará disponível em breve.
                      </div>
                    ) : cfg.key === "whatsapp" ? (
                      <Button size="sm" className="h-8 rounded-full text-xs" onClick={() => setWaOpen(true)}>
                        <Plug className="mr-1 size-3.5" />
                        {waActive ? "Gerenciar conexão" : "Conectar"}
                      </Button>
                    ) : cfg.key === "channex" ? (
                      <ChannexPanel />
                    ) : cfg.key === "gcal" ? (
                      <GoogleCalendarPanel accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId} />
                    ) : (
                      <ClicksignPanel accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={waOpen} onOpenChange={setWaOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">WhatsApp Business</DialogTitle>
          </DialogHeader>
          <WhatsappBusinessPage accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId} />
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

// Mesma casca e altura do card mobile real (sem faixa verde nem botão "Conectar").
function IntegrationSkeletonMobile() {
  return (
    <div
      data-testid="integration-skeleton"
      aria-hidden
      className="relative h-[108px] min-w-0 overflow-hidden rounded-[12px] border border-border/70 bg-card py-3.5 pl-[17px] pr-3.5 shadow-sm"
    >
      <div className="flex h-full flex-col">
        <div className="min-w-0">
          <Skeleton className="h-[14px] w-3/4 rounded-[4px]" />
          <Skeleton className="mt-1.5 h-[9px] w-1/2 rounded-[3px]" />
        </div>
        <Skeleton className="mt-auto h-7 w-full rounded-[8px]" />
      </div>
    </div>
  );
}

// Mesma casca do card desktop recolhido (ícone 40px + título + categoria/selo).
function IntegrationSkeletonDesktop() {
  return (
    <div data-testid="integration-skeleton" aria-hidden className="ds-surface border border-border bg-card p-4">
      <div className="flex w-full items-center gap-3">
        <Skeleton className="size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-2/3 rounded-[4px]" />
          <Skeleton className="mt-1.5 h-[18px] w-1/2 rounded-[4px]" />
        </div>
        <Skeleton className="size-4 shrink-0 rounded-[4px]" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: StatusKey }) {
  if (status === "ativa") {
    return (
      <Badge className="gap-1 border-0 bg-emerald-500/15 px-2 py-0 text-[10px] text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400">
        <CheckCircle2 className="size-2.5" /> Ativa
      </Badge>
    );
  }
  if (status === "em_breve") {
    return (
      <Badge
        variant="outline"
        className="gap-1 border-amber-500/30 bg-amber-500/10 px-2 py-0 text-[10px] text-amber-600 dark:text-amber-400"
      >
        <Clock className="size-2.5" /> Em breve
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1 px-2 py-0 text-[10px]">
      <XCircle className="size-2.5" /> Não conectada
    </Badge>
  );
}
