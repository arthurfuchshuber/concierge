import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listHostFaqs,
  saveHostFaqs,
  listHostKnowledge,
  saveHostKnowledge,
  listPropertiesBrief,
  applyHostFaqsToProperties,
} from "@/lib/host-library.functions";
import { listHostBehavior, saveHostBehavior } from "@/lib/host-behavior.functions";
import { useSubscription } from "@/hooks/useSubscription";
import { useMyPermissions } from "@/hooks/useMyPermissions";

import { AiPlanLock } from "@/components/admin/AiPlanLock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Trash2, Save, HelpCircle, BrainCircuit, Loader2, Send, MapPin, Bot, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/biblioteca")({
  component: BibliotecaPage,
});

type FaqItem = {
  id?: string | null;
  question: string;
  answer: string;
  tags: ("chegada" | "saida" | "residencia" | "explore")[];
  scope_property_id?: string | null;
};
type KnowledgeItem = {
  id?: string | null;
  title: string;
  body: string;
  enabled: boolean;
  scope_property_id?: string | null;
};

const FAQ_TAGS: { value: FaqItem["tags"][number]; label: string }[] = [
  { value: "chegada", label: "Chegada" },
  { value: "saida", label: "Saída" },
  { value: "residencia", label: "Residência" },
  { value: "explore", label: "Explore" },
];

type ScopeView = "all" | "global" | string;

function ScopeBadge({
  value,
  onChange,
  properties,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (v: string | null) => void;
  properties: { id: string; name: string }[];
  disabled?: boolean;
}) {
  return (
    <select
      disabled={disabled}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? e.target.value : null)}
      className="text-[11px] rounded-full border border-border bg-background/60 px-2.5 py-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
      title="Escopo: Global ou guia específico"
      onClick={(e) => e.stopPropagation()}
    >
      <option value="">🌐 Global (todos os guias)</option>
      {properties.map((p) => (
        <option key={p.id} value={p.id}>
          📍 {p.name}
        </option>
      ))}
    </select>
  );
}


