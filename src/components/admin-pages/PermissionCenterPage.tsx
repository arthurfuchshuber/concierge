import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  History,
  Layers,
  ListTree,
  Lock,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AccessBadge } from "@/components/permissions/AccessBadge";
import { PermissionTree } from "@/components/permissions/PermissionTree";
import { ScopeViewer } from "@/components/permissions/ScopeViewer";
import { UserPermissionSummary } from "@/components/permissions/UserPermissionSummary";
import {
  getPermissionCenterAudit,
  getPermissionCenterOverview,
  getPermissionCenterRegistry,
  getPermissionCenterScopes,
  getPermissionCenterUser,
} from "@/lib/permission-center.functions";

/* --------------------------------------------------------------- estados */

function DeniedState({ reason }: { reason?: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 p-10 text-center">
      <Lock className="h-8 w-8 text-muted-foreground" />
      <p className="font-medium">Você não tem permissão para acessar este centro</p>
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
      <p className="font-medium">Não foi possível carregar os dados</p>
      <p className="max-w-md text-sm text-muted-foreground">{message || "Tente novamente."}</p>
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{label}</p>;
}

function LoadingState() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

/* ------------------------------------------------------------- detalhes */

function UserDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const fn = useServerFn(getPermissionCenterUser);
  const q = useQuery({
    queryKey: ["permission-center-user", userId],
    queryFn: () => fn({ data: { targetUserId: userId } }),
    retry: false,
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }

  const detail = q.data;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Voltar para usuários
      </Button>

      <UserPermissionSummary data={detail.user} />

      <Card className="p-4">
        <p className="text-sm font-semibold">Permissões diretas</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Atribuições explícitas gravadas para este usuário.
        </p>
        {detail.direct.length === 0 ? (
          <EmptyState label="Nenhuma permissão direta atribuída." />
        ) : (
          <PermissionTree
            searchable={false}
            items={detail.direct.map((d) => ({
              namespace: d.namespace,
              label: d.label,
              level: d.level,
              origin: "direct" as const,
            }))}
          />
        )}
      </Card>

      <Card className="p-4">
        <p className="text-sm font-semibold">Permissões herdadas</p>
        <p className="mb-3 text-xs text-muted-foreground">
          Resolvidas pela hierarquia da árvore e pelos papéis do usuário.
        </p>
        {detail.inherited.length === 0 ? (
          <EmptyState label="Nenhuma permissão herdada." />
        ) : (
          <PermissionTree
            items={detail.inherited.map((d) => ({
              namespace: d.namespace,
              label: d.label,
              level: d.level,
              origin: "inherited" as const,
            }))}
          />
        )}
      </Card>

      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold">Escopos e imóveis autorizados</p>
        <ScopeViewer scopes={detail.scopes} properties={detail.properties} />
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------- seções */

function UsersSection({ onOpen }: { onOpen: (id: string) => void }) {
  const fn = useServerFn(getPermissionCenterOverview);
  const [term, setTerm] = useState("");
  const q = useQuery({
    queryKey: ["permission-center-overview"],
    queryFn: () => fn(),
    retry: false,
  });

  const users = useMemo(() => {
    if (!q.data || q.data.allowed === false) return [];
    const t = term.trim().toLowerCase();
    if (!t) return q.data.users;
    return q.data.users.filter(
      (u) => u.name.toLowerCase().includes(t) || (u.email ?? "").toLowerCase().includes(t),
    );
  }, [q.data, term]);

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Buscar por nome ou e-mail…"
          className="pl-9"
        />
      </div>

      {users.length === 0 ? (
        <EmptyState label="Nenhum usuário encontrado neste contexto." />
      ) : (
        <div className="grid gap-2">
          {users.map((u) => (
            <button
              key={u.userId}
              type="button"
              onClick={() => onOpen(u.userId)}
              className="rounded-xl border bg-card p-4 text-left transition hover:border-primary/40 hover:bg-muted/30"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{u.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email ?? "—"}</p>
                </div>
                <Badge variant={u.status === "active" ? "secondary" : "outline"}>
                  {u.status === "active" ? "Ativo" : u.status === "pending" ? "Pendente" : "Revogado"}
                </Badge>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {u.roles.map((r) => (
                  <Badge key={r} variant="outline" className="gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {r}
                  </Badge>
                ))}
                <span>· {u.tenantName}</span>
                <span>· {u.effectiveCount} permissões efetivas</span>
                <span>· {u.propertyCount} imóveis</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PermissionsSection() {
  const fn = useServerFn(getPermissionCenterRegistry);
  const q = useQuery({
    queryKey: ["permission-center-registry"],
    queryFn: () => fn(),
    retry: false,
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }
  if (!q.data.permissions.length) return <EmptyState label="Registry vazio." />;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="mb-3 text-sm font-semibold">Árvore do Permission Registry</p>
        <PermissionTree
          items={q.data.permissions.map((p) => ({
            namespace: p.namespace,
            label: p.label,
            description: p.description,
          }))}
        />
      </Card>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Namespace</th>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium">Domínio</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {q.data.permissions.map((p) => (
              <tr key={p.namespace} className="border-t">
                <td className="px-3 py-2 font-mono text-xs">{p.namespace}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.description ?? "—"}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.domain}</td>
                <td className="px-3 py-2">
                  <Badge variant={p.active ? "secondary" : "outline"}>
                    {p.active ? "Ativo" : "Inativo"}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function ScopesSection() {
  const fn = useServerFn(getPermissionCenterScopes);
  const q = useQuery({
    queryKey: ["permission-center-scopes"],
    queryFn: () => fn({ data: {} }),
    retry: false,
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }
  if (!q.data.scopes.length) return <EmptyState label="Nenhum escopo disponível." />;

  return <ScopeViewer scopes={q.data.scopes} properties={q.data.properties} />;
}

function AuditSection() {
  const fn = useServerFn(getPermissionCenterAudit);
  const q = useQuery({
    queryKey: ["permission-center-audit"],
    queryFn: () => fn(),
    retry: false,
  });

  if (q.isLoading) return <LoadingState />;
  if (q.isError) return <ErrorState message={(q.error as Error)?.message} />;
  if (!q.data || q.data.allowed === false) {
    return <DeniedState reason={q.data && "reason" in q.data ? q.data.reason : undefined} />;
  }
  if (!q.data.rows.length) return <EmptyState label="Nenhuma alteração registrada." />;

  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Data</th>
            <th className="px-3 py-2 font-medium">Autor</th>
            <th className="px-3 py-2 font-medium">Usuário</th>
            <th className="px-3 py-2 font-medium">Permissão</th>
            <th className="px-3 py-2 font-medium">Alteração</th>
          </tr>
        </thead>
        <tbody>
          {q.data.rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                {new Date(r.createdAt).toLocaleString("pt-BR")}
              </td>
              <td className="px-3 py-2">{r.actorName ?? "—"}</td>
              <td className="px-3 py-2">{r.targetName ?? "—"}</td>
              <td className="px-3 py-2 font-mono text-xs">{r.namespace ?? r.action}</td>
              <td className="px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <AccessBadge level={r.previous ?? "NONE"} showIcon={false} />
                  <span className="text-muted-foreground">→</span>
                  <AccessBadge level={r.next ?? "NONE"} showIcon={false} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ---------------------------------------------------------------- página */

export function PermissionCenterPage() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Administração
        </p>
        <h1 className="text-2xl font-semibold">Equipe e Permissões</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Centro administrativo de permissões — usuários, papéis, permissões efetivas, escopos e
          histórico de alterações.
        </p>
      </header>

      <Tabs defaultValue="usuarios">
        <div className="-mx-4 overflow-x-auto px-4">
          <TabsList className="w-max">
            <TabsTrigger value="usuarios" className="gap-1.5">
              <Users className="h-4 w-4" /> Usuários
            </TabsTrigger>
            <TabsTrigger value="permissoes" className="gap-1.5">
              <ListTree className="h-4 w-4" /> Permissões
            </TabsTrigger>
            <TabsTrigger value="escopos" className="gap-1.5">
              <Layers className="h-4 w-4" /> Escopos
            </TabsTrigger>
            <TabsTrigger value="historico" className="gap-1.5">
              <History className="h-4 w-4" /> Histórico
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="usuarios" className="mt-4">
          {selected ? (
            <UserDetail userId={selected} onBack={() => setSelected(null)} />
          ) : (
            <UsersSection onOpen={setSelected} />
          )}
        </TabsContent>
        <TabsContent value="permissoes" className="mt-4">
          <PermissionsSection />
        </TabsContent>
        <TabsContent value="escopos" className="mt-4">
          <ScopesSection />
        </TabsContent>
        <TabsContent value="historico" className="mt-4">
          <AuditSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
