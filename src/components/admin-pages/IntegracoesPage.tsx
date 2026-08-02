import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search,
  MessageCircle,
  CalendarSync,
  MapPin,
  CreditCard,
  BarChart3,
  Mail,
  Sparkles,
  Check,
  Clock,
  CalendarDays,
  FileSignature,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WhatsappBusinessPage } from "@/components/admin-pages/WhatsappBusinessPage";
import { getMyWhatsappConfig } from "@/lib/whatsapp.functions";

type Status = "active" | "inactive" | "soon";

type Integration = {
  key: string;
  name: string;
  description: string;
  icon: typeof MessageCircle;
  tone: string;
  status: Status;
  openable?: boolean;
};

const FILTERS: Array<{ key: "all" | Status; label: string }> = [
  { key: "all", label: "Todas" },
  { key: "active", label: "Ativas" },
  { key: "inactive", label: "Inativas" },
  { key: "soon", label: "Em breve" },
];

export function IntegracoesPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | Status>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const waFn = useServerFn(getMyWhatsappConfig);
  const wa = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: () => waFn(),
    retry: false,
  });

  const waActive = !!wa.data?.senderNumber;

  const integrations: Integration[] = useMemo(
    () => [
      {
        key: "whatsapp",
        name: "WhatsApp Business",
        description: "Receba e responda mensagens dos hóspedes direto no Atendimento.",
        icon: MessageCircle,
        tone: "from-emerald-500/20 text-emerald-500",
        status: waActive ? "active" : "inactive",
        openable: true,
      },
      {
        key: "airbnb",
        name: "Airbnb iCal",
        description: "Sincronize reservas e datas de check-in/check-out automaticamente.",
        icon: CalendarSync,
        tone: "from-rose-500/20 text-rose-500",
        status: "active",
      },
      {
        key: "gcal",
        name: "Google Agenda",
        description: "Espelhe chegadas, saídas e limpezas na agenda da sua equipe.",
        icon: CalendarDays,
        tone: "from-blue-500/20 text-blue-500",
        status: "soon",
      },
      {
        key: "clicksign",
        name: "ClickSign",
        description: "Contratos e termos de hospedagem assinados digitalmente.",
        icon: FileSignature,
        tone: "from-indigo-500/20 text-indigo-500",
        status: "soon",
      },
      {
        key: "maps",
        name: "Google Maps",
        description: "Recomendações, fotos e distâncias reais dos pontos de interesse.",
        icon: MapPin,
        tone: "from-sky-500/20 text-sky-500",
        status: "active",
      },
      {
        key: "paddle",
        name: "Pagamentos",
        description: "Assinaturas, cobranças recorrentes e gestão de plano.",
        icon: CreditCard,
        tone: "from-violet-500/20 text-violet-500",
        status: "active",
      },
      {
        key: "ai",
        name: "Concierge IA",
        description: "Respostas automáticas com a base de conhecimento do seu guia.",
        icon: Sparkles,
        tone: "from-amber-500/20 text-amber-500",
        status: "active",
      },
      {
        key: "analytics",
        name: "Google Analytics",
        description: "Métricas de acesso e comportamento dos hóspedes no guia.",
        icon: BarChart3,
        tone: "from-orange-500/20 text-orange-500",
        status: "soon",
      },
      {
        key: "email",
        name: "E-mail transacional",
        description: "Envio de convites, avisos e comunicações com a sua marca.",
        icon: Mail,
        tone: "from-teal-500/20 text-teal-500",
        status: "active",
      },
    ],
    [waActive],
  );

  const filtered = integrations.filter((i) => {
    if (filter !== "all" && i.status !== filter) return false;
    const term = q.trim().toLowerCase();
    if (!term) return true;
    return `${i.name} ${i.description}`.toLowerCase().includes(term);
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
          />
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-card p-0.5 self-start">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs transition-colors ${
                filter === f.key
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((i) => {
          const Icon = i.icon;
          const disabled = i.status === "soon" || !i.openable;
          return (
            <button
              key={i.key}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && setOpenKey(i.key)}
              className={`text-left rounded-2xl border border-border bg-card p-4 transition-all ${
                disabled
                  ? "opacity-70 cursor-default"
                  : "hover:border-primary/40 hover:shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.35)]"
              }`}
            >
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br to-transparent ${i.tone}`}
                >
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium leading-tight">{i.name}</p>
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                    {i.description}
                  </p>
                </div>
                <StatusPill status={i.status} />
              </div>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-16">
          Nenhuma integração encontrada.
        </p>
      )}

      <Dialog open={openKey === "whatsapp"} onOpenChange={(o) => !o && setOpenKey(null)}>
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

function StatusPill({ status }: { status: Status }) {
  if (status === "active") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[10px] px-2 py-0.5 flex items-center gap-1">
        <Check className="size-3" /> Ativa
      </span>
    );
  }
  if (status === "soon") {
    return (
      <span className="shrink-0 rounded-full bg-muted text-muted-foreground text-[10px] px-2 py-0.5 flex items-center gap-1">
        <Clock className="size-3" /> Em breve
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full border border-border text-muted-foreground text-[10px] px-2 py-0.5">
      Inativa
    </span>
  );
}
