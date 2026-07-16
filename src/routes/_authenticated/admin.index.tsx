import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyProperties, deleteProperty, duplicateProperty, listPropertiesForAccount } from "@/lib/properties.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Plus, ExternalLink, Pencil, Trash2, Lock, Globe, BookOpen, CreditCard, LayoutGrid, List, Link2, Check, AlertTriangle, MapPin, ChevronDown, ChevronRight, PenSquare, Search, X, Copy, Filter, MoreHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useState, useMemo } from "react";
type StatusFilter = "all" | "published" | "draft";
type AccessFilter = "all" | "public" | "pin";
import { useSubscription } from "@/hooks/useSubscription";
import { PLANS } from "@/lib/payments.functions";
import { BulkEditDialog } from "@/components/BulkEditDialog";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { adminListUserPropertiesFull } from "@/lib/admin-subs.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { Eye } from "lucide-react";



export const Route = createFileRoute("/_authenticated/admin/")({
  component: Dashboard,
});



// Calculates a guide completeness score 0-100 based on filled fields.
// Uses only fields available in listMyProperties.
function guideCompleteness(p: {
  name?: string | null; tagline?: string | null; hero_image_url?: string | null;
  address?: string | null; city?: string | null; wifi_ssid?: string | null;
  checkin_time?: string | null; checkout_time?: string | null;
}): { score: number; label: string; color: string } {
  const checks = [
    !!p.name,
    !!p.tagline,
    !!p.hero_image_url,
    !!p.address,
    !!p.city,
    !!p.wifi_ssid,
    !!p.checkin_time,
    !!p.checkout_time,
  ];
  const score = Math.round((checks.filter(Boolean).length / checks.length) * 100);
  if (score >= 90) return { score, label: "Completo", color: "bg-emerald-500" };
  if (score >= 60) return { score, label: "Bom", color: "bg-amber-400" };
  return { score, label: "Incompleto", color: "bg-red-400" };
}


