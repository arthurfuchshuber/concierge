import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  getStakeholderDetail,
  addStakeholderNote,
  saveStakeholderActivity,
  setStakeholderActivityStatus,
  deleteStakeholderActivity,
} from "@/lib/stakeholders.functions";
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
      </div>

      <div className="px-6 py-5">
        <Accordion type="single" collapsible className="space-y-3">
          {row.notes && (
            <AccordionItem value="notes" className="rounded-xl border border-border bg-card px-4">
              <AccordionTrigger className="text-sm">
                <span className="flex items-center gap-2"><FileText className="size-4" /> Observações</span>
              </AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground whitespace-pre-wrap">
                {row.notes}
              </AccordionContent>
            </AccordionItem>
          )}

          {kind === "owner" && (
            <AccordionItem value="properties" className="rounded-xl border border-border bg-card px-4">
              <AccordionTrigger className="text-sm">
                <span className="flex items-center gap-2">
                  <Home className="size-4" /> Imóveis vinculados
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {(data?.properties ?? []).length}
                  </span>
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2">
                {(data?.properties ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhum imóvel vinculado ainda.</p>
                ) : (
                  (data?.properties ?? []).map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between text-sm py-1">
                      <span className="truncate">{p.name}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {p.published ? "Publicado" : "Rascunho"}
                      </span>
                    </div>
                  ))
                )}
              </AccordionContent>
            </AccordionItem>
          )}

          <AccordionItem value="activities" className="rounded-xl border border-border bg-card px-4">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <CircleDot className="size-4" /> Atividades
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {(data?.activities ?? []).filter((a: any) => a.status !== "done").length} abertas
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
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
              {(data?.activities ?? []).map((a: any) => {
                const meta = STATUS_META[a.status] ?? STATUS_META.todo;
                const StatusIcon = meta.icon;
                return (
                  <div key={a.id} className="group flex items-start gap-2.5 py-1.5">
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
              {(data?.activities ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma atividade registrada.</p>
              )}
            </AccordionContent>
          </AccordionItem>

          <AccordionItem value="timeline" className="rounded-xl border border-border bg-card px-4">
            <AccordionTrigger className="text-sm">
              <span className="flex items-center gap-2">
                <FileText className="size-4" /> Linha do tempo
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3">
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
                {(data?.events ?? []).map((ev: any) => (
                  <li key={ev.id} className="relative">
                    <span className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-primary/70" />
                    <p className="text-sm">{ev.message}</p>
                    <p className="text-[11px] text-muted-foreground">{fmt(ev.created_at)}</p>
                  </li>
                ))}
                {(data?.events ?? []).length === 0 && (
                  <li className="text-xs text-muted-foreground">Sem registros.</li>
                )}
              </ol>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