function BibliotecaPage() {
  const { info: sub } = useSubscription();
  const aiLocked = !sub.features.ai;
  const { can, isOwner } = useMyPermissions();
  const canLibrary = isOwner || can("library_edit");
  const canTrain = isOwner || can("ai_train");


  const loadFaqs = useServerFn(listHostFaqs);
  const persistFaqs = useServerFn(saveHostFaqs);
  const loadKnow = useServerFn(listHostKnowledge);
  const persistKnow = useServerFn(saveHostKnowledge);
  const loadBeh = useServerFn(listHostBehavior);
  const persistBeh = useServerFn(saveHostBehavior);
  const loadProps = useServerFn(listPropertiesBrief);
  const applyFaqs = useServerFn(applyHostFaqsToProperties);

  const faqQuery = useQuery({ queryKey: ["host-faqs"], queryFn: () => loadFaqs() });
  const knowQuery = useQuery({ queryKey: ["host-knowledge"], queryFn: () => loadKnow() });
  const behQuery = useQuery({ queryKey: ["host-behavior"], queryFn: () => loadBeh() });
  const propsQuery = useQuery({ queryKey: ["host-properties-brief"], queryFn: () => loadProps() });

  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [behavior, setBehavior] = useState<KnowledgeItem[]>([]);
  const [savingFaqs, setSavingFaqs] = useState(false);
  const [savingKnow, setSavingKnow] = useState(false);
  const [savingBeh, setSavingBeh] = useState(false);
  const [selectedFaqIds, setSelectedFaqIds] = useState<Set<string>>(new Set());
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyTargets, setApplyTargets] = useState<Set<string>>(new Set());
  const [applySearch, setApplySearch] = useState("");
  const [applying, setApplying] = useState(false);
  const [openFaq, setOpenFaq] = useState<Set<number>>(new Set());
  const [openKnow, setOpenKnow] = useState<Set<number>>(new Set());
  const [scopeView, setScopeView] = useState<ScopeView>("all");
  const properties = (propsQuery.data ?? []).map((p) => ({ id: p.id, name: p.name }));
  const matchesScope = (s: string | null | undefined) => {
    if (scopeView === "all") return true;
    if (scopeView === "global") return !s;
    return s === scopeView;
  };
  const defaultScope = scopeView === "all" || scopeView === "global" ? null : scopeView;
  const toggleFaq = (i: number) =>
    setOpenFaq((s) => {
      const ns = new Set(s);
      ns.has(i) ? ns.delete(i) : ns.add(i);
      return ns;
    });
  const toggleKnow = (i: number) =>
    setOpenKnow((s) => {
      const ns = new Set(s);
      ns.has(i) ? ns.delete(i) : ns.add(i);
      return ns;
    });

  useEffect(() => {
    if (faqQuery.data) {
      setFaqs(
        faqQuery.data.map((f) => ({
          id: f.id,
          question: f.question,
          answer: f.answer,
          tags: (f.tags ?? []).filter((t) =>
            ["chegada", "saida", "residencia", "explore"].includes(t),
          ) as FaqItem["tags"],
          scope_property_id: (f as { scope_property_id?: string | null }).scope_property_id ?? null,
        })),
      );
    }
  }, [faqQuery.data]);

  useEffect(() => {
    if (knowQuery.data) {
      setKnowledge(
        knowQuery.data.map((k) => ({
          id: k.id,
          title: k.title,
          body: k.body,
          enabled: k.enabled,
          scope_property_id: (k as { scope_property_id?: string | null }).scope_property_id ?? null,
        })),
      );
    }
  }, [knowQuery.data]);

  useEffect(() => {
    if (behQuery.data) {
      setBehavior(
        behQuery.data.map((b) => ({
          id: b.id,
          title: b.title,
          body: b.body,
          enabled: b.enabled,
          scope_property_id: (b as { scope_property_id?: string | null }).scope_property_id ?? null,
        })),
      );
    }
  }, [behQuery.data]);


  async function handleSaveBeh() {
    const items = behavior.filter((b) => b.title.trim() && b.body.trim());
    setSavingBeh(true);
    try {
      await persistBeh({ data: { items } });
      toast.success("Comportamento da IA salvo");
      behQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingBeh(false);
    }
  }

  async function handleSaveFaqs() {
    const items = faqs.filter((f) => f.question.trim() && f.answer.trim());
    setSavingFaqs(true);
    try {
      await persistFaqs({ data: { items } });
      toast.success("FAQ global salva");
      faqQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingFaqs(false);
    }
  }
  async function handleSaveKnow() {
    const items = knowledge.filter((k) => k.title.trim() && k.body.trim());
    setSavingKnow(true);
    try {
      await persistKnow({ data: { items } });
      toast.success("Base de conhecimento salva");
      knowQuery.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSavingKnow(false);
    }
  }

  async function handleApply() {
    if (selectedFaqIds.size === 0 || applyTargets.size === 0) return;
    setApplying(true);
    try {
      const res = await applyFaqs({
        data: {
          faqIds: Array.from(selectedFaqIds),
          propertyIds: Array.from(applyTargets),
        },
      });
      toast.success(
        `${res.inserted} pergunta${res.inserted === 1 ? "" : "s"} aplicada${res.inserted === 1 ? "" : "s"}`,
      );
      setApplyOpen(false);
      setSelectedFaqIds(new Set());
      setApplyTargets(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao aplicar");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="font-display text-3xl md:text-4xl leading-tight">Biblioteca</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Reúse perguntas e contexto entre todos os seus guias.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium mr-1">
          Mostrar:
        </span>
        <button
          type="button"
          onClick={() => setScopeView("all")}
          className={`text-xs rounded-full px-3 py-1 border transition-colors ${scopeView === "all" ? "bg-accent text-accent-foreground border-accent" : "bg-background border-border text-muted-foreground hover:border-accent/50"}`}
        >
          Todos
        </button>
        <button
          type="button"
          onClick={() => setScopeView("global")}
          className={`text-xs rounded-full px-3 py-1 border transition-colors ${scopeView === "global" ? "bg-accent text-accent-foreground border-accent" : "bg-background border-border text-muted-foreground hover:border-accent/50"}`}
        >
          🌐 Global
        </button>
        <select
          value={scopeView !== "all" && scopeView !== "global" ? scopeView : ""}
          onChange={(e) => setScopeView(e.target.value || "all")}
          className="text-xs rounded-full border border-border bg-background/60 px-3 py-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        >
          <option value="">📍 Por guia…</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <Tabs defaultValue="faqs" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="faqs" className="gap-2">
            <HelpCircle className="size-4" /> FAQ
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2">
            <BrainCircuit className="size-4" /> Conhecimento da IA
            {aiLocked ? <AiPlanLock locked badgeOnly>x</AiPlanLock> : null}
          </TabsTrigger>
          <TabsTrigger value="behavior" className="gap-2">
            <Bot className="size-4" /> Comportamento da IA
            {aiLocked ? <AiPlanLock locked badgeOnly>x</AiPlanLock> : null}
          </TabsTrigger>
        </TabsList>


        <TabsContent value="faqs" className="space-y-4">
          <div className="rounded-2xl border border-border bg-card/40 p-4">
            <p className="text-sm text-muted-foreground">
              Crie uma vez e importe nas FAQs de cada guia conforme precisar. Tags definem em quais
              categorias do guia público a pergunta aparece quando importada.
            </p>
          </div>

          {faqs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma pergunta cadastrada ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {selectedFaqIds.size > 0 && (
                <div className="flex items-center gap-3 rounded-2xl border border-accent/40 bg-accent/5 px-4 py-2.5">
                  <span className="text-xs font-medium">
                    {selectedFaqIds.size} pergunta{selectedFaqIds.size > 1 ? "s" : ""} selecionada{selectedFaqIds.size > 1 ? "s" : ""}
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => setSelectedFaqIds(new Set())}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Limpar
                  </button>
                  <Button
                    size="sm"
                    className="rounded-full"
                    onClick={() => setApplyOpen(true)}
                  >
                    <Send className="size-3.5 mr-1.5" /> Aplicar a guias
                  </Button>
                </div>
              )}
              {faqs.map((f, i) => {
                if (!matchesScope(f.scope_property_id)) return null;
                const isOpen = openFaq.has(i) || !f.id;
                return (
                  <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="flex items-center gap-2 p-3">
                      {f.id ? (
                        <Checkbox
                          className="shrink-0"
                          checked={selectedFaqIds.has(f.id)}
                          onCheckedChange={(v) =>
                            setSelectedFaqIds((s) => {
                              const ns = new Set(s);
                              if (v) ns.add(f.id!);
                              else ns.delete(f.id!);
                              return ns;
                            })
                          }
                          aria-label="Selecionar pergunta"
                        />
                      ) : (
                        <div className="shrink-0 size-4" title="Salve para poder aplicar" />
                      )}
                      <button
                        type="button"
                        onClick={() => f.id && toggleFaq(i)}
                        className="flex-1 min-w-0 flex items-center gap-2 text-left group"
                        aria-expanded={isOpen}
                      >
                        <ChevronDown
                          className={`size-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                        />
                        <span className="flex-1 min-w-0 truncate text-sm font-medium">
                          {f.question.trim() || (
                            <span className="text-muted-foreground italic">Nova pergunta…</span>
                          )}
                        </span>
                      </button>
                      <ScopeBadge
                        value={f.scope_property_id}
                        properties={properties}
                        onChange={(v) =>
                          setFaqs((arr) =>
                            arr.map((x, j) => (j === i ? { ...x, scope_property_id: v } : x)),
                          )
                        }
                      />
                      <button
                        type="button"
                        onClick={() => setFaqs((arr) => arr.filter((_, j) => j !== i))}
                        className="size-8 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                        aria-label="Remover"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>

                    {isOpen && (
                      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/60 bg-background/40">
                        <Input
                          placeholder="Pergunta"
                          value={f.question}
                          maxLength={300}
                          onChange={(e) =>
                            setFaqs((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)),
                            )
                          }
                        />
                        <Textarea
                          placeholder="Resposta"
                          value={f.answer}
                          maxLength={3000}
                          rows={3}
                          onChange={(e) =>
                            setFaqs((arr) =>
                              arr.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)),
                            )
                          }
                        />
                        <div className="space-y-1.5">
                          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                            Categorias do guia
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {FAQ_TAGS.map((t) => {
                              const active = f.tags.includes(t.value);
                              return (
                                <button
                                  key={t.value}
                                  type="button"
                                  onClick={() =>
                                    setFaqs((arr) =>
                                      arr.map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              tags: active
                                                ? x.tags.filter((tg) => tg !== t.value)
                                                : [...x.tags, t.value],
                                            }
                                          : x,
                                      ),
                                    )
                                  }
                                  className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${active ? "bg-accent text-accent-foreground border-accent" : "bg-background border-border text-muted-foreground hover:border-accent/50"}`}
                                >
                                  {t.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setFaqs((arr) => [...arr, { question: "", answer: "", tags: [], scope_property_id: defaultScope }])
              }

              className="rounded-full"
            >
              <Plus className="size-4 mr-1.5" /> Nova pergunta
            </Button>
            <Button onClick={handleSaveFaqs} disabled={savingFaqs || !canLibrary} title={!canLibrary ? "Sem permissão para editar a biblioteca" : undefined} className="rounded-full">
              {savingFaqs ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="size-4 mr-1.5" />
              )}
              Salvar FAQ
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="knowledge" className="space-y-4">
          <AiPlanLock locked={aiLocked}>
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card/40 p-4">
                <p className="text-sm text-muted-foreground">
                  Blocos de <strong>informação factual</strong> que a IA usa em todos os guias.
                  Ex.: política de cancelamento, regras gerais, horários padrão, contatos
                  recorrentes. Para definir <em>como</em> a IA fala, use a aba{" "}
                  <strong>Comportamento da IA</strong>.
                </p>
              </div>

              {knowledge.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nenhum bloco cadastrado ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {knowledge.map((k, i) => {
                    if (!matchesScope(k.scope_property_id)) return null;
                    const isOpen = openKnow.has(i) || !k.id;
                    return (
                      <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
                        <div className="flex items-center gap-2 p-3">
                          <button
                            type="button"
                            onClick={() => k.id && toggleKnow(i)}
                            className="flex-1 min-w-0 flex items-center gap-2 text-left"
                            aria-expanded={isOpen}
                          >
                            <ChevronDown
                              className={`size-4 text-muted-foreground shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
                            />
                            <span className="flex-1 min-w-0 truncate text-sm font-medium">
                              {k.title.trim() || (
                                <span className="text-muted-foreground italic">Novo bloco…</span>
                              )}
                            </span>
                            {!k.enabled && (
                              <span className="text-[10px] uppercase tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-full shrink-0">
                                Off
                              </span>
                            )}
                          </button>
                          <ScopeBadge
                            value={k.scope_property_id}
                            properties={properties}
                            disabled={aiLocked}
                            onChange={(v) =>
                              setKnowledge((arr) =>
                                arr.map((x, j) => (j === i ? { ...x, scope_property_id: v } : x)),
                              )
                            }
                          />
                          <button
                            type="button"
                            disabled={aiLocked}
                            onClick={() => setKnowledge((arr) => arr.filter((_, j) => j !== i))}
                            className="size-8 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-40"
                            aria-label="Remover"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>

                        {isOpen && (
                          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/60 bg-background/40">
                            <Input
                              placeholder="Título (ex.: política de cancelamento)"
                              value={k.title}
                              maxLength={200}
                              disabled={aiLocked}
                              onChange={(e) =>
                                setKnowledge((arr) =>
                                  arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                                )
                              }
                            />
                            <Textarea
                              placeholder="Conteúdo factual que a IA pode usar como contexto"
                              value={k.body}
                              maxLength={5000}
                              rows={5}
                              disabled={aiLocked}
                              onChange={(e) =>
                                setKnowledge((arr) =>
                                  arr.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                                )
                              }
                            />
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={k.enabled}
                                disabled={aiLocked}
                                onCheckedChange={(v) =>
                                  setKnowledge((arr) =>
                                    arr.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                                  )
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                {k.enabled ? "Ativo na IA" : "Desativado"}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  disabled={aiLocked}
                  onClick={() =>
                    setKnowledge((arr) => [...arr, { title: "", body: "", enabled: true, scope_property_id: defaultScope }])
                  }

                  className="rounded-full"
                >
                  <Plus className="size-4 mr-1.5" /> Novo bloco
                </Button>
                <Button onClick={handleSaveKnow} disabled={savingKnow || aiLocked || !canTrain} title={!canTrain ? "Sem permissão para ensinar a IA" : undefined} className="rounded-full">
                  {savingKnow ? (
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="size-4 mr-1.5" />
                  )}
                  Salvar conhecimento
                </Button>
              </div>
            </div>
          </AiPlanLock>
        </TabsContent>

        <TabsContent value="behavior" className="space-y-4">
          <AiPlanLock locked={aiLocked}>
            <div className="space-y-4">
              <div className="rounded-2xl border border-border bg-card/40 p-4">
                <p className="text-sm text-muted-foreground">
                  Defina aqui <strong>como</strong> a IA deve se comportar: tom de voz, postura,
                  estilo, prioridades, padrões de resposta. Esses blocos são separados das
                  informações factuais e guiam a personalidade da assistente em todos os seus guias.
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Dica: aprendizados criados a partir de respostas marcadas como ineficazes em{" "}
                  <em>Engajamento → Conversas</em> aparecem aqui automaticamente.
                </p>
              </div>

              {behavior.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Nenhuma regra de comportamento cadastrada ainda.
                </p>
              ) : (
                <div className="space-y-3">
                  {behavior.map((b, i) => {
                    if (!matchesScope(b.scope_property_id)) return null;
                    return (
                    <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 space-y-3">
                          <Input
                            placeholder="Título (ex.: sempre confirme antes de recomendar)"
                            value={b.title}
                            maxLength={200}
                            disabled={aiLocked}
                            onChange={(e) =>
                              setBehavior((arr) =>
                                arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                              )
                            }
                          />
                          <Textarea
                            placeholder="Como a IA deve se comportar / responder"
                            value={b.body}
                            maxLength={5000}
                            rows={5}
                            disabled={aiLocked}
                            onChange={(e) =>
                              setBehavior((arr) =>
                                arr.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                              )
                            }
                          />
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={b.enabled}
                                disabled={aiLocked}
                                onCheckedChange={(v) =>
                                  setBehavior((arr) =>
                                    arr.map((x, j) => (j === i ? { ...x, enabled: v } : x)),
                                  )
                                }
                              />
                              <span className="text-xs text-muted-foreground">
                                {b.enabled ? "Ativa" : "Desativada"}
                              </span>
                            </div>
                            <ScopeBadge
                              value={b.scope_property_id}
                              properties={properties}
                              disabled={aiLocked}
                              onChange={(v) =>
                                setBehavior((arr) =>
                                  arr.map((x, j) => (j === i ? { ...x, scope_property_id: v } : x)),
                                )
                              }
                            />
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={aiLocked}
                          onClick={() => setBehavior((arr) => arr.filter((_, j) => j !== i))}
                          className="size-8 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0 disabled:opacity-40"
                          aria-label="Remover"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    );
                  })}

                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  disabled={aiLocked}
                  onClick={() =>
                    setBehavior((arr) => [...arr, { title: "", body: "", enabled: true, scope_property_id: defaultScope }])
                  }

                  className="rounded-full"
                >
                  <Plus className="size-4 mr-1.5" /> Nova regra
                </Button>
                <Button onClick={handleSaveBeh} disabled={savingBeh || aiLocked || !canTrain} title={!canTrain ? "Sem permissão para ensinar a IA" : undefined} className="rounded-full">
                  {savingBeh ? (
                    <Loader2 className="size-4 mr-1.5 animate-spin" />
                  ) : (
                    <Save className="size-4 mr-1.5" />
                  )}
                  Salvar comportamento
                </Button>
              </div>
            </div>
          </AiPlanLock>
        </TabsContent>
      </Tabs>

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Aplicar perguntas a guias</DialogTitle>
            <DialogDescription>
              Selecione os guias que vão receber as {selectedFaqIds.size} pergunta{selectedFaqIds.size > 1 ? "s" : ""} selecionada{selectedFaqIds.size > 1 ? "s" : ""}.
              Perguntas com o mesmo enunciado já existentes no guia são ignoradas.
            </DialogDescription>
          </DialogHeader>

          <Input
            placeholder="Buscar por nome, endereço ou cidade…"
            value={applySearch}
            onChange={(e) => setApplySearch(e.target.value)}
            className="mb-2"
          />

          {(() => {
            const list = propsQuery.data ?? [];
            const q = applySearch.trim().toLowerCase();
            const filtered = q
              ? list.filter((p) =>
                  [p.name, p.address, p.city]
                    .filter(Boolean)
                    .some((s) => String(s).toLowerCase().includes(q)),
                )
              : list;
            const allSelected =
              filtered.length > 0 && filtered.every((p) => applyTargets.has(p.id));
            return (
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) =>
                      setApplyTargets((s) => {
                        const ns = new Set(s);
                        if (v) filtered.forEach((p) => ns.add(p.id));
                        else filtered.forEach((p) => ns.delete(p.id));
                        return ns;
                      })
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {applyTargets.size > 0
                      ? `${applyTargets.size} selecionado${applyTargets.size > 1 ? "s" : ""}`
                      : "Selecionar todos visíveis"}
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto rounded-xl border border-border divide-y divide-border">
                  {filtered.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      Nenhum guia encontrado.
                    </p>
                  ) : (
                    filtered.map((p) => {
                      const checked = applyTargets.has(p.id);
                      return (
                        <label
                          key={p.id}
                          className="flex items-center gap-3 p-3 hover:bg-secondary/40 cursor-pointer"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(v) =>
                              setApplyTargets((s) => {
                                const ns = new Set(s);
                                if (v) ns.add(p.id);
                                else ns.delete(p.id);
                                return ns;
                              })
                            }
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate">{p.name}</p>
                            {(p.address || p.city) && (
                              <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                                <MapPin className="size-3" />
                                {p.address || p.city}
                              </p>
                            )}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApplyOpen(false)}
              className="rounded-full"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleApply}
              disabled={applying || applyTargets.size === 0}
              className="rounded-full"
            >
              {applying ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Send className="size-4 mr-1.5" />
              )}
              Aplicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