function Dashboard() {
  const list = useServerFn(listMyProperties);
  const listAsUser = useServerFn(adminListUserPropertiesFull);
  const listForAccount = useServerFn(listPropertiesForAccount);
  const { isAdmin: isSaasAdmin } = useIsAdmin();
  const del = useServerFn(deleteProperty);
  const dup = useServerFn(duplicateProperty);
  const [dupTarget, setDupTarget] = useState<{ id: string; name: string } | null>(null);
  const [dupCopies, setDupCopies] = useState<number>(1);
  const [dupBusy, setDupBusy] = useState(false);
  const navigate = useNavigate();
  const { impersonation, clear: clearImpersonation } = useImpersonation();
  // Read-only banner apenas quando um admin SaaS está visualizando um cliente.
  // Membros de conta (atendentes/owners convidados) têm acesso de edição.
  const readOnly = !!impersonation && isSaasAdmin;

  const [view, setView] = useState<"grid" | "list">("grid");
  const [statCardsOpen, setStatCardsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewSlug, setViewSlug] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop" | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");

  function closePreview() {
    setViewSlug(null);
    setPreviewMode(null);
  }

  function getPublicBaseUrl() {
    if (typeof window === "undefined") return "";
    const { origin, hostname } = window.location;
    if (
      hostname.endsWith(".lovableproject.com") ||
      hostname.includes("id-preview--") ||
      hostname.endsWith(".lovable.dev")
    ) {
      return "https://home-welcome-compass.lovable.app";
    }
    return origin;
  }

  async function handleCopyLink(slug: string, id: string) {
    const url = `${getPublicBaseUrl()}/g/${slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(id);
      toast.success("Link público copiado");
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1800);
    } catch {
      toast.error("Não foi possível copiar o link");
    }
  }
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["my-properties", impersonation?.userId ?? "self", isSaasAdmin ? "admin" : "member"],
    queryFn: () => {
      if (!impersonation) return list();
      // Admin SaaS impersonando cliente → função admin (traz metadados extras).
      // Membro de conta → usa RLS via listPropertiesForAccount.
      return isSaasAdmin
        ? listAsUser({ data: { userId: impersonation.userId } })
        : listForAccount({ data: { ownerId: impersonation.userId } });
    },
  });
  const { info: sub } = useSubscription({ impersonateUserId: impersonation && isSaasAdmin ? impersonation.userId : null });

  // Admin sem guias próprios e SEM impersonação: nada de auto-redirect agora —
  // ele pode escolher manualmente um cliente pelo dropdown da sidebar.
  const { isAdmin } = useIsAdmin();
  void isAdmin;






  async function handleDelete(id: string, name: string) {
    try {
      await del({ data: { id } });
      toast.success("Guia excluído");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    }
  }

  async function handleConfirmDuplicate() {
    if (!dupTarget) return;
    setDupBusy(true);
    try {
      const res = await dup({ data: { id: dupTarget.id, copies: dupCopies } });
      if (res.created > 0) {
        toast.success(
          res.skipped > 0
            ? `${res.created} cópia(s) criada(s). ${res.skipped} não coube(ram) no seu plano.`
            : `${res.created} cópia(s) criada(s) como rascunho.`,
        );
      } else {
        toast.error("Nenhuma cópia criada — limite do plano atingido.");
      }
      setDupTarget(null);
      setDupCopies(1);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao duplicar");
    } finally {
      setDupBusy(false);
    }
  }


  const count = data?.length ?? 0;
  const planConfig = sub.plan ? PLANS[sub.plan] : null;
  const planName = planConfig?.name ?? "Sem plano";
  const hasCustomPrice = sub.customPriceCents != null;
  const customCurrency = sub.customCurrency || "BRL";
  const planPrice = hasCustomPrice
    ? (sub.customPriceCents! / 100).toLocaleString("pt-BR", { style: "currency", currency: customCurrency })
    : planConfig?.priceLabel ?? "—";
  const planLimit = sub.maxGuides;
  const remaining = Math.max(0, planLimit - count);
  const pct = planLimit > 0 ? Math.min(100, (count / planLimit) * 100) : 0;
  const reachedLimit = planLimit > 0 && count >= planLimit;
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : null;
  const renewalLabel = fmtDate(sub.currentPeriodEnd);
  const trialLabel = sub.isTrialing ? fmtDate(sub.trialEndsAt ?? sub.currentPeriodEnd) : null;

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    return data.filter((p) => {
      if (statusFilter === "published" && !p.published) return false;
      if (statusFilter === "draft" && p.published) return false;
      if (accessFilter !== "all" && p.access_mode !== accessFilter) return false;
      if (!q) return true;
      return [p.name, p.tagline, p.address, p.city, p.country, p.slug]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q));
    });
  }, [data, search, statusFilter, accessFilter]);

  const hasActiveFilters =
    search.trim() !== "" || statusFilter !== "all" || accessFilter !== "all";
  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setAccessFilter("all");
  }


  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      {readOnly && (
        <div className="mb-6 rounded-md border border-accent/30 bg-accent/10 px-4 py-3 flex items-center gap-3">
          <Eye className="size-4 text-accent shrink-0" />
          <div className="flex-1 text-sm">
            Visualizando o painel de{" "}
            <span className="font-semibold">{impersonation?.name ?? "—"}</span>
            <span className="text-muted-foreground"> · somente leitura</span>
          </div>
          <button
            type="button"
            onClick={() => { clearImpersonation(); navigate({ to: "/admin" }); }}
            className="text-xs px-3 py-1.5 rounded-md border border-border bg-background/60 hover:bg-secondary"
          >
            Sair da visualização
          </button>
        </div>
      )}
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-display text-3xl md:text-4xl leading-tight">
            {readOnly ? `Painel de ${impersonation?.name ?? ""}` : "Bem-vindo de volta"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {readOnly
              ? "Visualização apenas de leitura. Nenhuma alteração será salva."
              : "Aqui está o resumo do seu painel hoje."}
          </p>
        </div>
        <div className="flex items-center gap-2">

          {!readOnly && (
            <Button
              onClick={() => navigate({ to: "/admin/properties/$id", params: { id: "new" } })}
              className="rounded-full"
              disabled={reachedLimit || !sub.plan}
              title={
                !sub.plan
                  ? "Assine um plano para criar guias"
                  : reachedLimit
                  ? "Limite do seu plano atingido. Faça upgrade."
                  : undefined
              }
            >
              <Plus className="size-4 mr-1.5" /> Novo guia
            </Button>
          )}
        </div>
      </div>


      {/* Stat cards (collapsible) */}
      <div className="mb-10">
        <button
          type="button"
          onClick={() => setStatCardsOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-secondary/40 transition-colors mb-3"
          aria-expanded={statCardsOpen}
        >
          <span className="text-sm font-medium text-foreground/80 flex items-center gap-2">
            <CreditCard className="size-4 text-muted-foreground" />
            Plano e uso · <span className="text-muted-foreground">{planName} · {count}{planLimit > 0 ? `/${planLimit >= 9999 ? "∞" : planLimit}` : ""}</span>
          </span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${statCardsOpen ? "rotate-180" : ""}`} />
        </button>

        {/* Barra elegante de uso de guias */}
        {planLimit > 0 && (
          <div className="mb-3 px-1">
            <div className="flex items-center justify-between text-[11px] mb-1.5">
              <span className="uppercase tracking-[0.14em] text-muted-foreground font-medium">Uso de guias</span>
              <span className="tabular-nums text-foreground/80">
                <span className="font-semibold text-foreground">{count}</span>
                <span className="text-muted-foreground"> / {planLimit >= 9999 ? "∞" : planLimit}</span>
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-secondary/60 overflow-hidden ring-1 ring-inset ring-border/40">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-accent/70 via-accent to-accent/90 shadow-[0_0_12px_-2px_oklch(from_var(--accent)_l_c_h/0.6)] transition-all duration-700 ease-out"
                style={{ width: `${planLimit >= 9999 ? Math.min(100, (count / Math.max(count + 10, 20)) * 100) : pct}%` }}
              />
            </div>
          </div>
        )}

        {statCardsOpen && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Plano */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Seu Plano</span>
            <CreditCard className="size-4 text-muted-foreground" />
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-2xl font-display">{planName}</span>
            {sub.isTrialing && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full">Trial</span>
            )}
            {sub.isPastDue && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">Pagamento falhou</span>
            )}
            {sub.cancelAtPeriodEnd && !sub.isPastDue && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">Cancelamento agendado</span>
            )}
            {sub.isManual && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-foreground/70 bg-secondary px-2 py-0.5 rounded-full">Contrato</span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-semibold">{planPrice}</span>
            {(planConfig || hasCustomPrice) && <span className="text-xs text-muted-foreground">/mês</span>}
            {hasCustomPrice && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-accent">personalizado</span>
            )}
          </div>
          {(trialLabel || renewalLabel) && (
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {trialLabel && (
                <div>
                  <dt className="text-muted-foreground">Trial até</dt>
                  <dd className="font-medium tabular-nums">{trialLabel}</dd>
                </div>
              )}
              {renewalLabel && !sub.isTrialing && (
                <div>
                  <dt className="text-muted-foreground">{sub.cancelAtPeriodEnd ? "Acesso até" : "Próxima renovação"}</dt>
                  <dd className="font-medium tabular-nums">{renewalLabel}</dd>
                </div>
              )}
            </dl>
          )}
          <Link
            to={sub.plan ? "/admin/assinatura" : "/precos"}
            className="text-xs text-accent hover:underline mt-3 inline-block"
          >
            {sub.plan ? "Gerenciar assinatura" : "Ver planos"} →
          </Link>
        </div>

        {/* Uso */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Uso de guias</span>
            <BookOpen className="size-4 text-muted-foreground" />
          </div>
          <div className="text-2xl font-display">
            {count}{" "}
            <span className="text-sm text-muted-foreground font-sans">
              / {planLimit ? (planLimit >= 9999 ? "ilimitado" : planLimit) : "—"}
            </span>
            {sub.maxGuidesOverride != null && (
              <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold text-accent align-middle">contrato</span>
            )}
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {planLimit > 0
              ? planLimit >= 9999
                ? "Sem limite de guias"
                : `${remaining} guias restantes`
              : "Assine um plano para criar guias"}
          </p>
        </div>
        </div>
        )}
      </div>


      {sub.isPastDue && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">Pagamento falhou</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Atualize seu método de pagamento para evitar a suspensão do acesso.
            </p>
          </div>
          <Link to="/admin/assinatura" className="text-xs font-medium px-3 py-1.5 rounded-full bg-destructive text-destructive-foreground hover:opacity-90">
            Resolver
          </Link>
        </div>
      )}




      {/* Guias section */}
      <div className="flex flex-col gap-4 mb-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl">Seus guias</h2>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="relative size-9 grid place-items-center rounded-full border border-border bg-card hover:bg-secondary/60 transition-colors"
                  aria-label="Filtros"
                >
                  <Filter className="size-4" />
                  {(statusFilter !== "all" || accessFilter !== "all") && (
                    <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-accent" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-4 space-y-4">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Status</div>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { v: "all", label: "Todos" },
                      { v: "published", label: "Publicados" },
                      { v: "draft", label: "Rascunhos" },
                    ] as { v: StatusFilter; label: string }[]).map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setStatusFilter(opt.v)}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${statusFilter === opt.v ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:border-foreground/40"}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Acesso</div>
                  <div className="flex flex-wrap gap-1.5">
                    {([
                      { v: "all", label: "Todos" },
                      { v: "public", label: "Público" },
                      { v: "pin", label: "PIN" },
                    ] as { v: AccessFilter; label: string }[]).map((opt) => (
                      <button
                        key={opt.v}
                        type="button"
                        onClick={() => setAccessFilter(opt.v)}
                        className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${accessFilter === opt.v ? "bg-foreground text-background border-foreground" : "bg-background border-border text-muted-foreground hover:border-foreground/40"}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="w-full text-xs text-muted-foreground hover:text-foreground py-1.5 rounded-lg border border-border hover:bg-secondary/40"
                  >
                    Limpar filtros
                  </button>
                )}
              </PopoverContent>
            </Popover>
            <div className="flex items-center gap-1 rounded-full border border-border p-1 bg-card">
              <button
                onClick={() => setView("grid")}
                className={`size-8 grid place-items-center rounded-full transition-colors ${view === "grid" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                aria-label="Grade"
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                onClick={() => setView("list")}
                className={`size-8 grid place-items-center rounded-full transition-colors ${view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground"}`}
                aria-label="Lista"
              >
                <List className="size-3.5" />
              </button>
            </div>
          </div>
        </div>

        {data && data.length > 0 && (
          <div className="relative">
            <Search className="size-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, endereço, cidade…"
              className="pl-9 pr-9 rounded-full"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 size-6 grid place-items-center rounded-full text-muted-foreground hover:bg-secondary"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        )}

        {data && data.length > 0 && hasActiveFilters && (
          <p className="text-xs text-muted-foreground">
            Mostrando {filtered.length} de {data.length} guia{data.length > 1 ? "s" : ""}
          </p>
        )}
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="aspect-[16/10] bg-secondary animate-pulse" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-secondary rounded animate-pulse w-2/3" />
                <div className="h-3 bg-secondary rounded animate-pulse w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : !data?.length ? (
        <>

        <div className="mb-8 rounded-2xl border border-accent/20 bg-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] text-accent font-semibold mb-1">Primeiros passos</p>
              <h3 className="font-display text-xl">Crie seu primeiro guia em minutos</h3>
            </div>
            <div className="text-right">
              <span className="text-2xl font-display text-accent">01</span>
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">/ 05</p>
            </div>
          </div>
          <div className="space-y-3">
            {([
              { n: "01", label: "Cole o link do Google Maps da sua propriedade", done: false },
              { n: "02", label: "Confira o endereço e adicione Wi-Fi", done: false },
              { n: "03", label: "Configure os horários de check-in e check-out", done: false },
              { n: "04", label: "Adicione recomendações de restaurantes e atrações", done: false },
              { n: "05", label: "Publique e compartilhe o link com o hóspede", done: false },
            ] as { n: string; label: string; done: boolean }[]).map((step) => (
              <div key={step.n} className="flex items-center gap-3">
                <span className="size-7 rounded-full border border-border text-[10px] font-mono text-muted-foreground grid place-items-center shrink-0">{step.n}</span>
                <span className="text-[13.5px] text-foreground/80">{step.label}</span>
              </div>
            ))}
          </div>
          <Button
            className="mt-5 rounded-full"
            onClick={() => navigate({ to: "/admin/properties/$id", params: { id: "new" } })}
            disabled={!sub.plan}
          >
            <Plus className="size-4 mr-1.5" /> Criar meu primeiro guia
          </Button>
        </div>
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="size-12 rounded-2xl bg-accent/10 grid place-items-center mx-auto mb-4">
            <BookOpen className="size-5 text-accent" />
          </div>
          <h3 className="font-display text-2xl mb-2">Crie seu primeiro guia</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Você só precisa do nome do imóvel e do link do Google Maps. Cuidamos do resto.
          </p>
          <Button onClick={() => navigate({ to: "/admin/properties/$id", params: { id: "new" } })} className="rounded-full">
            <Plus className="size-4 mr-1.5" /> Criar guia
          </Button>
        </div>
        </>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/30 p-12 text-center">
          <div className="size-12 rounded-2xl bg-secondary grid place-items-center mx-auto mb-4">
            <Search className="size-5 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl mb-2">Nenhum guia encontrado</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
            Tente ajustar a busca ou limpar os filtros.
          </p>
          <Button variant="outline" onClick={clearFilters} className="rounded-full">
            Limpar filtros
          </Button>
        </div>
      ) : view === "grid" ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <div key={p.id} className="rounded-2xl border border-border bg-card overflow-hidden group hover:shadow-elevated transition-shadow">
              <div className="aspect-[16/10] bg-secondary relative">
                {p.hero_image_url ? (
                  <img src={p.hero_image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full grid place-items-center text-muted-foreground text-xs">Sem imagem</div>
                )}
                <span className="absolute top-3 left-3 glass rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold inline-flex items-center gap-1">
                  {p.access_mode === "pin" ? <><Lock className="size-2.5" /> PIN</> : <><Globe className="size-2.5" /> Público</>}
                </span>
                {!p.published && (
                  <span className="absolute top-3 right-3 bg-yellow-500/90 text-black rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold">Rascunho</span>
                )}
              </div>
              <div className="p-4">
                <h3 className="font-semibold leading-tight truncate">{p.name}</h3>
                <p className="text-xs text-muted-foreground mt-1 truncate">{p.tagline || `${p.city ?? ""}${p.country ? `, ${p.country}` : ""}`}</p>
                {(() => {
                  const c = guideCompleteness(p as any);
                  return (
                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${c.color}`} style={{ width: `${c.score}%` }} />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{c.score}%</span>
                    </div>
                  );
                })()}
                <div className="flex items-center gap-2 mt-3">
                  <Link to="/admin/properties/$id" params={{ id: p.id }} className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium bg-secondary rounded-full py-2 hover:bg-secondary/70">
                    <Pencil className="size-3" /> Editar
                  </Link>
                  <button type="button" onClick={() => setViewSlug(p.slug)} className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium bg-secondary rounded-full py-2 hover:bg-secondary/70">
                    <ExternalLink className="size-3" /> Ver
                  </button>
                  <button
                    onClick={() => handleCopyLink(p.slug, p.id)}
                    title="Copiar link público"
                    aria-label="Copiar link público"
                    className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {copiedId === p.id ? <Check className="size-3.5 text-accent" /> : <Link2 className="size-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDupTarget({ id: p.id, name: p.name }); setDupCopies(1); }}
                    title="Duplicar guia"
                    aria-label="Duplicar guia"
                    className="p-2 rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button title="Excluir" className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive" aria-label="Excluir">
                        <Trash2 className="size-3.5" />
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir guia?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Isso removerá permanentemente "{p.name}" e não poderá ser desfeito.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDelete(p.id, p.name)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                          Excluir
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        (() => {
          const norm = (s?: string | null) =>
            (s ?? "").toLowerCase().trim().replace(/\s+/g, " ");
          const keyOf = (p: typeof filtered[number]) => {
            if (p.lat != null && p.lng != null) {
              return `geo:${Number(p.lat).toFixed(4)},${Number(p.lng).toFixed(4)}`;
            }
            const a = norm(p.address);
            return a ? `addr:${a}` : "none";
          };
          const groups = new Map<string, { label: string; items: typeof filtered }>();
          for (const p of filtered) {
            const k = keyOf(p);
            if (!groups.has(k)) {
              groups.set(k, {
                label:
                  k === "none"
                    ? "Sem endereço"
                    : p.address || `${p.lat},${p.lng}`,
                items: [],
              });
            }
            groups.get(k)!.items.push(p);
          }
          const groupList = Array.from(groups.entries());
          const allSelected = selected.size > 0 && selected.size === filtered.length;
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-3 px-1">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => {
                    if (v) setSelected(new Set(filtered.map((p) => p.id)));
                    else setSelected(new Set());
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {selected.size > 0
                    ? `${selected.size} selecionado${selected.size > 1 ? "s" : ""}`
                    : "Selecione para editar em massa"}
                </span>
                <div className="flex-1" />
                {selected.size > 0 && (
                  <>
                    <button
                      onClick={() => setSelected(new Set())}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Limpar
                    </button>
                    <Button size="sm" className="rounded-full" onClick={() => setBulkOpen(true)}>
                      <PenSquare className="size-3.5 mr-1.5" /> Editar selecionados
                    </Button>
                  </>
                )}
              </div>

              {groupList.map(([gk, grp]) => {
                const expanded = expandedGroup === gk;
                const groupIds = grp.items.map((i) => i.id);
                const allInGroupSelected = groupIds.every((id) => selected.has(id));
                return (
                  <div key={gk} className="rounded-2xl border border-border/70 bg-card/60 overflow-hidden backdrop-blur-[2px]">
                    <button
                      type="button"
                      onClick={() => setExpandedGroup((cur) => (cur === gk ? null : gk))}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-secondary/40 transition-colors text-left"
                    >
                      <ChevronRight
                        className={`size-3.5 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
                      />
                      <MapPin className="size-3.5 text-muted-foreground shrink-0" />
                      <span className="text-[13px] font-medium truncate flex-1 tracking-tight">{grp.label}</span>
                      <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/80 tabular-nums">
                        {grp.items.length} {grp.items.length === 1 ? "guia" : "guias"}
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected((s) => {
                            const ns = new Set(s);
                            if (allInGroupSelected) groupIds.forEach((id) => ns.delete(id));
                            else groupIds.forEach((id) => ns.add(id));
                            return ns;
                          });
                        }}
                        className="text-[11px] text-accent hover:underline"
                      >
                        {allInGroupSelected ? "Desmarcar" : "Selecionar"}
                      </span>
                    </button>
                    {expanded && (
                      <ul className="divide-y divide-border/60 border-t border-border/60">
                        {grp.items.map((p) => {
                          const isSel = selected.has(p.id);
                          return (
                            <li
                              key={p.id}
                              className={`relative flex items-center gap-3 px-3 sm:px-4 py-2.5 transition-colors ${isSel ? "bg-accent/[0.06]" : "hover:bg-secondary/30"}`}
                            >
                              <Checkbox
                                checked={isSel}
                                onCheckedChange={(v) =>
                                  setSelected((s) => {
                                    const ns = new Set(s);
                                    if (v) ns.add(p.id);
                                    else ns.delete(p.id);
                                    return ns;
                                  })
                                }
                                className="shrink-0"
                              />
                              <button
                                type="button"
                                onClick={() => navigate({ to: "/admin/properties/$id", params: { id: p.id } })}
                                className="size-12 rounded-xl bg-secondary overflow-hidden shrink-0 ring-1 ring-border/60 hover:ring-foreground/30 transition"
                                aria-label={`Editar ${p.name}`}
                              >
                                {p.hero_image_url ? (
                                  <img src={p.hero_image_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <div className="w-full h-full grid place-items-center text-[9px] text-muted-foreground">Sem foto</div>
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => navigate({ to: "/admin/properties/$id", params: { id: p.id } })}
                                className="flex-1 min-w-0 text-left"
                              >
                                <h3 className="font-medium text-[13.5px] leading-snug tracking-tight line-clamp-2 [text-wrap:balance]">{p.name}</h3>
                                <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-muted-foreground/90 min-w-0">
                                  <span className="inline-flex items-center gap-1 shrink-0 uppercase tracking-[0.12em]">
                                    {p.access_mode === "pin" ? <Lock className="size-2.5" /> : <Globe className="size-2.5" />}
                                    {p.access_mode === "pin" ? "PIN" : "Público"}
                                  </span>
                                  {!p.published && (
                                    <>
                                      <span className="text-muted-foreground/40">·</span>
                                      <span className="uppercase tracking-[0.12em] text-yellow-600 dark:text-yellow-400">Rascunho</span>
                                    </>
                                  )}
                                </div>
                              </button>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="size-9 grid place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
                                    aria-label="Mais ações"
                                  >
                                    <MoreHorizontal className="size-4" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-52 p-1.5">
                                  <Link
                                    to="/admin/properties/$id"
                                    params={{ id: p.id }}
                                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-secondary transition-colors"
                                  >
                                    <Pencil className="size-3.5 text-muted-foreground" /> Editar guia
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={() => setViewSlug(p.slug)}
                                    className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-secondary transition-colors text-left"
                                  >
                                    <ExternalLink className="size-3.5 text-muted-foreground" /> Pré-visualizar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCopyLink(p.slug, p.id)}
                                    className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-secondary transition-colors text-left"
                                  >
                                    {copiedId === p.id ? <Check className="size-3.5 text-accent" /> : <Link2 className="size-3.5 text-muted-foreground" />}
                                    {copiedId === p.id ? "Link copiado" : "Copiar link público"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => { setDupTarget({ id: p.id, name: p.name }); setDupCopies(1); }}
                                    className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-secondary transition-colors text-left"
                                  >
                                    <Copy className="size-3.5 text-muted-foreground" /> Duplicar
                                  </button>
                                  <div className="my-1 h-px bg-border/70" />
                                  <button
                                    type="button"
                                    onClick={() => handleDelete(p.id, p.name)}
                                    className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-destructive hover:bg-destructive/10 transition-colors text-left"
                                  >
                                    <Trash2 className="size-3.5" /> Excluir
                                  </button>
                                </PopoverContent>
                              </Popover>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()
      )}

      <Dialog open={dupTarget !== null} onOpenChange={(o) => { if (!o && !dupBusy) { setDupTarget(null); setDupCopies(1); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicar guia</DialogTitle>
            <DialogDescription>
              Vamos criar cópias de <span className="font-medium text-foreground">{dupTarget?.name}</span> com todas as configurações, mídias, recomendações, FAQs e contatos. As cópias são criadas como <span className="font-medium">rascunhos</span> para você revisar antes de publicar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Quantas cópias?</label>
            <Input
              type="number"
              min={1}
              max={Math.max(1, remaining)}
              value={dupCopies}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isNaN(n)) setDupCopies(1);
                else setDupCopies(Math.max(1, Math.min(20, n)));
              }}
              disabled={dupBusy}
            />
            <p className="text-xs text-muted-foreground">
              {planLimit >= 9999
                ? "Seu plano não tem limite de guias."
                : `Você tem ${remaining} guia(s) disponíveis no plano ${planName}.`}
            </p>
            {planLimit < 9999 && dupCopies > remaining && (
              <p className="text-xs text-amber-500">
                Apenas {remaining} cópia(s) serão criadas — o restante excede o limite do plano.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDupTarget(null); setDupCopies(1); }} disabled={dupBusy}>
              Cancelar
            </Button>
            <Button onClick={handleConfirmDuplicate} disabled={dupBusy || remaining <= 0}>
              {dupBusy ? "Duplicando…" : "Duplicar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BulkEditDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        ids={Array.from(selected)}
        onSaved={() => {
          setSelected(new Set());
          refetch();
        }}
      />


      <Dialog open={viewSlug !== null} onOpenChange={(o) => { if (!o) closePreview(); }}>
        <DialogContent
          className={
            previewMode === "desktop"
              ? "p-0 gap-0 overflow-hidden border-0 bg-transparent shadow-none sm:max-w-[1100px] w-[min(95vw,1100px)] [&>button]:hidden"
              : previewMode === "mobile"
              ? "p-0 gap-0 overflow-hidden border-0 bg-transparent shadow-none sm:max-w-[400px] w-[min(92vw,400px)] [&>button]:hidden"
              : "p-0 gap-0 overflow-hidden sm:max-w-[420px] w-[min(92vw,420px)] [&>button]:hidden"
          }
        >
          <DialogTitle className="sr-only">Pré-visualização do guia</DialogTitle>
          {previewMode === null ? (
            <div className="p-6 bg-background">
              <div className="text-center mb-5">
                <h3 className="font-display text-xl">Como deseja visualizar?</h3>
                <p className="text-xs text-muted-foreground mt-1">Escolha como abrir o guia.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPreviewMode("mobile")}
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
                >
                  <div className="w-10 h-14 rounded-md border-2 border-foreground/70 group-hover:border-foreground transition-colors" />
                  <span className="text-sm font-medium">Mobile</span>
                  <span className="text-[11px] text-muted-foreground">Tela do celular</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode("desktop")}
                  className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
                >
                  <div className="w-14 h-10 rounded-md border-2 border-foreground/70 group-hover:border-foreground transition-colors" />
                  <span className="text-sm font-medium">Navegador</span>
                  <span className="text-[11px] text-muted-foreground">Tela ampla</span>
                </button>
              </div>
              <button
                type="button"
                onClick={closePreview}
                className="mt-5 w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <div className={`flex flex-col ${previewMode === "desktop" ? "h-[85vh] max-h-[820px] rounded-2xl" : "h-[85vh] max-h-[820px] rounded-[2rem]"} overflow-hidden bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/10`}>
              <div className="flex items-center justify-between gap-3 px-4 h-9 bg-background/95 backdrop-blur border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex size-1.5 rounded-full bg-emerald-500/80" />
                  <p className="text-[11px] font-medium text-muted-foreground/80 truncate">
                    /g/{viewSlug}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewMode(null)}
                    aria-label="Trocar modo"
                    className="h-6 px-2 inline-flex items-center rounded-full text-[10px] uppercase tracking-wider font-medium text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                  >
                    {previewMode === "mobile" ? "Mobile" : "Navegador"}
                  </button>
                  <a
                    href={`/g/${viewSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Abrir em nova aba"
                    className="size-6 grid place-items-center rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                  <button
                    type="button"
                    onClick={closePreview}
                    aria-label="Fechar"
                    className="size-6 grid place-items-center rounded-full text-muted-foreground/70 hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <span className="text-sm leading-none">×</span>
                  </button>
                </div>
              </div>
              <iframe
                src={`/g/${viewSlug}?preview=1`}
                title="Pré-visualização do guia"
                className="w-full flex-1 border-0 bg-background"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
