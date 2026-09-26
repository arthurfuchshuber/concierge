import { normText } from "@/lib/ai/fuzzy-match";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { CARD_OWNER, ownerLabel } from "@/components/dashboard/card-colors";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Compass, Home } from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { useServerFn as useServerFnGuias } from "@tanstack/react-start";
import { useQuery as useQueryGuias } from "@tanstack/react-query";
import { countPropertyOwners } from "@/lib/stakeholders.functions";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useGuidePreviewUrl } from "@/hooks/useGuidePreviewUrl";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listMyProperties,
  deleteProperty,
  duplicateProperty,
  listPropertiesForAccount,
  bulkUpdateProperties,
  countAccountGuides,
} from "@/lib/properties.functions";
import { useMyPermissions } from "@/hooks/useMyPermissions";
import { SITE_ORIGIN } from "@/lib/site-url";

import { WorkspaceHeader } from "@/components/ds/WorkspaceHeader";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import { EmptyState } from "@/components/ds/EmptyState";
import { LoadingState } from "@/components/ds/LoadingState";

import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogHeader,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Plus,
  ExternalLink,
  Pencil,
  Trash2,
  Lock,
  Globe,
  BookOpen,
  CreditCard,
  LayoutGrid,
  List,
  Link2,
  Check,
  AlertTriangle,
  MapPin,
  ChevronDown,
  ChevronRight,
  PenSquare,
  Search,
  X,
  Copy,
  Filter,
  MoreHorizontal,
  Columns2,
  Users,
} from "lucide-react";
import {
  FILTER_PANEL_CLASS,
  FILTER_PANEL_COLLISION,
  FILTER_PANEL_OFFSET,
  FilterCountBadge,
  FilterMenuRow,
  FilterMultiSelect,
  FilterOptionRow,
  FilterRootHeader,
  FilterScreenHeader,
} from "@/components/dashboard/filter-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useState, useMemo, useEffect } from "react";
import { PageShell } from "@/components/ds/PageShell";
import { StatCard } from "@/components/ds/StatCard";
import { GuideCard } from "@/components/guias/GuideCard";
import {
  ACTION_BUTTON_TONE,
  ACTION_ICON,
  ACTION_SEGMENT,
  CountPill,
  ACTION_BAR,
  PANEL_SHELL,
  PanelHeading,
  SectionLabel,
} from "@/components/dashboard/panel-chrome";
type StatusFilter = "all" | "published" | "draft";
type AccessFilter = "all" | "public" | "pin";
import { useSubscription } from "@/hooks/useSubscription";
import { PLANS } from "@/lib/payments.functions";
import { BulkEditDialog } from "@/components/BulkEditDialog";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { adminListUserPropertiesFull } from "@/lib/admin-subs.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { listMyAccounts } from "@/lib/active-account.functions";
import { useAccess } from "@/lib/permissions/useAccess";

import { Eye } from "lucide-react";

function coerceGuiaTab(v: unknown): "imoveis" | "destinos" {
  return v === "destinos" ? "destinos" : "imoveis";
}

function guideSearchScore(q: string, p: any): number {
  const qs = normText(q).split(" ").filter(Boolean);
  if (!qs.length) return 1;
  const fields: [unknown, number][] = [
    [p.name, 3], [p.ownerName, 2.5], [p.city, 1.5], [p.address, 1], [p.tagline, 1], [p.country, 0.5], [p.slug, 0.5],
  ];
  let total = 0;
  for (const t of qs) {
    let best = 0;
    for (const [f, w] of fields) {
      if (!f) continue;
      const words = normText(String(f)).split(" ").filter(Boolean);
      const hit = words.some((x) => x.startsWith(t) || (t.length >= 5 && near1(t, x.slice(0, t.length + 1)) ) );
      if (hit && w > best) best = w;
    }
    if (!best) return 0;
    total += best;
  }
  return total;
}
function near1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  // prefixo com até 1 edição
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return Math.min(...d[m]) <= 1;
}

export const Route = createFileRoute("/_authenticated/admin/guias")({
  validateSearch: (s: Record<string, unknown>): { tab?: "imoveis" | "destinos" } =>
    s.tab === "destinos" ? { tab: "destinos" } : {},
  component: GuiasTabs,
});

