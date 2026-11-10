import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Skeleton } from "@/components/ui/skeleton";
import { useServerFn } from "@tanstack/react-start";
import {
  MessageCircle,
  CalendarDays,
  FileSignature,
  ChevronDown,
  Plug,
  Home,
  Filter,
  Settings2,
  Landmark,
  Wallet,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  const { cs, gcal, channex, banks } = useIntegrationStatusQueries();
  // Todos veem os cards e as informações; só titular/administrador conecta, edita ou desconecta.
  const { isOwner } = useMyPermissions();
  const { isAdmin } = useIsAdmin();
  const canManage = isOwner || isAdmin;
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

  // CELULAR — mockup "Proposta · Integrações" (05/11/2026): quadradinhos compactos, sem rótulos de seção;
  // a faixa verde da esquerda marca a conectada. O WhatsApp ainda não aparece (não temos a integração).
  const [panel, setPanel] = useState<string | null>(null);
  const mobileItems = items
    .filter(({ cfg }) => cfg.key !== "whatsapp")
    // Ativas primeiro; dentro de cada grupo, na ordem dos mockups: ClickSign, Google Agenda, Bancos, Asaas PJ.
    .sort((a, b) => STATUS_ORDER[a.statusKey] - STATUS_ORDER[b.statusKey] || INTEGRATIONS.indexOf(a.cfg) - INTEGRATIONS.indexOf(b.cfg))
    .filter(({ cfg }) => {
    const term = q.trim().toLowerCase();
    return !term || `${cfg.nome} ${cfg.descricao} ${cfg.categoria}`.toLowerCase().includes(term);
  });
  const panelCfg = INTEGRATIONS.find((i) => i.key === panel) ?? null;

  return (
    <>
    <div className="ds-stack">
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
      <div className="grid grid-cols-2 items-start gap-2.5 lg:grid-cols-4" aria-busy={mobileLoading}>
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
              className={cn(
                cfg.key === "channex" && "hidden lg:block",
                "relative min-h-[108px] min-w-0 overflow-hidden rounded-[12px] border border-border/70 bg-card py-3.5 pl-[17px] pr-3.5 shadow-sm",
              )}
            >
              {act && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-emerald-500" />}
              {statusKey === "inativa" && (
                <span aria-hidden data-testid="inactive-strip" className="absolute inset-y-0 left-0 w-[3px] bg-[#c4c4cc] dark:bg-[#9a9aa2]" />
              )}
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
                  <div className="mt-2.5 min-w-0 border-t border-border/60 pt-2">
                    {bankRows.map((r, i) => (
                      <div key={r.id} className={cn("min-w-0", i === 0 ? "pb-[9px] pt-0.5" : "border-t border-border/60 pb-0.5 pt-[9px]")}>
                        <div className="truncate text-[11.5px] font-bold leading-[15px] text-foreground">{r.name}</div>
                        {r.account && <div className="mt-0.5 truncate text-[10.5px] leading-[14px] tabular-nums text-muted-foreground">{r.account}</div>}
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
            <GoogleCalendarPanel accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId || !canManage} inWindow />
          ) : panelCfg?.key === "clicksign" ? (
            <ClicksignPanel accountOwnerId={accountOwnerId} readOnly={!!accountOwnerId || !canManage} inWindow />
          ) : panelCfg?.key === "bancos" ? (
            <BancosPanel inWindow readOnly={!canManage} ownerId={accountOwnerId} />
          ) : panelCfg?.key === "asaas" ? (
            <AsaasPanel inWindow readOnly={!canManage} ownerId={accountOwnerId} />
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={panelCfg?.key === "channex"} onOpenChange={(v) => !v && setPanel(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{panelCfg?.nome}</DialogTitle>
          </DialogHeader>
          <ChannexPanel />
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

