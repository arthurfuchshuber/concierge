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
  getPermissionCenterOverview,
  getPermissionCenterUser,
  grantPermissionCenterPermission,
  revokePermissionCenterPermission,
  setPermissionCenterPropertyScope,
} from "@/lib/permission-center.functions";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ áreas */

type AreaItem = { namespace: string; label: string; hint?: string };
type AreaGroup = { title: string; items: AreaItem[] };

/**
 * Lista curta e em linguagem simples das áreas do produto.
 * Cada linha tem só três respostas possíveis: sem acesso, visualizar, editar.
 */
const AREAS: AreaGroup[] = [
  {
    title: "Operação",
    items: [
      { namespace: "tenant.dashboard", label: "Painel de Operação" },
      { namespace: "tenant.dashboard.kanban", label: "Esteira de chegadas (Kanban)" },
      { namespace: "tenant.dashboard.kanban.checkin", label: "Lista de check-ins" },
      { namespace: "tenant.dashboard.kanban.checkout", label: "Lista de check-outs" },
      { namespace: "tenant.dashboard.kanban.limpeza", label: "Lista de limpeza" },
    ],
  },
  {
    title: "Hóspedes e conversas",
    items: [
      { namespace: "tenant.conversas", label: "Atendimento e conversas" },
      { namespace: "tenant.stakeholders.hospedes", label: "Hóspedes" },
      { namespace: "tenant.engajamento", label: "Engajamento" },
    ],
  },
  {
    title: "Imóveis e guias",
    items: [
      { namespace: "tenant.imoveis", label: "Imóveis" },
      { namespace: "tenant.imoveis.editor", label: "Guia do imóvel" },
      { namespace: "tenant.imoveis.edicao-massa", label: "Edição em massa" },
      { namespace: "tenant.cidades", label: "Cidades e recomendações" },
    ],
  },
  {
    title: "Pessoas e parceiros",
    items: [
      { namespace: "tenant.stakeholders.proprietarios", label: "Proprietários" },
      { namespace: "tenant.stakeholders.prestadores", label: "Prestadores de serviço" },
      { namespace: "tenant.crm", label: "Clientes (CRM)" },
    ],
  },
  {
    title: "Inteligência",
    items: [
      { namespace: "tenant.ia", label: "IA Concierge" },
      { namespace: "tenant.inteligencia", label: "Inteligência e auditoria" },
    ],
  },
  {
    title: "Administrativo",
    items: [
      { namespace: "tenant.administrativo.assinatura", label: "Assinatura e pagamento" },
      { namespace: "tenant.administrativo.integracoes", label: "Integrações" },
      { namespace: "tenant.administrativo.equipe", label: "Equipe e permissões" },
      { namespace: "tenant.financeiro", label: "Financeiro" },
    ],
  },
];

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

/* -------------------------------------------------------- acesso do usuário */

function UserAccess({ userId, onBack }: { userId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const fn = useServerFn(getPermissionCenterUser);
  const grant = useServerFn(grantPermissionCenterPermission);
  const revoke = useServerFn(revokePermissionCenterPermission);
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
      const current = levels.get(input.namespace);
      if (input.level === "NONE") {
        if (!current?.assignmentId) return { message: "Nenhuma permissão direta para remover." };
        return revoke({ data: { targetUserId: userId, assignmentId: current.assignmentId } });
      }
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
    },
    onError: (e: Error) => toast.error(e.message || "Não foi possível atualizar o acesso."),
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

      {AREAS.map((group) => (
        <Card key={group.title} className="overflow-hidden p-0">
          <div className="border-b bg-muted/30 px-4 py-2.5">
            <p className="text-sm font-semibold">{group.title}</p>
          </div>
          <div className="divide-y">
            {group.items.map((item) => {
              const state = levels.get(item.namespace);
              const level: Level = isOwner ? "WRITE" : (state?.level ?? "NONE");
              return (
                <div
                  key={item.namespace}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.label}</p>
                    {state?.inherited && !isOwner ? (
                      <p className="text-xs text-muted-foreground">Vem do papel do usuário</p>
                    ) : null}
                  </div>
                  <LevelSwitch
                    value={level}
                    disabled={isOwner || mutation.isPending}
                    onChange={(v) => mutation.mutate({ namespace: item.namespace, level: v })}
                  />
                </div>
              );
            })}
          </div>
        </Card>
      ))}

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

export function PermissionCenterPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const fn = useServerFn(getPermissionCenterOverview);
  const q = useQuery({
    queryKey: ["permission-center-overview"],
    queryFn: () => fn(),
    retry: false,
  });

  if (selected) return <UserAccess userId={selected} onBack={() => setSelected(null)} />;
  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Quem tem acesso à conta</p>
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
