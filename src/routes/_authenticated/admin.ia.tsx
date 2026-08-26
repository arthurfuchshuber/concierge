import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Sparkles, Plus, Archive, Loader2, Check, X } from "lucide-react";
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
  listOperationKnowledge,
  saveOperationKnowledge,
  archiveOperationKnowledge,
  type TenantKnowledgeRow,
} from "@/lib/knowledge-governance.functions";
import { listLearningQueue, reviewLearningCandidate } from "@/lib/ai-learning.functions";
import { useImpersonation } from "@/hooks/useImpersonation";
import { PageHeader } from "@/components/ds/PageHeader";
import { usePresence } from "@/hooks/usePresence";
import { PresenceAvatars } from "@/components/presence/PresenceAvatars";
import { FieldTypingBadge } from "@/components/presence/FieldTypingBadge";

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
    <div className="max-w-[1440px] mx-auto w-full px-6 lg:px-10 py-8 lg:py-10 space-y-6">
      <PageHeader
        eyebrow={<span className="text-accent">Memória e conhecimento</span>}
        title="IA Concierge"
        subtitle="Tudo que a IA aprendeu — e o que depende da sua aprovação."
      />

      <IaTabs />
    </div>
  );
}

/* ---------------------------------------------------------------- */

function IaTabs() {
  const [tab, setTab] = useState<"conhecimento" | "aprendizados">("conhecimento");
  const [openNew, setOpenNew] = useState(0);
  const { impersonation } = useImpersonation();
  const tenantId = impersonation?.userId;
  const listFn = useServerFn(listLearningQueue);
  const { data: queueData } = useQuery({
    queryKey: ["ia-learning-queue", tenantId ?? "self"],
    queryFn: async () => {
      try {
        return await listFn({ data: { status: "pending", tenantId } });
      } catch {
        return [] as Array<Record<string, unknown>>;
      }
    },
    staleTime: 15_000,
  });
  const pendingCount = queueData?.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="ds-scroll-x gap-2">
          <button
            onClick={() => setTab("conhecimento")}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors ${
              tab === "conhecimento"
                ? "bg-gradient-to-r from-primary to-accent text-primary-foreground"
                : "border border-border text-foreground hover:bg-secondary"
            }`}
          >
            <BookOpen className="size-4" /> Conhecimento
          </button>
          <button
            onClick={() => setTab("aprendizados")}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors ${
              tab === "aprendizados"
                ? "bg-gradient-to-r from-primary to-accent text-primary-foreground"
                : "border border-border text-foreground hover:bg-secondary"
            }`}
          >
            <Sparkles className="size-4" /> Aprendizados{pendingCount > 0 ? ` · ${pendingCount}` : ""}
          </button>
        </div>
        {tab === "conhecimento" && (
          <button
            onClick={() => setOpenNew((v) => v + 1)}
            aria-label="Novo conhecimento"
            title="Novo conhecimento"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-r from-primary to-accent text-primary-foreground"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {tab === "conhecimento" ? <KnowledgeTab openNewSignal={openNew} /> : <QueueTab />}
    </div>
  );
}

const EMPTY_KNOWLEDGE = {
  id: null as string | null,
  title: "",
  category: "geral",
  content: "",
  knowledgeScope: "TENANT_KNOWLEDGE" as "TENANT_KNOWLEDGE" | "PORTFOLIO_KNOWLEDGE",
  priority: 3,
};

