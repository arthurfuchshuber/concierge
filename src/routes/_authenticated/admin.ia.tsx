import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { BrainCircuit, BookOpen, Sparkles, Plus, Archive, Loader2, Check, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  listOperationMemoryInsights,
  listOperationKnowledge,
  saveOperationKnowledge,
  archiveOperationKnowledge,
  type TenantKnowledgeRow,
} from "@/lib/knowledge-governance.functions";
import { listLearningQueue, reviewLearningCandidate } from "@/lib/ai-learning.functions";

export const Route = createFileRoute("/_authenticated/admin/ia")({
  head: () => ({
    meta: [
      { title: "IA Concierge — Memória e Conhecimento da Operação" },
      {
        name: "description",
        content:
          "Governança do conhecimento do ConciergeIA: memória da operação, regras da empresa e aprendizados pendentes de aprovação.",
      },
      { property: "og:title", content: "IA Concierge — Governança de Conhecimento" },
      {
        property: "og:description",
        content: "Veja o que a IA aprendeu, aprove novos conhecimentos e mantenha as regras da sua operação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IaGovernancePage,
});

function IaGovernancePage() {
  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-6 space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl sm:text-3xl flex items-center gap-2">
          <BrainCircuit className="size-6 text-primary" />
          IA Concierge
        </h1>
        <p className="text-sm text-muted-foreground">
          Tudo que a inteligência aprendeu sobre a sua operação — e o que ainda depende da sua aprovação.
        </p>
      </header>

      <Tabs defaultValue="memoria">
        <TabsList className="w-full flex overflow-x-auto justify-start">
          <TabsTrigger value="memoria" className="shrink-0">Memória da Operação</TabsTrigger>
          <TabsTrigger value="conhecimento" className="shrink-0">Conhecimento da Operação</TabsTrigger>
          <TabsTrigger value="aprendizados" className="shrink-0">Aprendizados Pendentes</TabsTrigger>
        </TabsList>

        <TabsContent value="memoria" className="mt-5">
          <MemoryTab />
        </TabsContent>
        <TabsContent value="conhecimento" className="mt-5">
          <KnowledgeTab />
        </TabsContent>
        <TabsContent value="aprendizados" className="mt-5">
          <QueueTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function MemoryTab() {
  const fn = useServerFn(listOperationMemoryInsights);
  const { data, isLoading } = useQuery({
    queryKey: ["ia-operation-memory"],
    queryFn: async () => {
      try {
        return await fn({ data: {} });
      } catch {
        return [];
      }
    },
    staleTime: 60_000,
  });

  if (isLoading) return <Loading />;
  if (!data?.length) {
    return (
      <Empty
        icon={<BrainCircuit className="size-5" />}
        title="Nenhum padrão detectado ainda"
        text="Conforme os hóspedes conversam, os padrões recorrentes e as lacunas aparecem aqui automaticamente."
      />
    );
  }

  const label: Record<string, string> = {
    gap: "Lacuna de informação",
    recurrence: "Pedido recorrente",
    memory: "Padrão aprendido",
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {data.map((m) => (
        <article key={m.id} className="rounded-2xl border border-border bg-surface p-4 space-y-2 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-medium leading-snug">{m.topic}</h3>
            <Badge variant="secondary" className="shrink-0">{label[m.kind] ?? m.kind}</Badge>
          </div>
          {m.propertyName && <p className="text-xs text-muted-foreground">{m.propertyName}</p>}
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{m.detail}</p>
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted-foreground">
            <span>{m.occurrences}× observado</span>
            {m.confidence != null && <span>· confiança {(m.confidence * 100).toFixed(0)}%</span>}
            {m.lastSeenAt && <span>· {new Date(m.lastSeenAt).toLocaleDateString("pt-BR")}</span>}
          </div>
          <p className="text-sm rounded-xl bg-secondary/60 px-3 py-2">{m.suggestion}</p>
        </article>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */

const EMPTY_KNOWLEDGE = {
  id: null as string | null,
  title: "",
  category: "geral",
  content: "",
  knowledgeScope: "TENANT_KNOWLEDGE" as "TENANT_KNOWLEDGE" | "PORTFOLIO_KNOWLEDGE",
  priority: 3,
};

function KnowledgeTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOperationKnowledge);
  const saveFn = useServerFn(saveOperationKnowledge);
  const archiveFn = useServerFn(archiveOperationKnowledge);
  const [form, setForm] = useState<typeof EMPTY_KNOWLEDGE | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["ia-operation-knowledge"],
    queryFn: async () => {
      try {
        return await listFn({ data: { status: "active" } });
      } catch {
        return [] as TenantKnowledgeRow[];
      }
    },
    staleTime: 30_000,
  });

  async function save() {
    if (!form) return;
    setSaving(true);
    try {
      await saveFn({ data: { ...form, id: form.id } });
      toast.success("Conhecimento salvo — a IA já pode usá-lo.");
      setForm(null);
      await qc.invalidateQueries({ queryKey: ["ia-operation-knowledge"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSaving(false);
    }
  }

  async function archive(id: string) {
    try {
      await archiveFn({ data: { id } });
      toast.success("Conhecimento arquivado");
      await qc.invalidateQueries({ queryKey: ["ia-operation-knowledge"] });
    } catch {
      toast.error("Não foi possível arquivar");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setForm({ ...EMPTY_KNOWLEDGE })}>
          <Plus className="size-4" /> Novo conhecimento
        </Button>
      </div>

      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty
          icon={<BookOpen className="size-5" />}
          title="Nenhuma regra cadastrada"
          text="Registre aqui as regras da sua empresa: políticas de check-in, tom de voz, exceções e procedimentos."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.map((k) => (
            <article key={k.id} className="rounded-2xl border border-border bg-surface p-4 space-y-2 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-medium leading-snug">{k.title}</h3>
                <Badge variant="secondary" className="shrink-0">
                  {k.knowledge_scope === "PORTFOLIO_KNOWLEDGE" ? "Carteira" : "Empresa"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {k.category} · prioridade {k.priority}
              </p>
              <p className="text-sm text-foreground/80 whitespace-pre-wrap line-clamp-6">{k.content}</p>
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setForm({
                      id: k.id,
                      title: k.title,
                      category: k.category,
                      content: k.content,
                      knowledgeScope:
                        k.knowledge_scope === "PORTFOLIO_KNOWLEDGE" ? "PORTFOLIO_KNOWLEDGE" : "TENANT_KNOWLEDGE",
                      priority: k.priority,
                    })
                  }
                >
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => archive(k.id)}>
                  <Archive className="size-4" /> Arquivar
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <Dialog open={!!form} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Editar conhecimento" : "Novo conhecimento"}</DialogTitle>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Abrangência</Label>
                  <Select
                    value={form.knowledgeScope}
                    onValueChange={(v) =>
                      setForm({ ...form, knowledgeScope: v as "TENANT_KNOWLEDGE" | "PORTFOLIO_KNOWLEDGE" })
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TENANT_KNOWLEDGE">Toda a empresa</SelectItem>
                      <SelectItem value="PORTFOLIO_KNOWLEDGE">Carteira de imóveis</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Conteúdo</Label>
                <Textarea
                  rows={7}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Ex.: check-in antecipado só é liberado após confirmação da limpeza."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Prioridade (1 = máxima)</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 3 })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setForm(null)}>Cancelar</Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function QueueTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listLearningQueue);
  const reviewFn = useServerFn(reviewLearningCandidate);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ia-learning-queue"],
    queryFn: async () => {
      try {
        return await listFn({ data: { status: "pending" } });
      } catch {
        return [] as Array<Record<string, unknown>>;
      }
    },
    staleTime: 15_000,
  });

  const rows = useMemo(() => (data ?? []) as Array<Record<string, unknown>>, [data]);

  async function review(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      await reviewFn({ data: { candidateId: id, action } });
      toast.success(action === "approve" ? "Aprendizado aprovado e aplicado" : "Aprendizado descartado");
      await qc.invalidateQueries({ queryKey: ["ia-learning-queue"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível revisar");
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <Loading />;
  if (!rows.length) {
    return (
      <Empty
        icon={<Sparkles className="size-5" />}
        title="Nada aguardando aprovação"
        text="Quando a IA identificar um novo conhecimento, ele aparece aqui antes de entrar em uso."
      />
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((c) => {
        const id = String(c.id);
        return (
          <article key={id} className="rounded-2xl border border-border bg-surface p-4 space-y-2 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="font-medium">{String(c.title ?? "Novo aprendizado")}</h3>
              <div className="flex gap-2">
                <Badge variant="secondary">{String(c.learning_type ?? "regra")}</Badge>
                <Badge variant="outline">
                  {Math.round(Number(c.confidence ?? 0) * 100)}% confiança
                </Badge>
              </div>
            </div>
            <p className="text-sm text-foreground/80 whitespace-pre-wrap">
              {String(c.extracted_information ?? c.proposed_memory ?? "")}
            </p>
            {c.rationale ? <p className="text-xs text-muted-foreground">Motivo: {String(c.rationale)}</p> : null}
            <p className="text-xs text-muted-foreground">
              Abrangência sugerida: {String(c.recommended_scope ?? c.suggested_scope ?? "imóvel")}
            </p>
            <div className="flex gap-2 pt-1">
              <Button size="sm" disabled={busy === id} onClick={() => review(id, "approve")}>
                <Check className="size-4" /> Aprovar
              </Button>
              <Button size="sm" variant="ghost" disabled={busy === id} onClick={() => review(id, "reject")}>
                <X className="size-4" /> Descartar
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- */

function Loading() {
  return (
    <div className="grid place-items-center py-16 text-muted-foreground">
      <Loader2 className="size-5 animate-spin" />
    </div>
  );
}

function Empty({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border p-10 text-center space-y-2">
      <div className="grid place-items-center text-muted-foreground">{icon}</div>
      <h3 className="font-medium">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{text}</p>
    </div>
  );
}
