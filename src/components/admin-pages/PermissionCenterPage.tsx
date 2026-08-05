import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft, Eye, Lock, Pencil, ShieldOff, Home } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { CreateUserDialog } from "@/components/permissions/CreateUserDialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  getPermissionCenterOverview,
  getPermissionCenterUser,
  grantPermissionCenterPermission,
  setPermissionCenterPropertyScope,
} from "@/lib/permission-center.functions";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_AREAS,
  SAAS_AREAS,
  type AreaGroup,
  type AreaItem,
} from "@/lib/permissions/permission.areas";

export type PermissionCenterContext = "account" | "saas";

type Level = "NONE" | "READ" | "WRITE";

/* --------------------------------------------------------------- estados */

function DeniedState({ reason }: { reason?: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">Você não tem permissão para gerenciar acessos</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {reason || "Solicite acesso ao titular da conta."}
      </p>
    </Card>
  );
}

function ErrorState({ message }: { message?: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <AlertTriangle className="h-8 w-8 text-destructive" />
      <p className="font-medium">Não foi possível carregar</p>
      <p className="max-w-md text-sm text-muted-foreground">{message || "Tente novamente."}</p>
    </Card>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}

/* ------------------------------------------------------- seletor 3 opções */

const OPTIONS: Array<{ value: Level; label: string; icon: typeof Eye; active: string }> = [
  { value: "NONE", label: "Sem acesso", icon: ShieldOff, active: "bg-muted text-foreground" },
  { value: "READ", label: "Visualizar", icon: Eye, active: "bg-sky-500/15 text-sky-600 dark:text-sky-300" },
  { value: "WRITE", label: "Editar", icon: Pencil, active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" },
];

function LevelSwitch({
  value,
  disabled,
  onChange,
}: {
  value: Level;
  disabled?: boolean;
  onChange: (v: Level) => void;
}) {
  return (
    <div className="inline-flex shrink-0 rounded-lg border bg-background p-0.5">
      {OPTIONS.map((o) => {
        const Icon = o.icon;
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => !on && onChange(o.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition",
              on ? o.active : "text-muted-foreground hover:text-foreground",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------- linhas e subgrupos */

type LevelMap = Map<string, { level: Level; inherited: boolean; assignmentId?: string }>;

/** Agrupa as atividades (depth 2) sob a aba correspondente (depth 1). */
function buildSubgroups(group: AreaGroup): Array<{ parent: AreaItem; children: AreaItem[] }> {
  const out: Array<{ parent: AreaItem; children: AreaItem[] }> = [];
  for (const item of group.items) {
    if (item.depth === 1) out.push({ parent: item, children: [] });
    else if (item.depth >= 2 && out.length > 0) out[out.length - 1].children.push(item);
  }
  return out;
}

function AreaRow({
  item,
  levels,
  isOwner,
  pending,
  onChange,
}: {
  item: AreaItem;
  levels: LevelMap;
  isOwner: boolean;
  pending: boolean;
  onChange: (v: Level) => void;
}) {
  const state = levels.get(item.namespace);
  const level: Level = isOwner ? "WRITE" : (state?.level ?? "NONE");
  return (
    <div
      className="flex items-center justify-between gap-3 py-3 pr-3"
      style={{ paddingLeft: 16 + item.depth * 20 }}
    >
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", item.depth === 0 && "font-semibold")}>{item.label}</p>
        {state?.inherited && !isOwner ? (
          <p className="text-xs text-muted-foreground">Herdado da área acima</p>
        ) : null}
      </div>
      <div className="shrink-0">
        <LevelSwitch value={level} disabled={isOwner || pending} onChange={onChange} />
      </div>
    </div>

  );
}

/* -------------------------------------------------------- acesso do usuário */


function UserAccess({
  userId,
  onBack,
  areas,
}: {
  userId: string;
  onBack: () => void;
  areas: AreaGroup[];
}) {
  const qc = useQueryClient();
  const fn = useServerFn(getPermissionCenterUser);
  const grant = useServerFn(grantPermissionCenterPermission);
  const setProperty = useServerFn(setPermissionCenterPropertyScope);
  const [showProperties, setShowProperties] = useState(false);

  const q = useQuery({
    queryKey: ["permission-center-user", userId],
    queryFn: () => fn({ data: { targetUserId: userId } }),
    retry: false,
  });

  const detail = q.data && q.data.allowed !== false ? q.data : null;

  const levels = useMemo(() => {
    const map = new Map<string, { level: Level; inherited: boolean; assignmentId?: string }>();
    if (!detail) return map;
    for (const i of detail.inherited) {
      map.set(i.namespace, { level: i.level as Level, inherited: true });
    }
    for (const d of detail.direct) {
      map.set(d.namespace, { level: d.level as Level, inherited: false, assignmentId: d.id });
    }
    return map;
  }, [detail]);

  const mutation = useMutation({
    mutationFn: async (input: { namespace: string; level: Level }) => {
      // `NONE` é uma negação explícita e precisa permanecer gravada para
      // prevalecer sobre permissões herdadas do papel do membro.
      return grant({
        data: {
          targetUserId: userId,
          namespace: input.namespace,
          level: input.level,
          scopeType: "TENANT" as const,
          scopeId: null,
        },
      });
    },
    onSuccess: (res) => {
      toast.success((res as { message?: string })?.message ?? "Acesso atualizado.");
      qc.invalidateQueries({ queryKey: ["permission-center-user", userId] });
      qc.invalidateQueries({ queryKey: ["permission-center-overview"] });
      qc.invalidateQueries({ queryKey: ["area-access"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível atualizar o acesso."),
  });

  /** Liberação em massa: aplica o mesmo nível a todas as áreas da categoria. */
  const bulkMutation = useMutation({
    mutationFn: async (input: { namespaces: string[]; level: Level }) => {
      for (const namespace of input.namespaces) {
        await grant({
          data: {
            targetUserId: userId,
            namespace,
            level: input.level,
            scopeType: "TENANT" as const,
            scopeId: null,
          },
        });
      }
      return input;
    },
    onSuccess: (input) => {
      const label = OPTIONS.find((o) => o.value === input.level)?.label ?? input.level;
      toast.success(`${input.namespaces.length} áreas atualizadas para "${label}".`);
      qc.invalidateQueries({ queryKey: ["permission-center-user", userId] });
      qc.invalidateQueries({ queryKey: ["permission-center-overview"] });
      qc.invalidateQueries({ queryKey: ["area-access"] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível atualizar as áreas."),
  });

  const propertyMutation = useMutation({
    mutationFn: (input: { propertyId: string; assigned: boolean }) =>
      setProperty({ data: { targetUserId: userId, ...input } }),
    onSuccess: (res) => {
      toast.success((res as { message?: string })?.message ?? "Residência atualizada.");
      qc.invalidateQueries({ queryKey: ["permission-center-user", userId] });
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível atualizar a residência."),
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!detail) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }

  const isOwner = detail.user.isOwner;

  /** Nível comum da categoria (quando todas as áreas estão iguais). */
  function groupLevel(group: AreaGroup): Level {
    if (isOwner) return "WRITE";
    const values = group.items.map((i) => levels.get(i.namespace)?.level ?? "NONE");
    return values.every((v) => v === values[0]) ? values[0] : "NONE";
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Button>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate font-medium">{detail.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{detail.user.email ?? "—"}</p>
        </div>
        <Badge variant="outline">{isOwner ? "Titular da conta" : detail.role}</Badge>
      </Card>

      {isOwner ? (
        <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
          O titular da conta tem acesso total e não pode ser limitado.
        </p>
      ) : null}

      <Accordion type="single" collapsible className="space-y-3">
        {areas.map((group) => (
          <AccordionItem
            key={group.namespace}
            value={group.namespace}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <div className="flex items-center gap-2 pr-3">
              <AccordionTrigger className="flex-1 px-4 py-3 text-sm font-semibold hover:no-underline">
                <span className="flex items-center gap-2">
                  {group.title}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                    {group.items.length}
                  </span>
                </span>
              </AccordionTrigger>
              {/* Liberação em massa da categoria inteira. */}
              <div className="shrink-0">
                <LevelSwitch
                  value={groupLevel(group)}
                  disabled={isOwner || bulkMutation.isPending || mutation.isPending}
                  onChange={(v) =>
                    bulkMutation.mutate({
                      namespaces: group.items.map((i) => i.namespace),
                      level: v,
                    })
                  }
                />
              </div>
            </div>
            <AccordionContent className="pb-0">
              <div className="border-t">
                {/* Subcategorias (abas) também expansivas, uma por vez. */}
                <Accordion type="single" collapsible>
                  {buildSubgroups(group).map((sub) => (
                    <AccordionItem key={sub.parent.namespace} value={sub.parent.namespace}>
                      <div className="flex items-center gap-2 pr-3">
                        <AccordionTrigger className="flex-1 py-2.5 pl-8 pr-2 text-sm hover:no-underline">

                          <span className="flex items-center gap-2 font-medium">
                            {sub.parent.label}
                            {sub.children.length > 0 ? (
                              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                                {sub.children.length}
                              </span>
                            ) : null}
                          </span>
                        </AccordionTrigger>
                        <LevelSwitch
                          value={
                            isOwner
                              ? "WRITE"
                              : (levels.get(sub.parent.namespace)?.level ?? "NONE")
                          }
                          disabled={isOwner || mutation.isPending || bulkMutation.isPending}
                          onChange={(v) =>
                            bulkMutation.mutate({
                              namespaces: [
                                sub.parent.namespace,
                                ...sub.children.map((c) => c.namespace),
                              ],
                              level: v,
                            })
                          }
                        />
                      </div>
                      <AccordionContent className="pb-0">
                        <div className="divide-y border-t bg-muted/20">
                          {sub.children.map((child) => (
                            <AreaRow
                              key={child.namespace}
                              item={child}
                              levels={levels}
                              isOwner={isOwner}
                              pending={mutation.isPending}
                              onChange={(v) =>
                                mutation.mutate({ namespace: child.namespace, level: v })
                              }
                            />
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </AccordionContent>

          </AccordionItem>
        ))}
      </Accordion>

      <Card className="p-4">
        <button
          type="button"
          onClick={() => setShowProperties((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Home className="h-4 w-4" /> Residências que esta pessoa atende
          </span>
          <span className="text-xs text-muted-foreground">
            {detail.properties.filter((p) => p.assigned).length} de {detail.properties.length}
          </span>
        </button>
        {showProperties ? (
          <div className="mt-3 divide-y rounded-lg border">
            {detail.properties.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma residência cadastrada.</p>
            ) : (
              detail.properties.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <span className="truncate text-sm">{p.name}</span>
                  <Switch
                    checked={p.assigned}
                    disabled={isOwner || propertyMutation.isPending}
                    onCheckedChange={(v) =>
                      propertyMutation.mutate({ propertyId: p.id, assigned: v })
                    }
                  />
                </div>
              ))
            )}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------- página */

export function PermissionCenterPage({
  context = "account",
}: {
  context?: PermissionCenterContext;
} = {}) {
  const areas = context === "saas" ? SAAS_AREAS : ACCOUNT_AREAS;
  const [selected, setSelected] = useState<string | null>(null);
  const fn = useServerFn(getPermissionCenterOverview);
  const q = useQuery({
    queryKey: ["permission-center-overview"],
    queryFn: () => fn(),
    retry: false,
  });

  if (selected)
    return <UserAccess userId={selected} onBack={() => setSelected(null)} areas={areas} />;
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">
            {context === "saas" ? "Quem tem acesso ao SaaS" : "Quem tem acesso à conta"}
          </p>
          <p className="text-sm text-muted-foreground">
            Escolha uma pessoa para definir, em cada área, se ela pode apenas visualizar ou também
            editar.
          </p>
        </div>
        <CreateUserDialog />
      </div>

      {q.data.users.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma pessoa nesta conta ainda.
        </p>
      ) : (
        <div className="grid gap-2">
          {q.data.users.map((u) => (
            <button
              key={u.userId}
              type="button"
              onClick={() => setSelected(u.userId)}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-muted/30"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{u.name}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email ?? "—"}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{u.isOwner ? "Titular" : (u.roles[0] ?? "Membro")}</Badge>
                <Badge variant={u.status === "active" ? "secondary" : "outline"}>
                  {u.status === "active" ? "Ativo" : u.status === "pending" ? "Pendente" : "Inativo"}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
