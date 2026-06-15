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
import { Plus, Trash2, Save, HelpCircle, BrainCircuit, Loader2, Send, MapPin } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/biblioteca")({
  component: BibliotecaPage,
});

type FaqItem = {
  id?: string | null;
  question: string;
  answer: string;
  tags: ("chegada" | "saida" | "residencia" | "explore")[];
};
type KnowledgeItem = {
  id?: string | null;
  title: string;
  body: string;
  enabled: boolean;
};

const FAQ_TAGS: { value: FaqItem["tags"][number]; label: string }[] = [
  { value: "chegada", label: "Chegada" },
  { value: "saida", label: "Saída" },
  { value: "residencia", label: "Residência" },
  { value: "explore", label: "Explore" },
];

function BibliotecaPage() {
  const loadFaqs = useServerFn(listHostFaqs);
  const persistFaqs = useServerFn(saveHostFaqs);
  const loadKnow = useServerFn(listHostKnowledge);
  const persistKnow = useServerFn(saveHostKnowledge);

  const faqQuery = useQuery({ queryKey: ["host-faqs"], queryFn: () => loadFaqs() });
  const knowQuery = useQuery({ queryKey: ["host-knowledge"], queryFn: () => loadKnow() });

  const [faqs, setFaqs] = useState<FaqItem[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [savingFaqs, setSavingFaqs] = useState(false);
  const [savingKnow, setSavingKnow] = useState(false);

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
        })),
      );
    }
  }, [knowQuery.data]);

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

  return (
    <div className="px-6 lg:px-10 py-8 lg:py-10 max-w-5xl mx-auto w-full">
      <div className="mb-8">
        <h1 className="font-serif text-3xl md:text-4xl leading-tight">Biblioteca</h1>
        <p className="text-sm text-muted-foreground mt-1.5">
          Reúse perguntas e contexto entre todos os seus guias.
        </p>
      </div>

      <Tabs defaultValue="faqs" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="faqs" className="gap-2">
            <HelpCircle className="size-4" /> FAQ global
          </TabsTrigger>
          <TabsTrigger value="knowledge" className="gap-2">
            <BrainCircuit className="size-4" /> Conhecimento da IA
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
              {faqs.map((f, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-3">
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
                    <button
                      type="button"
                      onClick={() => setFaqs((arr) => arr.filter((_, j) => j !== i))}
                      className="size-8 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remover"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setFaqs((arr) => [...arr, { question: "", answer: "", tags: [] }])
              }
              className="rounded-full"
            >
              <Plus className="size-4 mr-1.5" /> Nova pergunta
            </Button>
            <Button onClick={handleSaveFaqs} disabled={savingFaqs} className="rounded-full">
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
          <div className="rounded-2xl border border-border bg-card/40 p-4">
            <p className="text-sm text-muted-foreground">
              Blocos de contexto que sua IA usa em todos os guias. Ex: política de cancelamento,
              forma de atendimento, regras gerais que valem para todos os imóveis.
            </p>
          </div>

          {knowledge.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum bloco cadastrado ainda.
            </p>
          ) : (
            <div className="space-y-3">
              {knowledge.map((k, i) => (
                <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 space-y-3">
                      <Input
                        placeholder="Título (ex.: política de cancelamento)"
                        value={k.title}
                        maxLength={200}
                        onChange={(e) =>
                          setKnowledge((arr) =>
                            arr.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)),
                          )
                        }
                      />
                      <Textarea
                        placeholder="Conteúdo que a IA pode usar como contexto"
                        value={k.body}
                        maxLength={5000}
                        rows={5}
                        onChange={(e) =>
                          setKnowledge((arr) =>
                            arr.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)),
                          )
                        }
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={k.enabled}
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
                    </div>
                    <button
                      type="button"
                      onClick={() => setKnowledge((arr) => arr.filter((_, j) => j !== i))}
                      className="size-8 grid place-items-center rounded-full hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                      aria-label="Remover"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              onClick={() =>
                setKnowledge((arr) => [...arr, { title: "", body: "", enabled: true }])
              }
              className="rounded-full"
            >
              <Plus className="size-4 mr-1.5" /> Novo bloco
            </Button>
            <Button onClick={handleSaveKnow} disabled={savingKnow} className="rounded-full">
              {savingKnow ? (
                <Loader2 className="size-4 mr-1.5 animate-spin" />
              ) : (
                <Save className="size-4 mr-1.5" />
              )}
              Salvar conhecimento
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
