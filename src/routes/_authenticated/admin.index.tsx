import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyProperties, deleteProperty } from "@/lib/properties.functions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Plus, ExternalLink, Pencil, Trash2, Lock, Globe, BookOpen, PlayCircle, CreditCard, LayoutGrid, List, Link2, Check, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { useSubscription } from "@/hooks/useSubscription";
import { PLANS } from "@/lib/payments.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: Dashboard,
});



function Dashboard() {
  const list = useServerFn(listMyProperties);
  const del = useServerFn(deleteProperty);
  const navigate = useNavigate();
  const [view, setView] = useState<"grid" | "list">("grid");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewSlug, setViewSlug] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop" | null>(null);

  function closePreview() {
    setViewSlug(null);
    setPreviewMode(null);
  }

  function getPublicBaseUrl() {
    if (typeof window === "undefined") return "";
    const { origin, hostname } = window.location;
    // Sandbox/preview hosts -> use stable published URL
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
    queryKey: ["my-properties"],
    queryFn: () => list(),
  });
  const { info: sub } = useSubscription();

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Excluir "${name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await del({ data: { id } });
      toast.success("Guia excluído");
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao excluir");
    }
  }

  const count = data?.length ?? 0;
  const planConfig = sub.plan ? PLANS[sub.plan] : null;
  const planName = planConfig?.name ?? "Sem plano";
  const planPrice = planConfig?.priceLabel ?? "—";
  const planLimit = sub.maxGuides;
  const remaining = Math.max(0, planLimit - count);
  const pct = planLimit > 0 ? Math.min(100, (count / planLimit) * 100) : 0;
  const reachedLimit = planLimit > 0 && count >= planLimit;


  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-7xl mx-auto w-full">
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl leading-tight">Bem-vindo de volta</h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            Aqui está o resumo do seu painel hoje.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/g/demo"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm px-4 py-2 rounded-full border border-border hover:bg-secondary transition-colors"
          >
            <PlayCircle className="size-4" /> Ver demo ao vivo
          </a>
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

        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {/* Plano */}
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-muted-foreground">Seu Plano</span>
            <CreditCard className="size-4 text-muted-foreground" />
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-serif">{planName}</span>
            {sub.isTrialing && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full">Trial</span>
            )}
            {sub.isPastDue && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">Pagamento falhou</span>
            )}
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-lg font-semibold">{planPrice}</span>
            {planConfig && <span className="text-xs text-muted-foreground">/mês</span>}
          </div>
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
          <div className="text-2xl font-serif">
            {count} <span className="text-sm text-muted-foreground font-sans">/ {planLimit || "—"}</span>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {planLimit > 0 ? `${remaining} guias restantes` : "Assine um plano para criar guias"}
          </p>
        </div>
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
      <div className="flex items-center justify-between mb-5">
        <h2 className="font-serif text-2xl">Seus guias</h2>
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
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
          <div className="size-12 rounded-2xl bg-accent/10 grid place-items-center mx-auto mb-4">
            <BookOpen className="size-5 text-accent" />
          </div>
          <h3 className="font-serif text-2xl mb-2">Crie seu primeiro guia</h3>
          <p className="text-sm text-muted-foreground mb-6 max-w-md mx-auto">
            Você só precisa do nome do imóvel e do link do Google Maps. Cuidamos do resto.
          </p>
          <Button onClick={() => navigate({ to: "/admin/properties/$id", params: { id: "new" } })} className="rounded-full">
            <Plus className="size-4 mr-1.5" /> Criar guia
          </Button>
        </div>
      ) : view === "grid" ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((p) => (
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
                <div className="flex items-center gap-2 mt-4">
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
                  <button onClick={() => handleDelete(p.id, p.name)} title="Excluir" className="p-2 rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive" aria-label="Excluir">
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden divide-y divide-border">
          {data.map((p) => (
            <div key={p.id} className="flex items-center gap-4 p-4 hover:bg-secondary/40 transition-colors">
              <div className="size-14 rounded-xl bg-secondary overflow-hidden shrink-0">
                {p.hero_image_url ? (
                  <img src={p.hero_image_url} alt={p.name} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold truncate">{p.name}</h3>
                  {!p.published && (
                    <span className="text-[10px] uppercase tracking-wider font-semibold bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 px-2 py-0.5 rounded-full">Rascunho</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{p.tagline || `${p.city ?? ""}${p.country ? `, ${p.country}` : ""}`}</p>
              </div>
              <span className="hidden sm:inline-flex glass rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider font-semibold items-center gap-1">
                {p.access_mode === "pin" ? <><Lock className="size-2.5" /> PIN</> : <><Globe className="size-2.5" /> Público</>}
              </span>
              <div className="flex items-center gap-1">
                <button onClick={() => handleCopyLink(p.slug, p.id)} className="size-8 grid place-items-center rounded-full hover:bg-secondary" aria-label="Copiar link público">
                  {copiedId === p.id ? <Check className="size-3.5 text-accent" /> : <Link2 className="size-3.5" />}
                </button>
                <Link to="/admin/properties/$id" params={{ id: p.id }} className="size-8 grid place-items-center rounded-full hover:bg-secondary" aria-label="Editar">
                  <Pencil className="size-3.5" />
                </Link>
                <button type="button" onClick={() => setViewSlug(p.slug)} className="size-8 grid place-items-center rounded-full hover:bg-secondary" aria-label="Ver">
                  <ExternalLink className="size-3.5" />
                </button>
                <button onClick={() => handleDelete(p.id, p.name)} className="size-8 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive" aria-label="Excluir">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
                <h3 className="font-serif text-xl">Como deseja visualizar?</h3>
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
                src={`/g/${viewSlug}`}
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