function KnowledgeTab({ openNewSignal }: { openNewSignal: number }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listOperationKnowledge);
  const saveFn = useServerFn(saveOperationKnowledge);
  const archiveFn = useServerFn(archiveOperationKnowledge);
  const [form, setForm] = useState<typeof EMPTY_KNOWLEDGE | null>(null);
  const [saving, setSaving] = useState(false);
  const { impersonation } = useImpersonation();
  const tenantId = impersonation?.userId;
  // Presença em tempo real: item de conhecimento já salvo tem id (sala
  // compartilhada entre quem estiver editando o mesmo registro); um item
  // novo/não salvo ainda não tem id, então usa null (desliga presença sem
  // quebrar o render).
  const presence = usePresence(form?.id ? `ia-knowledge:${form.id}` : null);
  const lastSignal = useRef(openNewSignal);
  useEffect(() => {
    if (openNewSignal !== lastSignal.current) {
      lastSignal.current = openNewSignal;
      setForm({ ...EMPTY_KNOWLEDGE });
    }
  }, [openNewSignal]);

  const { data, isLoading } = useQuery({
    queryKey: ["ia-operation-knowledge", tenantId ?? "self"],
    queryFn: async () => {
      try {
        return await listFn({ data: { status: "active", tenantId } });
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
      await saveFn({ data: { ...form, id: form.id, tenantId } });
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
      await archiveFn({ data: { id, tenantId } });
      toast.success("Conhecimento arquivado");
      await qc.invalidateQueries({ queryKey: ["ia-operation-knowledge"] });
    } catch {
      toast.error("Não foi possível arquivar");
    }
  }

  return (
    <div className="space-y-4">
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty
          icon={<BookOpen className="size-5" />}
          title="Nenhuma regra cadastrada"
          text="Registre aqui as regras da sua empresa: políticas de check-in, tom de voz, exceções e procedimentos."
        />
      ) : (
        <div className="ds-list grid gap-1.5 sm:grid-cols-2">
          {data.map((k) => (
            <article key={k.id} className="ds-surface border border-border bg-card p-4 space-y-2 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <h3 className="ds-card-title leading-snug min-w-0 truncate">{k.title}</h3>
                <Badge variant="secondary" className="shrink-0">
                  {k.knowledge_scope === "PORTFOLIO_KNOWLEDGE" ? "Carteira" : "Empresa"}
                </Badge>
              </div>
              <p className="ds-meta">
                {k.category} · prioridade {k.priority}
              </p>
              <p className="ds-card-desc whitespace-pre-wrap line-clamp-6">{k.content}</p>
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
            <div className="flex items-center justify-between gap-3">
              <DialogTitle>{form?.id ? "Editar conhecimento" : "Novo conhecimento"}</DialogTitle>
              <PresenceAvatars users={presence.users} />
            </div>
          </DialogHeader>
          {form && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Título</Label>
                <Input
                  value={form.title}
                  onChange={(e) => {
                    setForm({ ...form, title: e.target.value });
                    presence.broadcastTyping("title", e.target.value);
                  }}
                  onBlur={() => presence.broadcastFieldBlur("title")}
                />
                <FieldTypingBadge typing={presence.typing["title"]} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Input
                    value={form.category}
                    onChange={(e) => {
                      setForm({ ...form, category: e.target.value });
                      presence.broadcastTyping("category", e.target.value);
                    }}
                    onBlur={() => presence.broadcastFieldBlur("category")}
                  />
                  <FieldTypingBadge typing={presence.typing["category"]} />
                </div>
                <div className="space-y-1.5">
                  <Label>Abrangência</Label>
                  <Select
                    value={form.knowledgeScope}
                    onValueChange={(v) => {
                      setForm({ ...form, knowledgeScope: v as "TENANT_KNOWLEDGE" | "PORTFOLIO_KNOWLEDGE" });
                      presence.broadcastTyping(
                        "knowledgeScope",
                        v === "PORTFOLIO_KNOWLEDGE" ? "Carteira de imóveis" : "Toda a empresa",
                      );
                    }}
                    onOpenChange={(open) => !open && presence.broadcastFieldBlur("knowledgeScope")}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TENANT_KNOWLEDGE">Toda a empresa</SelectItem>
                      <SelectItem value="PORTFOLIO_KNOWLEDGE">Carteira de imóveis</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldTypingBadge typing={presence.typing["knowledgeScope"]} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Conteúdo</Label>
                <Textarea
                  rows={7}
                  value={form.content}
                  onChange={(e) => {
                    setForm({ ...form, content: e.target.value });
                    presence.broadcastTyping("content", e.target.value);
                  }}
                  onBlur={() => presence.broadcastFieldBlur("content")}
                  placeholder="Ex.: check-in antecipado só é liberado após confirmação da limpeza."
                />
                <FieldTypingBadge typing={presence.typing["content"]} />
              </div>
              <div className="space-y-1.5">
                <Label>Prioridade (1 = máxima)</Label>
                <Input
                  type="number"
                  min={1}
                  max={5}
                  value={form.priority}
                  onChange={(e) => {
                    const next = Number(e.target.value) || 3;
                    setForm({ ...form, priority: next });
                    presence.broadcastTyping("priority", String(next));
                  }}
                  onBlur={() => presence.broadcastFieldBlur("priority")}
                />
                <FieldTypingBadge typing={presence.typing["priority"]} />
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
  const { impersonation } = useImpersonation();
  const tenantId = impersonation?.userId;

  const { data, isLoading } = useQuery({
    queryKey: ["ia-learning-queue", tenantId ?? "self"],
    queryFn: async () => {
      try {
        return await listFn({ data: { status: "pending", tenantId } });
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
      await reviewFn({ data: { candidateId: id, action, tenantId } });
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
    <div className="ds-list">
      {rows.map((c) => {
        const id = String(c.id);
        return (
          <article key={id} className="ds-surface border border-border bg-card p-4 space-y-2 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="ds-card-title min-w-0 truncate">{String(c.title ?? "Novo aprendizado")}</h3>
              <Badge className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600" variant="outline">
                {Math.round(Number(c.confidence ?? 0) * 100)}% confiança
              </Badge>
            </div>
            <p className="ds-meta">
              {String(c.learning_type ?? "Regra")} · abrangência sugerida: {String(c.recommended_scope ?? c.suggested_scope ?? "imóvel")}
            </p>
            <p className="ds-card-desc whitespace-pre-wrap">
              {String(c.extracted_information ?? c.proposed_memory ?? "")}
            </p>
            {c.rationale ? <p className="ds-meta">Motivo: {String(c.rationale)}</p> : null}
            <div className="flex gap-2 pt-1">
              <Button
                className="flex-1 bg-gradient-to-r from-primary to-accent"
                disabled={busy === id}
                onClick={() => review(id, "approve")}
              >
                <Check className="size-4" /> Aprovar
              </Button>
              <Button className="flex-1" variant="outline" disabled={busy === id} onClick={() => review(id, "reject")}>
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
      <h3 className="ds-card-title">{title}</h3>
      <p className="ds-body max-w-md mx-auto">{text}</p>
    </div>
  );
}