// Calculates a guide completeness score 0-100 based on filled fields.
// Uses only fields available in listMyProperties.
function guideCompleteness(p: {
  name?: string | null;
  tagline?: string | null;
  hero_image_url?: string | null;
  address?: string | null;
  city?: string | null;
  wifi_ssid?: string | null;
  checkin_time?: string | null;
  checkout_time?: string | null;
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

const GUIA_TABS = [
  { key: "imoveis", label: "Imóveis" },
  { key: "destinos", label: "Destinos" },
];

/* Destinos fora por enquanto (pedido explícito, 26/09/2026): a página
   mostra só os guias de imóveis. Os dados de destinos continuam guardados. */
function GuiasTabs() {
  return <Dashboard />;
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
  // Hierarquia: a instância mais próxima (membership na conta) prevalece sobre a
  // regra global de "admin SaaS = leitura". Se o admin também for membro ativo
  // desta conta, ele edita com as permissões que o titular concedeu.
  const accountsFn = useServerFn(listMyAccounts);
  const { data: myAccountsData, isLoading: myAccountsLoading } = useQuery({
    queryKey: ["my-accounts-membership"],
    queryFn: () => accountsFn(),
    staleTime: 60_000,
  });
  const isMemberOfImpersonated = !!(
    impersonation &&
    (myAccountsData?.accounts ?? []).some((a: { ownerId: string }) => a.ownerId === impersonation.userId)
  );
  // Read-only apenas quando um admin SaaS acessa um cliente do qual NÃO é membro.
  // Enquanto o vínculo ainda está carregando não mostramos nada (evita o aviso
  // piscando por milissegundos em contas onde o usuário pode editar).
  const readOnly =
    !myAccountsLoading && !!myAccountsData && !!impersonation && isSaasAdmin && !isMemberOfImpersonated;


  // Permissão de criação de guias — vale para a conta inteira.
  const createAccess = useAccess("tenant.guias.imoveis.criar", "criar");
  // Enquanto carrega, tratamos como "sem permissão" para nunca exibir UI de criação indevidamente.
  const canCreate = createAccess.loading ? false : createAccess.allowed;
  const NO_PERMISSION_MSG = "Você não tem permissão de acesso. Procure o administrador deste cadastro.";

  const [view, setView] = useState<"split" | "grid">("split");
  const [statCard, setStatCard] = useState<"published" | "draft" | "incomplete" | null>(null);
  const [statCardsOpen, setStatCardsOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [viewSlug, setViewSlug] = useState<string | null>(null);
  const viewPreviewUrl = useGuidePreviewUrl(viewSlug);
  const [previewMode, setPreviewMode] = useState<"mobile" | "desktop" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [ownerFilters, setOwnerFilters] = useState<string[]>([]);
  const [cityFilters, setCityFilters] = useState<string[]>([]);
  const [filterScreen, setFilterScreen] = useState<"root" | "status" | "access" | "owner" | "city">("root");
  useEffect(() => {
    const v = window.localStorage.getItem("guias-view");
    if (v === "split" || v === "grid") setView(v);
  }, []);
  function cycleView() {
    const next = view === "split" ? "grid" : "split";
    setView(next);
    window.localStorage.setItem("guias-view", next);
  }

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
      return SITE_ORIGIN;
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
  const qc = useQueryClient();
  const bulkUpdate = useServerFn(bulkUpdateProperties);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [bulkPubBusy, setBulkPubBusy] = useState(false);

  async function togglePublished(id: string, next: boolean) {
    setTogglingId(id);
    // Otimista: reflete imediatamente no cache antes da resposta.
    qc.setQueryData<any[]>(
      ["my-properties", impersonation?.userId ?? "self", isSaasAdmin ? "admin" : "member"],
      (rows) => (rows ?? []).map((r) => (r.id === id ? { ...r, published: next } : r)),
    );
    try {
      await bulkUpdate({ data: { ids: [id], patch: { published: next }, mode: "overwrite" } });
      qc.invalidateQueries({ queryKey: ["property", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar status");
      refetch();
    } finally {
      setTogglingId(null);
    }
  }

  async function bulkTogglePublished(next: boolean) {
    if (!selected.size) return;
    setBulkPubBusy(true);
    const ids = Array.from(selected);
    qc.setQueryData<any[]>(
      ["my-properties", impersonation?.userId ?? "self", isSaasAdmin ? "admin" : "member"],
      (rows) => (rows ?? []).map((r) => (ids.includes(r.id) ? { ...r, published: next } : r)),
    );
    try {
      await bulkUpdate({ data: { ids, patch: { published: next }, mode: "overwrite" } });
      toast.success(next ? `${ids.length} guia(s) publicado(s)` : `${ids.length} guia(s) despublicado(s)`);
      ids.forEach((id) => qc.invalidateQueries({ queryKey: ["property", id] }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao atualizar em massa");
      refetch();
    } finally {
      setBulkPubBusy(false);
    }
  }
  const { info: sub } = useSubscription({
    impersonateUserId: impersonation && isSaasAdmin ? impersonation.userId : null,
  });

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

  // Uso do plano é informação GLOBAL da conta: nunca depende de quantos
  // imóveis o usuário atual enxerga.
  const countGuidesFn = useServerFn(countAccountGuides);
  const { data: guidesCountData } = useQuery({
    queryKey: ["account-guides-count", impersonation?.userId ?? "self"],
    queryFn: () => countGuidesFn({ data: { ownerId: impersonation?.userId ?? null } }),
    staleTime: 30_000,
  });
  const count = guidesCountData?.count ?? data?.length ?? 0;
  // Dados de plano/assinatura só para o titular da conta (ou admin SaaS).
  const { isOwner } = useMyPermissions();
  const canSeePlan = isOwner || isSaasAdmin;

  const planConfig = sub.plan ? PLANS[sub.plan] : null;
  const planName = planConfig?.name ?? "Sem plano";
  const hasCustomPrice = sub.customPriceCents != null;
  const customCurrency = sub.customCurrency || "BRL";
  const planPrice = hasCustomPrice
    ? (sub.customPriceCents! / 100).toLocaleString("pt-BR", { style: "currency", currency: customCurrency })
    : (planConfig?.priceLabel ?? "—");
  const planLimit = sub.maxGuides;
  const remaining = Math.max(0, planLimit - count);
  const pct = planLimit > 0 ? Math.min(100, (count / planLimit) * 100) : 0;
  const reachedLimit = planLimit > 0 && count >= planLimit;
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : null;
  const renewalLabel = fmtDate(sub.currentPeriodEnd);
  const trialLabel = sub.isTrialing ? fmtDate(sub.trialEndsAt ?? sub.currentPeriodEnd) : null;

  // Só entram na aba Guias os imóveis que já têm um guia efetivamente criado
  // (guide_created) — um imóvel recém-cadastrado via "Criar nova residência"
  // (Stakeholders → Proprietários) fica de fora desta lista até alguém clicar
  // em "Criar guia" para ele. Ele continua existindo normalmente (dashboard,
  // calendário, kanban funcionam sem guia) — só não aparece aqui.
  const guideRows = useMemo(() => (data ?? []).filter((p: any) => !!p.guide_created), [data]);
  // Candidatos para o picker do "Novo guia": imóveis já cadastrados que ainda
  // não têm guia. "Novo guia" nunca cria um imóvel do zero — isso só acontece
  // em "Criar nova residência", dentro do proprietário em Stakeholders.
  const propertiesWithoutGuide = useMemo(() => (data ?? []).filter((p: any) => !p.guide_created), [data]);
  const [guidePickerOpen, setGuidePickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState("");
  const filteredPropertiesWithoutGuide = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return propertiesWithoutGuide;
    return propertiesWithoutGuide.filter((p: any) =>
      [p.name, p.address, p.city, p.country].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [propertiesWithoutGuide, pickerSearch]);

  function openGuidePicker() {
    if (!canCreate) {
      toast.error(NO_PERMISSION_MSG);
      return;
    }
    setPickerSearch("");
    setGuidePickerOpen(true);
  }

  const filtered = useMemo(() => {
    const q = search.trim();
    const rows = guideRows.filter((p) => {
      if (statusFilter === "published" && !p.published) return false;
      if (statusFilter === "draft" && p.published) return false;
      if (accessFilter !== "all" && p.access_mode !== accessFilter) return false;
      if (statCard === "published" && !p.published) return false;
      if (statCard === "draft" && p.published) return false;
      if (statCard === "incomplete" && guideCompleteness(p as any).score >= 90) return false;
      const own = (p as { ownerName?: string | null }).ownerName ?? "";
      if (ownerFilters.length > 0 && !ownerFilters.includes(own)) return false;
      if (cityFilters.length > 0 && !cityFilters.includes(p.city ?? "")) return false;
      if (!q) return true;
      return guideSearchScore(q, p) > 0;
    });
    if (q) {
      const sc = new Map(rows.map((r) => [r.id, guideSearchScore(q, r)]));
      return [...rows].sort((a, b) => (sc.get(b.id)! - sc.get(a.id)!) || 0);
    }
    // Ordem pedida: cidade → título do guia → proprietário (alfabética pt-BR).
    const cmp = (a: string, b: string) => a.localeCompare(b, "pt-BR", { sensitivity: "base", numeric: true });
    const txt = (v: unknown) => String(v ?? "").trim();
    return [...rows].sort((a, b) => {
      const ac = txt(a.city),
        bc = txt(b.city);
      // Guias sem cidade vão para o fim, mantendo a lista legível.
      if (!ac !== !bc) return ac ? -1 : 1;
      return (
        cmp(ac, bc) ||
        cmp(txt(a.name), txt(b.name)) ||
        cmp(txt((a as { ownerName?: string | null }).ownerName), txt((b as { ownerName?: string | null }).ownerName))
      );
    });
  }, [guideRows, search, statusFilter, accessFilter, ownerFilters, cityFilters, statCard]);
  const STAT_CARDS = [
    { key: "published" as const, label: "Publicados", icon: Globe },
    { key: "draft" as const, label: "Rascunhos", icon: PenSquare },
    { key: "incomplete" as const, label: "Parciais", icon: AlertTriangle },
  ];
  const statCounts = {
    published: guideRows.filter((p) => p.published).length,
    draft: guideRows.filter((p) => !p.published).length,
    incomplete: guideRows.filter((p) => guideCompleteness(p as any).score < 90).length,
  };
  const draftList = filtered.filter((p) => !p.published);
  const attentionList = filtered.filter((p) => p.published && guideCompleteness(p as any).score < 100);
  const readyList = filtered.filter((p) => p.published && guideCompleteness(p as any).score >= 100);
  const groupCount = [draftList, attentionList, readyList].filter((l) => l.length > 0).length;

  // Trava: nenhum guia pode ser criado sem um proprietário cadastrado em
  // Stakeholders → Proprietários (fonte da verdade das propriedades).
  const ownersCountFn = useServerFnGuias(countPropertyOwners);
  const ownersCount = useQueryGuias({
    queryKey: ["property-owners-count", impersonation?.userId ?? "self"],
    queryFn: async () => {
      try {
        return await ownersCountFn();
      } catch {
        return { count: 0 };
      }
    },
    staleTime: 30_000,
    retry: false,
  });
  // isSuccess (não só "tem data?") importa aqui: antes disso, ownersCount.data
  // é `undefined` e `?? 0` fazia noOwners virar `true` por um instante em
  // TODA carga da página — mesmo para conta com proprietário cadastrado —
  // porque a query ainda não tinha resolvido. Resultado: o aviso amarelo
  // piscava no topo por uns milissegundos e sumia assim que a contagem real
  // chegava. Só decidimos "sem proprietário" depois que a contagem realmente
  // veio.
  const noOwners = ownersCount.isSuccess && (ownersCount.data?.count ?? 0) === 0;

  const panelFiltersActive =
    statusFilter !== "all" || accessFilter !== "all" || ownerFilters.length > 0 || cityFilters.length > 0;
  const hasActiveFilters = search.trim() !== "" || panelFiltersActive;
  function clearFilters() {
    setSearch("");
    setStatusFilter("all");
    setAccessFilter("all");
    setOwnerFilters([]);
    setCityFilters([]);
    setStatCard(null);
  }
  const pageTitle = readOnly
    ? `Painel de ${impersonation?.name ?? ""}`
    : statCard === "published" || statusFilter === "published"
      ? "Guias Publicados"
      : statCard === "draft" || statusFilter === "draft"
        ? "Guias em Rascunho"
        : statCard === "incomplete"
          ? "Guias Incompletos"
          : "Todos os Guias";
  const pageSubtitle =
    guideRows.length === 0
      ? "Guias digitais dos seus imóveis."
      : filtered.length !== guideRows.length
        ? `${filtered.length} de ${guideRows.length} guias no filtro atual.`
        : `${guideRows.length} guias de imóveis · ${statCounts.published} publicados.`;
  const ownerOptions = useMemo(
    () =>
      Array.from(new Set(guideRows.map((p) => (p as { ownerName?: string | null }).ownerName ?? "").filter(Boolean))).sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [guideRows],
  );
  const cityOptions = useMemo(
    () => Array.from(new Set(guideRows.map((p) => p.city ?? "").filter(Boolean))).sort((a, b) => a.localeCompare(b, "pt-BR")),
    [guideRows],
  );
  const multiLabel = (arr: string[], all: string, many: string) =>
    arr.length === 0 ? all : arr.length === 1 ? arr[0] : `${arr.length} ${many}`;
  const statusLabel = statusFilter === "published" ? "Publicados" : statusFilter === "draft" ? "Rascunhos" : "Todos";
  const accessLabel = accessFilter === "public" ? "Público" : accessFilter === "pin" ? "PIN" : "Todos";

  return (
    <div className="ds-blocks w-full max-w-[1440px] px-3.5 py-5 sm:px-5 lg:px-8 lg:py-8">
      {readOnly && (
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Eye className="size-3.5 text-accent shrink-0" />
          <span className="flex-1 truncate">
            Painel de <span className="font-medium text-foreground">{impersonation?.name ?? "—"}</span>
          </span>
          <button
            type="button"
            onClick={() => {
              clearImpersonation();
              navigate({ to: "/admin/guias" });
            }}
            className="text-[11px] px-2.5 py-1 rounded-md border border-border bg-background/60 hover:bg-secondary"
          >
            Sair da visualização
          </button>
        </div>
      )}

      {noOwners && !readOnly && (
        <div className="mb-6 ds-surface border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm flex items-center gap-3">
          <AlertTriangle className="size-4 text-amber-500 shrink-0" />
          <span className="flex-1">
            Cadastre ao menos um proprietário em{" "}
            <Link
              to="/admin/stakeholders"
              search={{ tab: "proprietarios" as const }}
              className="underline underline-offset-2 font-medium"
            >
              Stakeholders → Proprietários
            </Link>{" "}
            para liberar a criação de novos guias.
          </span>
        </div>
      )}

      <PageShell
        title={pageTitle}
        subtitle={pageSubtitle}
      />


      <div className="ds-card-grid grid-cols-3">
        {STAT_CARDS.map((c) => (
          <StatCard
            key={c.key}
            label={c.label}
            value={statCounts[c.key]}
            icon={c.icon}
            loading={isLoading}
            size="sm"
            active={statCard === c.key}
            onClick={() => setStatCard(statCard === c.key ? null : c.key)}
          />
        ))}
      </div>

      <div className="flex flex-col gap-2">
      <div className={ACTION_BAR}>
          {selected.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
                  aria-label="Ações da seleção"
                  title="Ações da seleção"
                >
                  <PenSquare className={ACTION_ICON} />
                  <span className="lg:hidden">Ações</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  disabled={bulkPubBusy}
                  onSelect={() => bulkTogglePublished(true)}
                  className="text-xs font-normal"
                >
                  <Globe className={ACTION_ICON} /> Publicar
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={bulkPubBusy}
                  onSelect={() => bulkTogglePublished(false)}
                  className="text-xs font-normal"
                >
                  <Lock className={ACTION_ICON} /> Despublicar
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setBulkOpen(true)} className="text-xs font-normal">
                  <PenSquare className={ACTION_ICON} /> Editar
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {/* Visualização — alterna lista / lado a lado */}
          <button
            type="button"
            onClick={cycleView}
            aria-label={view === "split" ? "Ver em grade" : "Ver lado a lado"}
            title={view === "split" ? "Ver em grade" : "Ver lado a lado"}
            className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
          >
            {view === "split" ? <Columns2 className={ACTION_ICON} /> : <LayoutGrid className={ACTION_ICON} />}
            <span className="lg:hidden">{view === "split" ? "Lado a lado" : "Grade"}</span>
          </button>
          {!readOnly && canCreate && (
            <button
              type="button"
              onClick={openGuidePicker}
              disabled={reachedLimit || !sub.plan || noOwners}
              aria-label="Novo guia"
              title={
                !sub.plan
                  ? "Assine um plano para criar guias"
                  : noOwners
                    ? "Cadastre um proprietário em Stakeholders antes de criar guias"
                    : reachedLimit
                      ? "Limite do seu plano atingido. Faça upgrade."
                      : "Novo guia"
              }
              className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE} disabled:opacity-40`}
            >
              <Plus className={ACTION_ICON} />
              <span className="lg:hidden">Novo</span>
            </button>
          )}
          <Popover onOpenChange={(o) => !o && setFilterScreen("root")}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={`${ACTION_SEGMENT} ${ACTION_BUTTON_TONE}`}
                aria-label="Filtros"
                title="Filtros"
              >
                <Filter className={ACTION_ICON} />
                <span className="lg:hidden">Filtros</span>
                {panelFiltersActive && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" />}
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={FILTER_PANEL_OFFSET}
              collisionPadding={FILTER_PANEL_COLLISION}
              className={FILTER_PANEL_CLASS}
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              {filterScreen === "root" ? (
                <>
                  <FilterRootHeader canClear={panelFiltersActive} onClear={clearFilters} />
                  <FilterMenuRow icon={Globe} label="Situação" value={statusLabel} active={statusFilter !== "all"} onClick={() => setFilterScreen("status")} />
                  <FilterMenuRow icon={Lock} label="Acesso" value={accessLabel} active={accessFilter !== "all"} onClick={() => setFilterScreen("access")} />
                  <FilterMenuRow icon={Users} label="Proprietário" value={multiLabel(ownerFilters, "Todos", "selecionados")} active={ownerFilters.length > 0} onClick={() => setFilterScreen("owner")} />
                  <FilterMenuRow icon={MapPin} label="Cidade" value={multiLabel(cityFilters, "Todas", "selecionadas")} active={cityFilters.length > 0} onClick={() => setFilterScreen("city")} last />
                </>
              ) : null}
              {filterScreen === "status" ? (
                <>
                  <FilterScreenHeader icon={Globe} title="Situação" onBack={() => setFilterScreen("root")} />
                  {([
                    { v: "all", label: "Todos" },
                    { v: "published", label: "Publicados" },
                    { v: "draft", label: "Rascunhos" },
                  ] as { v: StatusFilter; label: string }[]).map((o, i, arr) => (
                    <FilterOptionRow key={o.v} label={o.label} selected={statusFilter === o.v} onClick={() => setStatusFilter(o.v)} last={i === arr.length - 1} />
                  ))}
                </>
              ) : null}
              {filterScreen === "access" ? (
                <>
                  <FilterScreenHeader icon={Lock} title="Acesso" onBack={() => setFilterScreen("root")} />
                  {([
                    { v: "all", label: "Todos" },
                    { v: "public", label: "Público" },
                    { v: "pin", label: "PIN" },
                  ] as { v: AccessFilter; label: string }[]).map((o, i, arr) => (
                    <FilterOptionRow key={o.v} label={o.label} selected={accessFilter === o.v} onClick={() => setAccessFilter(o.v)} last={i === arr.length - 1} />
                  ))}
                </>
              ) : null}
              {filterScreen === "owner" ? (
                <>
                  <FilterScreenHeader icon={Users} title="Proprietário" onBack={() => setFilterScreen("root")} right={<FilterCountBadge count={ownerFilters.length} />} />
                  <FilterMultiSelect options={ownerOptions.map((o) => ({ value: o, label: o }))} selected={ownerFilters} onChange={setOwnerFilters} searchPlaceholder="Buscar proprietário..." />
                </>
              ) : null}
              {filterScreen === "city" ? (
                <>
                  <FilterScreenHeader icon={MapPin} title="Cidade" onBack={() => setFilterScreen("root")} right={<FilterCountBadge count={cityFilters.length} />} />
                  <FilterMultiSelect options={cityOptions.map((o) => ({ value: o, label: o }))} selected={cityFilters} onChange={setCityFilters} searchPlaceholder="Buscar cidade..." />
                </>
              ) : null}
            </PopoverContent>
          </Popover>
      </div>

      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, proprietário, cidade…"
          className={`${PANEL_SHELL} h-[var(--ds-action-h)] lg:h-[var(--ds-action-h-lg)] w-full pl-9 pr-9 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none`}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 z-10 -translate-y-1/2 size-6 grid place-items-center text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      </div>


      {isLoading ? (
        <LoadingState count={3} />
      ) : !guideRows.length ? (
        !canCreate || readOnly ? (
          <EmptyState
            icon={Home}
            title="Nenhum guia disponível"
            description="Não há guias vinculados ao seu acesso nesta conta."
          />
        ) : (
          <div className="ds-surface border border-accent/20 bg-card p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-accent font-semibold mb-1">
                  Primeiros passos
                </p>
                <h3 className="ds-section-title">Crie seu primeiro guia em minutos</h3>
              </div>
              <div className="text-right">
                <span className="text-2xl font-display text-accent">01</span>
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">/ 05</p>
              </div>
            </div>
            <div className="space-y-3">
              {(
                [
                  { n: "01", label: "Cole o link do Google Maps da sua propriedade", done: false },
                  { n: "02", label: "Confira o endereço e adicione Wi-Fi", done: false },
                  { n: "03", label: "Configure os horários de check-in e check-out", done: false },
                  { n: "04", label: "Adicione recomendações de restaurantes e atrações", done: false },
                  { n: "05", label: "Publique e compartilhe o link com o hóspede", done: false },
                ] as { n: string; label: string; done: boolean }[]
              ).map((step) => (
                <div key={step.n} className="flex items-center gap-3">
                  <span className="size-7 rounded-full border border-border text-[10px] font-mono text-muted-foreground grid place-items-center shrink-0">
                    {step.n}
                  </span>
                  <span className="text-[13.5px] text-foreground/80">{step.label}</span>
                </div>
              ))}
            </div>
            <Button
              className="mt-5 rounded-full"
              onClick={openGuidePicker}
              disabled={!sub.plan || noOwners}
              title={
                !sub.plan
                  ? "Assine um plano para criar guias"
                  : noOwners
                    ? "Cadastre um proprietário em Stakeholders antes de criar guias"
                    : undefined
              }
            >
              <Plus className="size-4 mr-1.5" /> Criar meu primeiro guia
            </Button>
          </div>
        )
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nenhum guia encontrado"
          description="Tente ajustar a busca ou limpar os filtros."
          action={
            <Button variant="outline" onClick={clearFilters} className="rounded-full">
              Limpar filtros
            </Button>
          }
        />
            ) : (
        <div className={`ds-blocks ${groupCount > 1 ? "lg:grid lg:grid-cols-2 lg:items-start lg:gap-2.5 lg:space-y-0" : ""}`}>
          {[
            { key: "draft", title: "Não publicado", items: draftList, color: "#d8b96a", Icon: PenSquare },
            { key: "att", title: "Precisam de atenção", items: attentionList, color: "#c98c8c", Icon: AlertTriangle },
            { key: "ok", title: "Prontos", items: readyList, color: "#7fb79a", Icon: Check },
          ]
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <section key={g.key} aria-label={g.title} className={`${PANEL_SHELL} relative min-w-0 px-2.5 pb-2.5 pt-3`}>
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 top-0 h-[2px] rounded-b-[3px]"
                  style={{ background: `linear-gradient(to right, ${g.color}, transparent)` }}
                />
                <div className="space-y-1.5">
                  <PanelHeading
                    title={g.title}
                    dot={
                      <span className="flex shrink-0 items-center gap-2.5">
                      <span
                        className="grid size-[22px] shrink-0 place-items-center rounded-md"
                        style={{ background: `color-mix(in oklab, ${g.color} 12%, transparent)`, color: g.color }}
                      >
                        <g.Icon className="size-[13px]" strokeWidth={2.2} />
                      </span>
                      </span>
                    }
                    right={
                      <CountPill>
                        {g.items.length} {g.items.length === 1 ? "Guia" : "Guias"}
                      </CountPill>
                    }
                    className="mb-1"
                  />
                  <div className={`ds-five-cap grid gap-3 ${view === "grid" ? "sm:grid-cols-2" : ""}`} style={{ marginLeft: -2, marginRight: -13 }}>
                    {g.items.map((p) => {
                      const c = guideCompleteness(p as any);
                      return (
                        <GuideCard
                          key={p.id}
                          p={p as any}
                          variant={view}
                          score={c.score}
                          barClass={c.score >= 90 ? "bg-[#7fb79a]" : c.score >= 60 ? "bg-[#d8b96a]" : "bg-[#c98c8c]"}
                          toggling={togglingId === p.id}
                          onTogglePublished={(v) => togglePublished(p.id, v)}
                          selected={selected.has(p.id)}
                          onSelectChange={
                            !readOnly
                              ? (v) =>
                                  setSelected((cur) => {
                                    const n = new Set(cur);
                                    if (v) n.add(p.id);
                                    else n.delete(p.id);
                                    return n;
                                  })
                              : undefined
                          }
                          actions={
                            <>
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        title="Mais opções"
                        aria-label="Mais opções"
                        className="size-7 inline-flex items-center justify-center rounded-full hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
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
                        {copiedId === p.id ? (
                          <Check className="size-3.5 text-accent" />
                        ) : (
                          <Link2 className="size-3.5 text-muted-foreground" />
                        )}
                        {copiedId === p.id ? "Link copiado" : "Copiar link público"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDupTarget({ id: p.id, name: p.name });
                          setDupCopies(1);
                        }}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] hover:bg-secondary transition-colors text-left"
                      >
                        <Copy className="size-3.5 text-muted-foreground" /> Duplicar
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                        className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-destructive hover:bg-destructive/10 transition-colors text-left"
                      >
                        <Trash2 className="size-3.5" /> Excluir guia
                      </button>
                    </PopoverContent>
                  </Popover>

                            </>
                          }
                        />
                      );
                    })}
                  </div>
                </div>
              </section>
            ))}
        </div>

      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir guia?</AlertDialogTitle>
            <AlertDialogDescription>
              Isso removerá permanentemente "{deleteTarget?.name}" e não poderá ser desfeito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && handleDelete(deleteTarget.id, deleteTarget.name)}
              className="border border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25"
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* "Novo guia" nunca cria um imóvel novo — só vincula um guia a um
          imóvel já cadastrado (via "Criar nova residência", em Stakeholders)
          que ainda não tem guia. */}
      <Dialog open={guidePickerOpen} onOpenChange={setGuidePickerOpen}>
        {/* rounded-lg (8px) — mesmo raio de "diálogo de formulário" (ds-form-dialog,
            usado em StakeholderFormDialog) em vez do balão rounded-3xl padrão do
            componente Dialog. Só o raio do próprio diálogo é ajustado aqui — os
            cards da lista e a busca já seguem, cada um, seu próprio padrão
            estabelecido (ds-surface nos cards, cantos retos na busca). */}
        <DialogContent
          className="max-w-md rounded-lg"
          // Sem subtítulo (economiza altura) e sem autofoco no campo de busca —
          // abrir o diálogo já puxando o teclado no mobile atrapalha a
          // visualização da lista.
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>Novo guia</DialogTitle>
          </DialogHeader>
          {/* Mesmo padrão da barra de busca da página (cantos retos, fundo
              secondary/50, 36px de altura) — sempre visível, igual à barra
              de ações da própria tela de Guias. */}
          <div className="relative">
            <Search className="size-3.5 opacity-60 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={pickerSearch}
              onChange={(e) => setPickerSearch(e.target.value)}
              placeholder="Buscar por nome, endereço, cidade…"
              className="h-9 w-full box-border rounded-none border-0 bg-secondary/50 pl-9 pr-8 text-xs font-normal leading-none text-foreground/80 placeholder:text-muted-foreground focus:outline-none focus:bg-secondary transition-colors"
            />
            {pickerSearch && (
              <button
                type="button"
                onClick={() => setPickerSearch("")}
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 size-6 grid place-items-center rounded-none text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {propertiesWithoutGuide.length === 0 ? (
            <EmptyState
              icon={Home}
              title="Nenhuma residência sem guia"
              description={
                "Todas as residências já têm guia. Para cadastrar uma residência nova, use “Criar nova residência” dentro do proprietário, em Stakeholders."
              }
              action={
                <Button variant="outline" asChild onClick={() => setGuidePickerOpen(false)}>
                  <Link to="/admin/stakeholders" search={{ tab: "proprietarios" as const }}>
                    Ir para Stakeholders
                  </Link>
                </Button>
              }
            />
          ) : filteredPropertiesWithoutGuide.length === 0 ? (
            <EmptyState
              icon={Search}
              title="Nenhuma residência encontrada"
              description={`Nenhum resultado para "${pickerSearch}". Tente outro termo.`}
              action={
                <Button variant="outline" onClick={() => setPickerSearch("")}>
                  Limpar busca
                </Button>
              }
            />
          ) : (
            <div className="max-h-80 overflow-y-auto -mx-1 px-1 space-y-1.5">
              {filteredPropertiesWithoutGuide.map((p: any) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setGuidePickerOpen(false);
                    navigate({ to: "/admin/properties/$id", params: { id: p.id } });
                  }}
                  className="w-full flex items-center gap-3 ds-surface border border-border bg-card px-3 py-2.5 text-left hover:border-foreground/30 hover:bg-secondary/40 transition-colors"
                >
                  <div className="size-9 rounded-[0.3rem] bg-secondary overflow-hidden shrink-0">
                    {p.hero_image_url ? (
                      <img src={p.hero_image_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-muted-foreground">
                        <Home className="size-4" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium truncate">{p.name}</p>
                    <p className="ds-meta truncate">
                      {[p.city, p.country].filter(Boolean).join(", ") || "Sem localização"}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={dupTarget !== null}
        onOpenChange={(o) => {
          if (!o && !dupBusy) {
            setDupTarget(null);
            setDupCopies(1);
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicar guia</DialogTitle>
            <DialogDescription>
              Vamos criar cópias de <span className="font-medium text-foreground">{dupTarget?.name}</span> com todas as
              configurações, mídias, recomendações, FAQs e contatos. As cópias são criadas como{" "}
              <span className="font-medium">rascunhos</span> para você revisar antes de publicar.
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
            <Button
              variant="outline"
              onClick={() => {
                setDupTarget(null);
                setDupCopies(1);
              }}
              disabled={dupBusy}
            >
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
          refetch();
        }}
      />

      <Dialog
        open={viewSlug !== null}
        onOpenChange={(o) => {
          if (!o) closePreview();
        }}
      >
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
                <h3 className="ds-section-title">Como deseja visualizar?</h3>
                <p className="text-xs text-muted-foreground mt-1">Escolha como abrir o guia.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setPreviewMode("mobile")}
                  className="group flex flex-col items-center gap-2 ds-surface border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
                >
                  <div className="w-10 h-14 rounded-md border-2 border-foreground/70 group-hover:border-foreground transition-colors" />
                  <span className="text-sm font-medium">Mobile</span>
                  <span className="text-[11px] text-muted-foreground">Tela do celular</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode("desktop")}
                  className="group flex flex-col items-center gap-2 ds-surface border border-border bg-card hover:border-foreground/40 hover:bg-secondary/40 transition-colors p-5"
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
            <div
              className={`flex flex-col ${previewMode === "desktop" ? "h-[85vh] max-h-[820px] ds-surface" : "h-[85vh] max-h-[820px] rounded-[2rem]"} overflow-hidden bg-background shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] ring-1 ring-black/10`}
            >
              <div className="flex items-center justify-between gap-3 px-4 h-9 bg-background/95 backdrop-blur border-b border-border/40 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex size-1.5 rounded-full bg-emerald-500/80" />
                  <p className="text-[11px] font-medium text-muted-foreground/80 truncate">/g/{viewSlug}</p>
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
                    href={viewPreviewUrl ?? `/g/${viewSlug}`}
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
                src={viewPreviewUrl ?? "about:blank"}
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
