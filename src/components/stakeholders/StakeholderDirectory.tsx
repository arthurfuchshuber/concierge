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

export { PROVIDER_CATEGORIES };
export type { StakeholderKind };

type Row = Record<string, any>;


export function StakeholderDirectory({ kind }: { kind: StakeholderKind }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listStakeholders);
  const saveFn = useServerFn(saveStakeholder);
  const delFn = useServerFn(deleteStakeholder);

  const [view, setView] = useState<"list" | "kanban">("list");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const queryKey = ["stakeholders", kind];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => listFn({ data: { kind } }),
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

  const rows: Row[] = data?.rows ?? [];
  const activities = data?.activities ?? [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
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
    setForm({ ...emptyForm });
    setFormOpen(true);
  }

  function openEdit(row: Row) {
    setForm({
      id: row.id,
      name: row.name ?? "",
      trade_name: row.trade_name ?? "",
      category: row.category ?? "outros",
      doc_type: (row.doc_type as "cpf" | "cnpj") ?? "cpf",
      doc: row.doc ?? "",
      email: row.email ?? "",
      phone: row.phone ?? "",
      address: row.address ?? "",
      city: row.city ?? "",
      state: row.state ?? "",
      notes: row.notes ?? "",
      status: (row.status as "active" | "inactive") ?? "active",
    });
    setFormOpen(true);
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.error("Informe o nome.");
      return;
    }
    setSaving(true);
    try {
      await saveFn({ data: { ...form, kind, id: form.id ?? undefined } });
      toast.success(form.id ? "Cadastro atualizado." : "Cadastro criado.");
      setFormOpen(false);
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["property-owners-count"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    try {
      await delFn({ data: { kind, id } });
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
    { key: "inactive", label: "Inativos", test: (r) => r.status === "inactive" },
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
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-16 justify-center">
          <Loader2 className="size-4 animate-spin" /> Carregando...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 py-16 text-center">
          <Icon className="size-8 mx-auto text-muted-foreground/60 mb-3" />
          <p className="text-sm text-muted-foreground">
            Nenhum {labelSingular.toLowerCase()} cadastrado ainda.
          </p>
          <Button onClick={openNew} variant="outline" className="rounded-full mt-4">
            <Plus className="size-4 mr-1.5" /> Cadastrar {labelSingular.toLowerCase()}
          </Button>
        </div>
      ) : view === "list" ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              <div key={col.key} className="rounded-2xl border border-border bg-card/40 p-3">
                <div className="flex items-center justify-between mb-3 px-1">
                  <span className="text-xs font-medium text-foreground/80">{col.label}</span>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                <div className="space-y-2.5">
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
                    <p className="text-[11px] text-muted-foreground px-1 py-6 text-center">Vazio</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-2xl">
              {form.id ? `Editar ${labelSingular.toLowerCase()}` : `Novo ${labelSingular.toLowerCase()}`}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2 max-h-[65vh] overflow-y-auto pr-1">
            <div className="sm:col-span-2">
              <Label>Nome completo *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <Label>Nome fantasia</Label>
              <Input
                value={form.trade_name}
                onChange={(e) => setForm({ ...form, trade_name: e.target.value })}
              />
            </div>
            {kind === "provider" ? (
              <div>
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDER_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Situação</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as "active" | "inactive" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Tipo de documento</Label>
              <Select
                value={form.doc_type}
                onValueChange={(v) => setForm({ ...form, doc_type: v as "cpf" | "cnpj" })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cpf">CPF</SelectItem>
                  <SelectItem value="cnpj">CNPJ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Documento</Label>
              <Input value={form.doc} onChange={(e) => setForm({ ...form, doc: e.target.value })} />
            </div>
            <div>
              <Label>E-mail</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <Label>Telefone / WhatsApp</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Endereço</Label>
              <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div>
              <Label>Cidade</Label>
              <Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </div>
            <div>
              <Label>Estado</Label>
              <Input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} />
            </div>
            {kind === "provider" && (
              <div className="sm:col-span-2">
                <Label>Situação</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v as "active" | "inactive" })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="sm:col-span-2">
              <Label>Observações</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFormOpen(false)} className="rounded-full">
              Cancelar
            </Button>
            <Button onClick={submit} disabled={saving} className="rounded-full">
              {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail */}
      <Sheet open={!!detailId} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto p-0">
          {detailId && <StakeholderDetailSheet kind={kind} id={detailId} onEdit={() => {
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
  return (
    <div
      onClick={onOpen}
      className="group cursor-pointer rounded-2xl border border-border bg-card p-4 hover:border-primary/40 hover:shadow-[0_8px_30px_-12px_hsl(var(--primary)/0.35)] transition-all"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium leading-tight">{row.trade_name || row.name}</p>
          <p className="truncate text-[11px] text-muted-foreground mt-0.5">
            {categoryLabel ? `${categoryLabel} · ` : ""}
            {row.city || row.email || row.phone || "Sem dados de contato"}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {pending > 0 && (
            <span className="rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] px-2 py-0.5 tabular-nums">
              {pending}
            </span>
          )}
          <span
            className={`rounded-full text-[10px] px-2 py-0.5 ${row.status === "active" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-muted text-muted-foreground"}`}
          >
            {row.status === "active" ? "Ativo" : "Inativo"}
          </span>
        </div>
      </div>

      {!compact && (
        <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          {row.email && (
            <p className="flex items-center gap-1.5 truncate">
              <Mail className="size-3 shrink-0" /> {row.email}
            </p>
          )}
          {row.phone && (
            <p className="flex items-center gap-1.5 truncate">
              <Phone className="size-3 shrink-0" /> {row.phone}
            </p>
          )}
          {(row.city || row.state) && (
            <p className="flex items-center gap-1.5 truncate">
              <MapPin className="size-3 shrink-0" /> {[row.city, row.state].filter(Boolean).join(" / ")}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
          className="text-[11px] px-2 py-1 rounded-md hover:bg-secondary flex items-center gap-1 text-muted-foreground"
        >
          <Pencil className="size-3" /> Editar
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="text-[11px] px-2 py-1 rounded-md hover:bg-destructive/10 hover:text-destructive flex items-center gap-1 text-muted-foreground"
        >
          <Trash2 className="size-3" /> Excluir
        </button>
      </div>
    </div>
  );
}
