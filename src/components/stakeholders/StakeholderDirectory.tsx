import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Plus,
  Search,
  Loader2,
  LayoutList,
  Columns3,
  Building2,
  Wrench,
  Mail,
  Phone,
  MapPin,
  Trash2,
  Pencil,
  Home,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { listStakeholders, deleteStakeholder } from "@/lib/stakeholders.functions";
import { StakeholderDetailSheet } from "./StakeholderDetailSheet";
import {
  StakeholderFormDialog,
  emptyStakeholderForm,
  rowToStakeholderForm,
  type StakeholderFormValues,
} from "./StakeholderFormDialog";
import { PROVIDER_CATEGORIES, type StakeholderKind } from "./constants";
import { statusLabel, statusChip, effectiveStatus } from "@/lib/stakeholder-status";
import { EmptyState } from "@/components/ds/EmptyState";
import { LoadingListState } from "@/components/ds/LoadingState";
import { useImpersonation } from "@/hooks/useImpersonation";

export { PROVIDER_CATEGORIES };
export type { StakeholderKind };

type Row = Record<string, any>;


export function StakeholderDirectory({ kind }: { kind: StakeholderKind }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStakeholders);
  const delFn = useServerFn(deleteStakeholder);
  const { impersonation } = useImpersonation();
  const activeAccountId = impersonation?.userId ?? null;

  const [view, setView] = useState<"list" | "kanban">("list");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<StakeholderFormValues>(emptyStakeholderForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [createdOwner, setCreatedOwner] = useState<{ id: string; name: string } | null>(null);


  const queryKey = ["stakeholders", activeAccountId ?? "self", kind];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { kind, accountOwnerId: activeAccountId } }),
    staleTime: 15_000,
  });

  // Tempo real: qualquer alteração no cadastro ou nas atividades recarrega a lista.
  useEffect(() => {
    const table = kind === "owner" ? "property_owners" : "service_providers";
    const channel = supabase
      .channel(`stakeholders-${kind}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, () => {
        qc.invalidateQueries({ queryKey });
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "stakeholder_activities" },
        () => qc.invalidateQueries({ queryKey }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Defesa adicional contra reidratação de uma chave antiga: resultados de
  // outra conta nunca são pintados, nem por um único frame.
  const belongsToActiveAccount = !activeAccountId || data?.accountId === activeAccountId;
  const rows: Row[] = belongsToActiveAccount ? (data?.rows ?? []) : [];
  const activities = belongsToActiveAccount ? (data?.activities ?? []) : [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && effectiveStatus(r.status, r.status_changed_at) !== status) return false;
      if (!term) return true;
      return [r.name, r.trade_name, r.email, r.phone, r.city, r.doc]
        .filter(Boolean)
        .some((v: string) => String(v).toLowerCase().includes(term));
    });
  }, [rows, q, status]);

  const pendingByStakeholder = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of activities) {
      if (a.status === "done") continue;
      map.set(a.stakeholder_id as string, (map.get(a.stakeholder_id as string) ?? 0) + 1);
    }
    return map;
  }, [activities]);

  function openNew() {
    setForm({ ...emptyStakeholderForm });
    setFormOpen(true);
  }

  function openEdit(row: Row) {
    setForm(rowToStakeholderForm(row));
    setFormOpen(true);
  }

  function afterSaved(id: string, isNew: boolean, saved: StakeholderFormValues) {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["property-owners-count"] });
    if (isNew && kind === "owner") {
      setCreatedOwner({ id, name: saved.trade_name || saved.name });
    }
  }


  async function remove(id: string) {
    try {
      await delFn({ data: { kind, id, accountOwnerId: activeAccountId } });
      toast.success("Cadastro removido.");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["property-owners-count"] });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const Icon = kind === "owner" ? Building2 : Wrench;
  const labelSingular = kind === "owner" ? "Proprietário" : "Prestador";

  const kanbanColumns: Array<{ key: string; label: string; test: (r: Row) => boolean }> = [
    {
      key: "pending",
      label: "Com pendências",
      test: (r) => (pendingByStakeholder.get(r.id) ?? 0) > 0,
    },
    {
      key: "ok",
      label: "Em dia",
      test: (r) => r.status === "active" && (pendingByStakeholder.get(r.id) ?? 0) === 0,
    },
    { key: "signature", label: "Assinatura", test: (r) => effectiveStatus(r.status, r.status_changed_at) === "signature" },
    { key: "contract", label: "Contrato", test: (r) => effectiveStatus(r.status, r.status_changed_at) === "contract" },
    {
      key: "documentation",
      label: "Documentação",
      test: (r) => effectiveStatus(r.status, r.status_changed_at) === "documentation",
    },
    { key: "paused", label: "Pausados", test: (r) => effectiveStatus(r.status, r.status_changed_at) === "paused" },
    { key: "canceling", label: "Cancelando", test: (r) => effectiveStatus(r.status, r.status_changed_at) === "canceling" },
    { key: "canceled", label: "Cancelados", test: (r) => effectiveStatus(r.status, r.status_changed_at) === "canceled" },
    { key: "inactive", label: "Inativos", test: (r) => effectiveStatus(r.status, r.status_changed_at) === "inactive" },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative flex-1 min-w-0 sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={`Buscar ${labelSingular.toLowerCase()}...`}
              className="pl-9 rounded-full"
            />
          </div>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-[140px] rounded-full shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="signature">Assinatura</SelectItem>
              <SelectItem value="contract">Contrato</SelectItem>
              <SelectItem value="documentation">Documentação</SelectItem>
              <SelectItem value="paused">Pausados</SelectItem>
              <SelectItem value="canceling">Cancelando</SelectItem>
              <SelectItem value="canceled">Cancelados</SelectItem>
              <SelectItem value="inactive">Inativos</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-full border border-border bg-card p-0.5">
            <button
              type="button"
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-colors ${view === "list" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <LayoutList className="size-3.5" /> Lista
            </button>
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={`px-3 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-colors ${view === "kanban" ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Columns3 className="size-3.5" /> Kanban
            </button>
          </div>
          <Button onClick={openNew} className="rounded-full">
            <Plus className="size-4 mr-1.5" /> Novo
          </Button>
        </div>
      </div>

      {isLoading ? (
        <LoadingListState count={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Icon}
          title={`Nenhum ${labelSingular.toLowerCase()} cadastrado`}
          description={q ? `Nenhum resultado para "${q}". Tente outro termo ou limpe os filtros.` : `Cadastre seu primeiro ${labelSingular.toLowerCase()} para começar.`}
          action={
            <Button onClick={openNew} variant="outline" className="rounded-full">
              <Plus className="size-4 mr-1.5" /> Cadastrar {labelSingular.toLowerCase()}
            </Button>
          }
        />
      ) : view === "list" ? (
        <div className="ds-list sm:grid sm:gap-1.5 sm:grid-cols-2 xl:grid-cols-3 sm:space-y-0">
          {filtered.map((r) => (
            <StakeholderCard
              key={r.id}
              row={r}
              kind={kind}
              pending={pendingByStakeholder.get(r.id) ?? 0}
              onOpen={() => setDetailId(r.id)}
              onEdit={() => openEdit(r)}
              onDelete={() => remove(r.id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {kanbanColumns.map((col) => {
            const items = filtered.filter(col.test);
            return (
              <div key={col.key} className="ds-surface border border-border bg-card/40 p-3">
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="ds-body">{col.label}</span>
                  <span className="ds-meta tabular-nums">{items.length}</span>
                </div>
                <div className="space-y-1.5">
                  {items.map((r) => (
                    <StakeholderCard
                      key={r.id}
                      row={r}
                      kind={kind}
                      compact
                      pending={pendingByStakeholder.get(r.id) ?? 0}
                      onOpen={() => setDetailId(r.id)}
                      onEdit={() => openEdit(r)}
                      onDelete={() => remove(r.id)}
                    />
                  ))}
                  {items.length === 0 && (
                    <p className="ds-meta px-1 py-6 text-center">Vazio</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      <StakeholderFormDialog
        kind={kind}
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={form}
        accountOwnerId={activeAccountId}
        onSaved={afterSaved}
      />

      {/* Próximo passo: criar a residência dentro do proprietário recém-criado */}
      <Dialog open={!!createdOwner} onOpenChange={(o) => !o && setCreatedOwner(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">Proprietário criado</DialogTitle>
            <DialogDescription>
              {createdOwner?.name} já está cadastrado. Quer criar a primeira residência dele agora?
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                const id = createdOwner?.id;
                setCreatedOwner(null);
                if (id) setDetailId(id);
              }}
            >
              Abrir ficha
            </Button>
            <Button asChild className="rounded-full">
              <Link
                to="/admin/properties/$id"
                params={{ id: "new" }}
                onClick={() => setCreatedOwner(null)}
              >
                <Home className="size-4 mr-1.5" /> Criar residência
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>


      {/* Detail */}
      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto p-0">
          {detailId && <StakeholderDetailSheet kind={kind} id={detailId} accountOwnerId={activeAccountId} onEdit={() => {
            const row = rows.find((r) => r.id === detailId);
            if (row) { setDetailId(null); openEdit(row); }
          }} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StakeholderCard({
  row,
  kind,
  pending,
  compact,
  onOpen,
  onEdit,
  onDelete,
}: {
  row: Row;
  kind: StakeholderKind;
  pending: number;
  compact?: boolean;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const categoryLabel =
    kind === "provider"
      ? PROVIDER_CATEGORIES.find((c) => c.value === row.category)?.label ?? "Outros"
      : null;
  const cityUf = [row.city, row.state].filter(Boolean).join("/");
  return (
    <div
      onClick={onOpen}
      className="group cursor-pointer ds-surface border border-border bg-card p-4 hover:border-primary/40 hover:shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.35)] transition-all"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <p className="ds-card-title truncate leading-tight min-w-0">{row.trade_name || row.name}</p>
        <div className="flex items-center gap-1 shrink-0">
          {pending > 0 && (
            <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] px-2 py-0.5 tabular-nums">
              {pending}
            </span>
          )}
          {categoryLabel && (
            <span className="rounded-full bg-accent/10 text-accent text-[10px] px-2 py-0.5 whitespace-nowrap">
              {categoryLabel}
            </span>
          )}
          <span className={`rounded-full text-[10px] px-2 py-0.5 whitespace-nowrap ${statusChip(effectiveStatus(row.status, row.status_changed_at))}`}>
            {statusLabel(effectiveStatus(row.status, row.status_changed_at))}
          </span>
        </div>
      </div>

      {!compact && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {row.email && (
            <div className="min-w-0">
              <p className="ds-eyebrow text-muted-foreground">Email</p>
              <p className="ds-body truncate mt-0.5 flex items-center gap-1.5">
                <Mail className="size-3 shrink-0 text-muted-foreground" /> {row.email}
              </p>
            </div>
          )}
          {row.phone && (
            <div className="min-w-0">
              <p className="ds-eyebrow text-muted-foreground">Telefone</p>
              <p className="ds-body truncate mt-0.5 flex items-center gap-1.5">
                <Phone className="size-3 shrink-0 text-muted-foreground" /> {row.phone}
              </p>
            </div>
          )}
          {cityUf && (
            <div className="min-w-0">
              <p className="ds-eyebrow text-muted-foreground">Cidade/UF</p>
              <p className="ds-body truncate mt-0.5 flex items-center gap-1.5">
                <MapPin className="size-3 shrink-0 text-muted-foreground" /> {cityUf}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="h-9 flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm font-medium hover:bg-secondary transition-colors"
        >
          <Pencil className="size-3.5" /> Editar
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="h-9 flex-1 inline-flex items-center justify-center gap-1.5 rounded-full border border-border text-sm font-medium hover:bg-secondary transition-colors"
        >
          Ver detalhes
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          aria-label="Excluir"
          title="Excluir"
          className="size-9 shrink-0 inline-flex items-center justify-center rounded-full border border-border hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
