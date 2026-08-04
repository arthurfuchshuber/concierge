import { useMemo, useState } from "react";
import {
  ChevronRight,
  Crown,
  Eye,
  Filter,
  Lock,
  Pencil,
  Search,
  ShieldOff,
  Loader2,
  History,
  GitCompare,
  ListTree,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  comparePermissionSubjects,
  getPermissionWorkspace,
  getSubjectPermissions,
  listPermissionAudit,
  previewPermissionCascade,
  setSubjectPermissionLevel,
} from "@/lib/permissions.functions";

type Level = "NONE" | "READ" | "WRITE";

type NodeDTO = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  type: string;
  route: string | null;
  parentSlug: string | null;
  depth: number;
  hasChildren: boolean;
  feature: string | null;
};

const TYPE_LABEL: Record<string, string> = {
  PAGE: "Página",
  SUBPAGE: "Subpágina",
  TAB: "Aba",
  SECTION: "Seção",
  RESOURCE: "Recurso",
  FIELD: "Campo",
};

const LEVEL_META: Record<Level, { label: string; icon: typeof Eye; className: string }> = {
  NONE: { label: "Sem acesso", icon: ShieldOff, className: "bg-muted text-muted-foreground" },
  READ: { label: "Visualizar", icon: Eye, className: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  WRITE: { label: "Editar", icon: Pencil, className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
};

function LevelPicker({
  value,
  disabled,
  onChange,
}: {
  value: Level;
  disabled?: boolean;
  onChange: (level: Level) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg border bg-background/60 p-1">
      {(["NONE", "READ", "WRITE"] as Level[]).map((level) => {
        const meta = LEVEL_META[level];
        const Icon = meta.icon;
        const active = value === level;
        return (
          <button
            key={level}
            type="button"
            disabled={disabled}
            onClick={() => !active && onChange(level)}
            title={meta.label}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
              active ? meta.className : "text-muted-foreground hover:bg-muted",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function PermissionTreeManager({ context = "account" as "account" | "saas" }) {
  const qc = useQueryClient();
  const fetchWorkspace = useServerFn(getPermissionWorkspace);
  const fetchSubject = useServerFn(getSubjectPermissions);
  const fetchPreview = useServerFn(previewPermissionCascade);
  const saveLevel = useServerFn(setSubjectPermissionLevel);
  const fetchCompare = useServerFn(comparePermissionSubjects);
  const fetchAudit = useServerFn(listPermissionAudit);

  const [targetUserId, setTargetUserId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [onlyPages, setOnlyPages] = useState(false);
  const [onlyResources, setOnlyResources] = useState(false);
  const [onlyConfigured, setOnlyConfigured] = useState(false);
  const [onlyNone, setOnlyNone] = useState(false);
  const [compareWith, setCompareWith] = useState<string | null>(null);
  const [cascade, setCascade] = useState<{ slug: string; label: string; count: number } | null>(null);

  const workspace = useQuery({
    queryKey: ["permission-workspace", context],
    queryFn: () => fetchWorkspace({ data: { context } }),
  });

  const subjects = workspace.data?.subjects ?? [];
  const activeUserId = targetUserId ?? subjects[0]?.userId ?? null;
  const subject = subjects.find((s) => s.userId === activeUserId) ?? null;

  const permissions = useQuery({
    queryKey: ["permission-subject", context, activeUserId],
    enabled: !!activeUserId,
    queryFn: () => fetchSubject({ data: { context, targetUserId: activeUserId! } }),
  });

  const audit = useQuery({
    queryKey: ["permission-audit", context],
    queryFn: () => fetchAudit({ data: { context } }),
  });

  const comparison = useQuery({
    queryKey: ["permission-compare", context, activeUserId, compareWith],
    enabled: !!activeUserId && !!compareWith && compareWith !== activeUserId,
    queryFn: () => fetchCompare({ data: { context, userA: activeUserId!, userB: compareWith! } }),
  });

  const mutate = useMutation({
    mutationFn: (vars: { slug: string; level: Level }) =>
      saveLevel({ data: { context, targetUserId: activeUserId!, slug: vars.slug, level: vars.level } }),
    onSuccess: (res) => {
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ["permission-subject", context, activeUserId] });
      qc.invalidateQueries({ queryKey: ["permission-audit", context] });
      qc.invalidateQueries({ queryKey: ["permission-compare", context] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const nodes = (workspace.data?.nodes ?? []) as NodeDTO[];
  const isOwner = !!subject?.isOwner;
  const levels = permissions.data?.levels ?? {};

  const levelOf = (slug: string): Level => (isOwner ? "WRITE" : ((levels[slug] as Level) ?? "NONE"));

  const childrenBySlug = useMemo(() => {
    const map = new Map<string, NodeDTO[]>();
    for (const n of nodes) {
      const key = n.parentSlug ?? "__root";
      const list = map.get(key) ?? [];
      list.push(n);
      map.set(key, list);
    }
    return map;
  }, [nodes]);

  // BUSCA INTELIGENTE: casa slug, nome e rota; expande ancestrais automaticamente.
  const term = search.trim().toLowerCase();
  const { matched, autoExpanded } = useMemo(() => {
    if (!term) return { matched: null as Set<string> | null, autoExpanded: {} as Record<string, boolean> };
    const hits = nodes.filter(
      (n) =>
        n.label.toLowerCase().includes(term) ||
        n.slug.toLowerCase().includes(term) ||
        (n.route ?? "").toLowerCase().includes(term),
    );
    const keep = new Set<string>();
    const open: Record<string, boolean> = {};
    for (const hit of hits) {
      keep.add(hit.slug);
      const parts = hit.slug.split(".");
      for (let i = 1; i < parts.length; i += 1) {
        const ancestor = parts.slice(0, i).join(".");
        keep.add(ancestor);
        open[ancestor] = true;
      }
    }
    return { matched: keep, autoExpanded: open };
  }, [term, nodes]);

  const passesFilters = (node: NodeDTO): boolean => {
    if (matched && !matched.has(node.slug)) return false;
    if (onlyPages && !["PAGE", "SUBPAGE"].includes(node.type)) return false;
    if (onlyResources && !["RESOURCE", "FIELD", "SECTION"].includes(node.type)) return false;
    if (onlyConfigured && levelOf(node.slug) === "NONE") return false;
    if (onlyNone && levelOf(node.slug) !== "NONE") return false;
    return true;
  };

  const subtreeVisible = (node: NodeDTO): boolean => {
    if (passesFilters(node)) return true;
    return (childrenBySlug.get(node.slug) ?? []).some(subtreeVisible);
  };

  const isExpanded = (slug: string) => expanded[slug] ?? autoExpanded[slug] ?? false;

  const handleChange = async (node: NodeDTO, level: Level) => {
    if (isOwner || !activeUserId) return;
    if (level === "NONE") {
      const preview = await fetchPreview({ data: { context, targetUserId: activeUserId, slug: node.slug } });
      if (preview.count > 0) {
        setCascade({ slug: node.slug, label: node.label, count: preview.count });
        return;
      }
    }
    mutate.mutate({ slug: node.slug, level });
  };

  const renderNode = (node: NodeDTO) => {
    const level = levelOf(node.slug);
    const children = childrenBySlug.get(node.slug) ?? [];
    const open = isExpanded(node.slug);
    // VISIBILIDADE PROGRESSIVA: pai sem acesso não exibe filhos.
    const canShowChildren = level !== "NONE";
    return (
      <div key={node.slug}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border border-transparent px-2 py-2 hover:bg-muted/40",
            level !== "NONE" && "border-border/60 bg-muted/20",
          )}
          style={{ marginLeft: node.depth * 16 }}
        >
          <button
            type="button"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition",
              !node.hasChildren && "invisible",
            )}
            onClick={() => setExpanded((prev) => ({ ...prev, [node.slug]: !open }))}
            aria-label={open ? "Recolher" : "Expandir"}
          >
            <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{node.label}</span>
              <Badge variant="outline" className="h-5 shrink-0 text-[10px]">
                {TYPE_LABEL[node.type] ?? node.type}
              </Badge>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {node.route ?? node.slug}
            </p>
          </div>

          <LevelPicker value={level} disabled={isOwner || mutate.isPending} onChange={(l) => handleChange(node, l)} />
        </div>

        {open && node.hasChildren && !canShowChildren && (
          <p
            className="py-1 text-[11px] text-muted-foreground"
            style={{ marginLeft: (node.depth + 1) * 16 + 32 }}
          >
            Conceda ao menos "Visualizar" neste item para liberar a configuração dos itens internos.
          </p>
        )}

        {open && canShowChildren && children.filter(subtreeVisible).map(renderNode)}
      </div>
    );
  };

  const roots = (childrenBySlug.get("__root") ?? []).filter(subtreeVisible);
  const counts = permissions.data?.counts;

  if (workspace.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (workspace.isError) {
    return (
      <Card className="p-6 text-sm text-muted-foreground">
        {(workspace.error as Error)?.message ?? "Não foi possível carregar a árvore de permissões."}
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Usuários gerenciáveis */}
      <Card className="h-fit p-3">
        <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Usuários
        </p>
        <div className="space-y-1">
          {subjects.map((s) => (
            <button
              key={s.userId}
              type="button"
              onClick={() => setTargetUserId(s.userId)}
              className={cn(
                "w-full rounded-lg px-3 py-2 text-left transition",
                s.userId === activeUserId ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-muted/50",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{s.name}</span>
                {s.isOwner && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
              </div>
              <p className="truncate text-[11px] text-muted-foreground">{s.roleLabel}</p>
            </button>
          ))}
        </div>
        <div className="mt-3 rounded-lg bg-muted/40 p-2 text-[11px] text-muted-foreground">
          Plano do contrato: <strong>{workspace.data?.planLabel}</strong>. Módulos fora do plano não
          aparecem na árvore.
        </div>
      </Card>

      <div className="min-w-0 space-y-3">
        {/* Resumo do perfil */}
        <Card className="flex flex-wrap items-center gap-3 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{subject?.name ?? "—"}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {subject?.userType} {subject?.email ? `· ${subject.email}` : ""}
            </p>
          </div>
          {isOwner ? (
            <Badge className="gap-1 bg-amber-500/15 text-amber-600 dark:text-amber-300">
              <Lock className="h-3 w-3" /> Acesso total (OWNER)
            </Badge>
          ) : (
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <Badge variant="outline" className="gap-1">
                <Eye className="h-3 w-3" /> {counts?.read ?? 0} visualizar
              </Badge>
              <Badge variant="outline" className="gap-1">
                <Pencil className="h-3 w-3" /> {counts?.write ?? 0} editar
              </Badge>
              <Badge variant="outline" className="gap-1">
                <ShieldOff className="h-3 w-3" /> {counts?.none ?? 0} sem acesso
              </Badge>
            </div>
          )}
        </Card>

        {isOwner && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Usuários OWNER possuem acesso total aos recursos disponíveis no plano contratado. Suas
            permissões são gerenciadas automaticamente pelo sistema.
          </div>
        )}

        <Tabs defaultValue="tree">
          <TabsList>
            <TabsTrigger value="tree" className="gap-1">
              <ListTree className="h-4 w-4" /> Árvore
            </TabsTrigger>
            <TabsTrigger value="compare" className="gap-1">
              <GitCompare className="h-4 w-4" /> Comparar
            </TabsTrigger>
            <TabsTrigger value="audit" className="gap-1">
              <History className="h-4 w-4" /> Auditoria
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tree" className="mt-3 space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome, slug ou rota…"
                  className="pl-9"
                />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Filtros">
                    <Filter className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>Filtros</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={onlyPages} onCheckedChange={(v) => setOnlyPages(!!v)}>
                    Somente páginas
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={onlyResources}
                    onCheckedChange={(v) => setOnlyResources(!!v)}
                  >
                    Somente recursos
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={onlyConfigured}
                    onCheckedChange={(v) => setOnlyConfigured(!!v)}
                  >
                    Somente itens configurados
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={onlyNone} onCheckedChange={(v) => setOnlyNone(!!v)}>
                    Somente itens sem permissão
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Card className="p-2">
              {permissions.isLoading ? (
                <div className="space-y-2 p-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-3/4" />
                </div>
              ) : (
                <ScrollArea className="h-[520px] pr-2">
                  {roots.length ? (
                    <div className="space-y-1">{roots.map(renderNode)}</div>
                  ) : (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      Nenhum recurso encontrado com os filtros atuais.
                    </p>
                  )}
                </ScrollArea>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="compare" className="mt-3 space-y-3">
            <Select value={compareWith ?? ""} onValueChange={setCompareWith}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Comparar com…" />
              </SelectTrigger>
              <SelectContent>
                {subjects
                  .filter((s) => s.userId !== activeUserId)
                  .map((s) => (
                    <SelectItem key={s.userId} value={s.userId}>
                      {s.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>

            <Card className="p-3">
              {comparison.isFetching ? (
                <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-muted-foreground" />
              ) : comparison.data ? (
                comparison.data.differences.length ? (
                  <div className="space-y-1">
                    {comparison.data.differences.map((d) => (
                      <div
                        key={d.slug}
                        className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/40"
                      >
                        <span className="min-w-0 truncate">{d.label}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {LEVEL_META[d.levelA as Level].label} → {LEVEL_META[d.levelB as Level].label}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="p-4 text-center text-sm text-muted-foreground">
                    Os dois usuários possuem exatamente as mesmas permissões.
                  </p>
                )
              ) : (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  Selecione um usuário para comparar.
                </p>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="audit" className="mt-3">
            <Card className="p-3">
              <ScrollArea className="h-[420px] pr-2">
                <div className="space-y-1">
                  {(audit.data?.rows ?? []).map((row) => (
                    <div key={row.id} className="rounded-md px-2 py-1.5 text-xs hover:bg-muted/40">
                      <p className="font-medium">
                        {row.actorName ?? "Sistema"} alterou <strong>{row.slug ?? "—"}</strong> de{" "}
                        {LEVEL_META[(row.previous ?? "NONE") as Level].label} para{" "}
                        {LEVEL_META[(row.next ?? "NONE") as Level].label} em {row.targetName ?? "—"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(row.createdAt).toLocaleString("pt-BR")} · {row.action}
                      </p>
                    </div>
                  ))}
                  {!audit.data?.rows.length && (
                    <p className="p-4 text-center text-sm text-muted-foreground">
                      Nenhuma alteração registrada ainda.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <AlertDialog open={!!cascade} onOpenChange={(o) => !o && setCascade(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso em cascata?</AlertDialogTitle>
            <AlertDialogDescription>
              Ao remover o acesso de "{cascade?.label}", {cascade?.count} permissão(ões) de itens
              internos também serão removidas. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cascade) mutate.mutate({ slug: cascade.slug, level: "NONE" });
                setCascade(null);
              }}
            >
              Remover tudo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default PermissionTreeManager;
