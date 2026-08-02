import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WhatsappBusinessPage } from "@/components/admin-pages/WhatsappBusinessPage";
import { ClicksignPanel } from "@/components/admin-pages/ClicksignPanel";
import { getMyWhatsappConfig } from "@/lib/whatsapp.functions";
import { getMyClicksignConfig } from "@/lib/clicksign.functions";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Racional importado do Orks Tech: busca + filtros com contadores, cards
// compactos com expansividade única (apenas um aberto por vez), badges de
// status e ordenação Ativas → Não conectadas → Em breve. Só listamos
// integrações que o anfitrião conecta — módulos internos da plataforma
// (mapas, pagamentos, IA, e-mail, iCal do Airbnb) não aparecem aqui.
// ---------------------------------------------------------------------------

type StatusKey = "ativa" | "inativa" | "em_breve";

type IntegrationConfig = {
  key: string;
  nome: string;
  descricao: string;
  categoria: "Comunicação" | "Operação" | "Documentos";
  icon: typeof MessageCircle;
  detalhe: string;
};

const INTEGRATIONS: IntegrationConfig[] = [
  {
    key: "whatsapp",
    nome: "WhatsApp Business",
    descricao: "Receba e responda mensagens dos hóspedes direto no Atendimento.",
    categoria: "Comunicação",
    icon: MessageCircle,
    detalhe:
      "Conecte o número oficial da sua operação para centralizar as conversas dos hóspedes no painel de Atendimento.",
  },
  {
    key: "clicksign",
    nome: "ClickSign",
    descricao: "Importe todos os contratos assinados e vincule a proprietários e hóspedes.",
    categoria: "Documentos",
    icon: FileSignature,
    detalhe:
      "Informe a chave de API para importar o histórico completo de documentos. Cada contrato é vinculado automaticamente ao proprietário, prestador ou hóspede correspondente pelo CPF/CNPJ, e-mail ou nome do signatário.",
  },
  {
    key: "gcal",
    nome: "Google Agenda",
    descricao: "Espelhe chegadas, saídas, limpezas, gravações e transcrições da equipe.",
    categoria: "Operação",
    icon: CalendarDays,
    detalhe:
      "Conexão por conta Google de cada anfitrião (OAuth). A liberação depende da aprovação do cliente OAuth Google no workspace — assim que aprovado, agendas, gravações e transcrições são importadas.",
  },
];

const COMING_SOON = new Set(["gcal"]);

type FilterKey = "todas" | "ativas" | "inativas" | "em_breve";

const FILTERS: Array<{ key: FilterKey; label: string; icon: typeof Plug }> = [
  { key: "todas", label: "Todas", icon: Plug },
  { key: "ativas", label: "Ativas", icon: CheckCircle2 },
  { key: "inativas", label: "Inativas", icon: XCircle },
  { key: "em_breve", label: "Em breve", icon: Clock },
];

const STATUS_ORDER: Record<StatusKey, number> = { ativa: 0, inativa: 1, em_breve: 2 };

export function IntegracoesPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("todas");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [waOpen, setWaOpen] = useState(false);

  const waFn = useServerFn(getMyWhatsappConfig);
  const wa = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: () => waFn(),
    retry: false,
  });
  const waActive = !!wa.data?.senderNumber;

  const csFn = useServerFn(getMyClicksignConfig);
  const cs = useQuery({
    queryKey: ["clicksign-config"],
    queryFn: () => csFn(),
    retry: false,
  });
  const csActive = !!cs.data?.hasToken;

  const items = useMemo(
    () =>
      INTEGRATIONS.map((cfg) => {
        let statusKey: StatusKey = "inativa";
        if (COMING_SOON.has(cfg.key)) statusKey = "em_breve";
        else if (cfg.key === "whatsapp") statusKey = waActive ? "ativa" : "inativa";
        else if (cfg.key === "clicksign") statusKey = csActive ? "ativa" : "inativa";
        return { cfg, statusKey };
      }).sort(
        (a, b) =>
          STATUS_ORDER[a.statusKey] - STATUS_ORDER[b.statusKey] || a.cfg.nome.localeCompare(b.cfg.nome, "pt-BR"),
      ),
    [waActive, csActive],
  );

  const counts = useMemo(
    () => ({
      todas: items.length,
      ativas: items.filter((i) => i.statusKey === "ativa").length,
      inativas: items.filter((i) => i.statusKey === "inativa").length,
      em_breve: items.filter((i) => i.statusKey === "em_breve").length,
    }),
    [items],
  );

  const filtered = items.filter(({ cfg, statusKey }) => {
    if (filter === "ativas" && statusKey !== "ativa") return false;
    if (filter === "inativas" && statusKey !== "inativa") return false;
    if (filter === "em_breve" && statusKey !== "em_breve") return false;
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return `${cfg.nome} ${cfg.descricao} ${cfg.categoria}`.toLowerCase().includes(term);
  });


  return (
    <div className="w-full space-y-5">
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
        <div className="flex items-center gap-1.5 flex-wrap">
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
                  {counts[f.key]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nenhuma integração encontrada com esses filtros.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map(({ cfg, statusKey }) => {
            const Icon = cfg.icon;
            const isOpen = expanded === cfg.key;
            return (
              <div
                key={cfg.key}
                className={cn(
                  "rounded-2xl border bg-card p-4 transition-all",
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
                    <p className="truncate text-sm font-medium leading-tight">{cfg.nome}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-muted-foreground">{cfg.categoria}</span>
                      <StatusBadge status={statusKey} />
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="mt-3 space-y-3 border-t border-border pt-3">
                    <p className="text-xs text-muted-foreground">{cfg.detalhe}</p>

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
                    ) : (
                      <Button asChild size="sm" variant="outline" className="h-8 rounded-full text-xs">
                        <Link to="/admin/guias">Configurar por residência</Link>
                      </Button>
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
          <WhatsappBusinessPage />
        </DialogContent>
      </Dialog>
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
