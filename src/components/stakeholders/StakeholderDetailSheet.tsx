import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Loader2,
  Mail,
  Phone,
  MapPin,
  FileText,
  Plus,
  Pencil,
  CheckCircle2,
  Circle,
  CircleDot,
  Trash2,
  Home,
  Wallet,
  Paperclip,
  LayoutGrid,
  Link2,
  Unlink,
  ExternalLink,
  CalendarDays,
  Video,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  getStakeholderDetail,
  addStakeholderNote,
  saveStakeholderActivity,
  setStakeholderActivityStatus,
  deleteStakeholderActivity,
  linkPropertyToOwner,
} from "@/lib/stakeholders.functions";
import { getStakeholderIntegrationFeed } from "@/lib/stakeholder-feed.functions";
import type { StakeholderKind } from "./StakeholderDirectory";
import { PROVIDER_CATEGORIES } from "./StakeholderDirectory";

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const STATUS_META: Record<string, { label: string; icon: typeof Circle; cls: string }> = {
  todo: { label: "A fazer", icon: Circle, cls: "text-muted-foreground" },
  doing: { label: "Em andamento", icon: CircleDot, cls: "text-amber-500" },
  done: { label: "Concluída", icon: CheckCircle2, cls: "text-emerald-500" },
};

export function StakeholderDetailSheet({
  kind,
  id,
  onEdit,
}: {
  kind: StakeholderKind;
  id: string;
  onEdit: () => void;
}) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getStakeholderDetail);
  const noteFn = useServerFn(addStakeholderNote);
  const actFn = useServerFn(saveStakeholderActivity);
  const actStatusFn = useServerFn(setStakeholderActivityStatus);
  const actDelFn = useServerFn(deleteStakeholderActivity);
  const linkFn = useServerFn(linkPropertyToOwner);

  const [note, setNote] = useState("");
  const [newActivity, setNewActivity] = useState("");
  const [busy, setBusy] = useState(false);

  const queryKey = ["stakeholder-detail", kind, id];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => detailFn({ data: { kind, id } }),
    refetchInterval: 20_000,
  });

  const row = data?.row as Record<string, any> | null | undefined;

  async function submitNote() {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await noteFn({ data: { kind, id, message: note.trim() } });
      setNote("");
      qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addActivity() {
    if (!newActivity.trim()) return;
    setBusy(true);
    try {
      await actFn({
        data: { kind, stakeholderId: id, title: newActivity.trim(), status: "todo", priority: "normal" },
      });
      setNewActivity("");
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cycleStatus(activityId: string, current: string) {
    const next = current === "todo" ? "doing" : current === "doing" ? "done" : "todo";
    await actStatusFn({ data: { id: activityId, status: next as "todo" | "doing" | "done" } });
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
  }

  async function removeActivity(activityId: string) {
    await actDelFn({ data: { id: activityId } });
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
  }

  async function toggleLink(propertyId: string, link: boolean) {
    setBusy(true);
    try {
      await linkFn({ data: { ownerId: id, propertyId, link } });
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["stakeholders", kind] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (isLoading || !row) {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-muted-foreground gap-2">
        <Loader2 className="size-4 animate-spin" /> Carregando ficha...
      </div>
    );
  }

  const categoryLabel =
    kind === "provider"
      ? PROVIDER_CATEGORIES.find((c) => c.value === row.category)?.label ?? "Outros"
      : null;

  const feedEvents = feed.data?.events ?? [];
  const feedDocs = feed.data?.documents ?? [];
  const activities = data?.activities ?? [];
  const events = data?.events ?? [];
  const properties = data?.properties ?? [];
  const available = data?.availableProperties ?? [];
  const openCount = activities.filter((a: any) => a.status !== "done").length;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-border bg-gradient-to-br from-primary/10 via-transparent to-transparent px-6 py-7">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-2xl leading-tight truncate">
              {row.trade_name || row.name}
            </h2>
            <p className="text-xs text-muted-foreground mt-1 truncate">
              {categoryLabel ? `${categoryLabel} · ` : ""}
              {row.status === "active" ? "Ativo" : "Inativo"}
              {row.doc ? ` · ${String(row.doc_type).toUpperCase()} ${row.doc}` : ""}
            </p>
          </div>
          <Button variant="outline" size="sm" className="rounded-full shrink-0" onClick={onEdit}>
            <Pencil className="size-3.5 mr-1.5" /> Editar
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
          {row.email && (
            <span className="flex items-center gap-1.5"><Mail className="size-3" /> {row.email}</span>
          )}
          {row.phone && (
            <span className="flex items-center gap-1.5"><Phone className="size-3" /> {row.phone}</span>
          )}
          {(row.city || row.state) && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3" /> {[row.city, row.state].filter(Boolean).join(" / ")}
            </span>
          )}
        </div>

        {/* KPIs */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Kpi label={kind === "owner" ? "Residências" : "Atendimentos"} value={kind === "owner" ? properties.length : events.length} icon={kind === "owner" ? Home : LayoutGrid} />
          <Kpi label="Pendências" value={openCount} icon={CircleDot} tone="amber" />
          <Kpi label="Registros" value={events.length} icon={FileText} />
        </div>
      </div>

      <div className="px-6 py-5">
        <Tabs defaultValue="resumo">
          <TabsList className="w-full">
            <TabsTrigger value="resumo">Resumo</TabsTrigger>
            {kind === "owner" && <TabsTrigger value="imoveis">Residências</TabsTrigger>}
            <TabsTrigger value="atividades">Atividades</TabsTrigger>
            <TabsTrigger value="timeline">Linha do tempo</TabsTrigger>
            <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
            <TabsTrigger value="documentos">Documentos</TabsTrigger>
          </TabsList>

          {/* Resumo */}
          <TabsContent value="resumo" className="mt-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoCard label="Nome completo" value={row.name} />
              <InfoCard label="Nome fantasia" value={row.trade_name} />
              <InfoCard label={String(row.doc_type ?? "cpf").toUpperCase()} value={row.doc} />
              <InfoCard label="E-mail" value={row.email} />
              <InfoCard label="Telefone" value={row.phone} />
              <InfoCard label="Endereço" value={row.address} />
              <InfoCard label="Cidade" value={[row.city, row.state].filter(Boolean).join(" / ")} />
              {kind === "provider" && (
                <InfoCard
                  label="Valor / hora"
                  value={
                    row.hourly_rate_cents
                      ? (row.hourly_rate_cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                      : null
                  }
                />
              )}
            </div>
            {row.notes && (
              <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Observações</p>
                <p className="text-sm whitespace-pre-wrap">{row.notes}</p>
              </div>
            )}
          </TabsContent>

          {/* Residências */}
          {kind === "owner" && (
            <TabsContent value="imoveis" className="mt-5 space-y-4">
              <div className="space-y-2">
                {properties.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhuma residência vinculada ainda.</p>
                )}
                {properties.map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {p.published ? "Publicado" : "Rascunho"}
                        {p.city ? ` · ${p.city}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Link
                        to="/admin/properties/$id"
                        params={{ id: p.id }}
                        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                        title="Abrir residência"
                      >
                        <ExternalLink className="size-3.5" />
                      </Link>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggleLink(p.id, false)}
                        className="grid size-8 place-items-center rounded-full text-muted-foreground hover:text-destructive transition-colors"
                        title="Desvincular"
                      >
                        <Unlink className="size-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-dashed border-border p-4 space-y-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  Vincular residência existente
                </p>
                {available.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Todas as residências da conta já estão vinculadas a um proprietário.
                  </p>
                ) : (
                  available.map((p: any) => (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleLink(p.id, true)}
                      className="w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary transition-colors"
                    >
                      <span className="truncate">{p.name}</span>
                      <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))
                )}
                <Link
                  to="/admin/properties/$id"
                  params={{ id: "new" }}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                >
                  <Plus className="size-3.5" /> Criar nova residência
                </Link>
              </div>
            </TabsContent>
          )}

          {/* Atividades */}
          <TabsContent value="atividades" className="mt-5 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={newActivity}
                onChange={(e) => setNewActivity(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addActivity()}
                placeholder="Nova atividade..."
                className="rounded-full text-sm"
              />
              <Button size="sm" className="rounded-full shrink-0" onClick={addActivity} disabled={busy}>
                <Plus className="size-4" />
              </Button>
            </div>
            {activities.map((a: any) => {
              const meta = STATUS_META[a.status] ?? STATUS_META.todo;
              const StatusIcon = meta.icon;
              return (
                <div key={a.id} className="group flex items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => cycleStatus(a.id, a.status)}
                    className={`mt-0.5 ${meta.cls}`}
                    title={meta.label}
                  >
                    <StatusIcon className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm truncate ${a.status === "done" ? "line-through text-muted-foreground" : ""}`}>
                      {a.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {meta.label}
                      {a.due_date ? ` · vence ${a.due_date.split("-").reverse().join("/")}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeActivity(a.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              );
            })}
            {activities.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma atividade registrada.</p>
            )}
          </TabsContent>

          {/* Linha do tempo */}
          <TabsContent value="timeline" className="mt-5 space-y-4">
            <div className="flex items-start gap-2">
              <Textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Adicionar nota..."
                className="text-sm"
              />
              <Button size="sm" className="rounded-full shrink-0" onClick={submitNote} disabled={busy}>
                <Plus className="size-4" />
              </Button>
            </div>
            <ol className="relative border-l border-border pl-4 space-y-3">
              {events.map((ev: any) => (
                <li key={ev.id} className="relative">
                  <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary/70" />
                  <p className="text-sm">{ev.message}</p>
                  <p className="text-[11px] text-muted-foreground">{fmt(ev.created_at)}</p>
                </li>
              ))}
              {events.length === 0 && <li className="text-xs text-muted-foreground">Sem registros.</li>}
            </ol>
          </TabsContent>

          <TabsContent value="financeiro" className="mt-5">
            <Placeholder
              icon={Wallet}
              title="Financeiro em construção"
              desc="Repasses, comissões e histórico de pagamentos deste cadastro aparecerão aqui."
            />
          </TabsContent>

          <TabsContent value="documentos" className="mt-5">
            <Placeholder
              icon={Paperclip}
              title="Documentos em construção"
              desc="Contratos, procurações e anexos ficarão centralizados nesta aba."
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: typeof Home;
  tone?: "amber";
}) {
  return (
    <div className="rounded-xl border border-border bg-card/70 backdrop-blur px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className={`size-3 ${tone === "amber" ? "text-amber-500" : ""}`} /> {label}
      </div>
      <p className="font-display text-xl tabular-nums mt-0.5">{value}</p>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm mt-0.5 break-words">{value}</p>
    </div>
  );
}

function Placeholder({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Wallet;
  title: string;
  desc: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center">
      <Icon className="size-5 mx-auto text-muted-foreground" />
      <p className="text-sm mt-3">{title}</p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">{desc}</p>
    </div>
  );
}
