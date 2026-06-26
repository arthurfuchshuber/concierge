import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  adminGetSigmaPack, updateSigmaPack,
  addSigmaRec, updateSigmaRec, deleteSigmaRecs,
  addSigmaMarketplace, updateSigmaMarketplace, deleteSigmaMarketplace,
  addSigmaFaq, updateSigmaFaq, deleteSigmaFaq,
} from "@/lib/sigma-recommendations.functions";
import { ArrowLeft, Plus, Trash2, Loader2, Eye, EyeOff, MapPin, Link2, HelpCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/recomendacoes-sigma/$cityKey")({
  component: SigmaPackEditor,
});

function SigmaPackEditor() {
  const { cityKey } = Route.useParams();
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetSigmaPack);
  const updatePackFn = useServerFn(updateSigmaPack);

  const q = useQuery({
    queryKey: ["sigma-pack", cityKey],
    queryFn: () => getFn({ data: { city_key: cityKey } }),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["sigma-pack", cityKey] });

  if (q.isLoading) return <div className="p-8 text-muted-foreground text-sm">Carregando…</div>;
  if (!q.data) return <div className="p-8 text-muted-foreground text-sm">Cidade não encontrada.</div>;

  const { pack, recs, marketplace, faqs } = q.data;

  async function togglePublish() {
    try {
      await updatePackFn({ data: { city_key: cityKey, patch: { is_published: !pack.is_published } } });
      toast.success(pack.is_published ? "Despublicado" : "Publicado");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/admin/recomendacoes-sigma" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        <Button variant="outline" onClick={togglePublish} className="rounded-full">
          {pack.is_published ? <><EyeOff className="size-3.5" /> Despublicar</> : <><Eye className="size-3.5" /> Publicar</>}
        </Button>
      </div>

      <header className="flex items-end gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl">{pack.city_label}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            {pack.country ?? "—"} · {pack.is_published ? "Publicado" : "Rascunho"}
          </p>
        </div>
      </header>

      <Tabs defaultValue="recs">
        <TabsList className="rounded-full">
          <TabsTrigger value="recs" className="rounded-full"><MapPin className="size-3.5" /> Pontos ({recs.length})</TabsTrigger>
          <TabsTrigger value="mkt" className="rounded-full"><Link2 className="size-3.5" /> Reservas ({marketplace.length})</TabsTrigger>
          <TabsTrigger value="faqs" className="rounded-full"><HelpCircle className="size-3.5" /> FAQs ({faqs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="recs" className="mt-4">
          <RecsTab cityKey={cityKey} items={recs} refresh={refresh} />
        </TabsContent>
        <TabsContent value="mkt" className="mt-4">
          <MarketplaceTab cityKey={cityKey} items={marketplace} refresh={refresh} />
        </TabsContent>
        <TabsContent value="faqs" className="mt-4">
          <FaqsTab cityKey={cityKey} items={faqs} refresh={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---- Tabs ----
function RecsTab({ cityKey, items, refresh }: { cityKey: string; items: Awaited<ReturnType<typeof adminGetSigmaPack>>["recs"]; refresh: () => void }) {
  const addFn = useServerFn(addSigmaRec);
  const delFn = useServerFn(deleteSigmaRecs);
  const updFn = useServerFn(updateSigmaRec);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [mapsUrl, setMapsUrl] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await addFn({
        data: {
          city_key: cityKey, type: "other", name: name.trim(),
          category: category.trim() || null, maps_url: mapsUrl.trim() || null,
        },
      });
      setName(""); setCategory(""); setMapsUrl("");
      toast.success("Ponto adicionado");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  async function del(id: string) {
    try { await delFn({ data: { ids: [id] } }); toast.success("Removido"); refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">Adicionar ponto</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex: Cataratas do Iguaçu)" />
          <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Categoria (ex: Experiências)" />
          <Input value={mapsUrl} onChange={(e) => setMapsUrl(e.target.value)} placeholder="Link Google Maps (opcional)" />
        </div>
        <div className="flex justify-end">
          <Button onClick={add} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Adicionar
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum ponto ainda.</p>
        ) : items.map((r) => (
          <div key={r.id} className="rounded-xl border border-border/60 bg-card p-3 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <input
                defaultValue={r.name}
                onBlur={(e) => { if (e.target.value !== r.name) updFn({ data: { id: r.id, patch: { name: e.target.value } } }).then(refresh).catch(() => {}); }}
                className="w-full bg-transparent text-sm font-medium outline-none"
              />
              <input
                defaultValue={r.category ?? ""}
                placeholder="Sem categoria"
                onBlur={(e) => { if (e.target.value !== (r.category ?? "")) updFn({ data: { id: r.id, patch: { category: e.target.value || null } } }).then(refresh).catch(() => {}); }}
                className="w-full bg-transparent text-[11px] text-muted-foreground outline-none"
              />
            </div>
            <Button size="sm" variant="ghost" className="text-rose-400 hover:text-rose-300" onClick={() => del(r.id)}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function MarketplaceTab({ cityKey, items, refresh }: { cityKey: string; items: Awaited<ReturnType<typeof adminGetSigmaPack>>["marketplace"]; refresh: () => void }) {
  const addFn = useServerFn(addSigmaMarketplace);
  const updFn = useServerFn(updateSigmaMarketplace);
  const delFn = useServerFn(deleteSigmaMarketplace);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!label.trim() || !url.trim()) return;
    setSaving(true);
    try {
      await addFn({ data: { city_key: cityKey, label: label.trim(), url: url.trim(), description: desc.trim() || null } });
      setLabel(""); setUrl(""); setDesc("");
      toast.success("Link adicionado");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">Adicionar reserva/marketplace</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome (ex: Airbnb Experiences)" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
        </div>
        <Textarea value={desc} onChange={(e) => setDesc(e.target.value.slice(0, 200))} placeholder="Descrição curta (100–200 caracteres)" />
        <div className="flex justify-end">
          <Button onClick={add} disabled={saving || !label.trim() || !url.trim()}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Adicionar
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhum link ainda.</p>
        ) : items.map((m) => (
          <div key={m.id} className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input
                defaultValue={m.label}
                onBlur={(e) => { if (e.target.value !== m.label) updFn({ data: { id: m.id, patch: { label: e.target.value } } }).then(refresh).catch(() => {}); }}
                className="flex-1 bg-transparent text-sm font-medium outline-none"
              />
              <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => delFn({ data: { id: m.id } }).then(refresh).catch(() => {})}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <input
              defaultValue={m.url}
              onBlur={(e) => { if (e.target.value !== m.url) updFn({ data: { id: m.id, patch: { url: e.target.value } } }).then(refresh).catch(() => {}); }}
              className="w-full bg-transparent text-xs text-blue-300 outline-none"
            />
            <textarea
              defaultValue={m.description ?? ""}
              placeholder="Descrição"
              onBlur={(e) => { if (e.target.value !== (m.description ?? "")) updFn({ data: { id: m.id, patch: { description: e.target.value || null } } }).then(refresh).catch(() => {}); }}
              className="w-full bg-transparent text-xs text-muted-foreground outline-none resize-none"
              rows={2}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function FaqsTab({ cityKey, items, refresh }: { cityKey: string; items: Awaited<ReturnType<typeof adminGetSigmaPack>>["faqs"]; refresh: () => void }) {
  const addFn = useServerFn(addSigmaFaq);
  const updFn = useServerFn(updateSigmaFaq);
  const delFn = useServerFn(deleteSigmaFaq);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [saving, setSaving] = useState(false);

  async function add() {
    if (!question.trim() || !answer.trim()) return;
    setSaving(true);
    try {
      await addFn({ data: { city_key: cityKey, question: question.trim(), answer: answer.trim(), tags: [] } });
      setQuestion(""); setAnswer("");
      toast.success("Pergunta adicionada");
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">Nova pergunta</h3>
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Pergunta" />
        <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Resposta" rows={3} />
        <div className="flex justify-end">
          <Button onClick={add} disabled={saving || !question.trim() || !answer.trim()}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Adicionar
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Nenhuma FAQ ainda.</p>
        ) : items.map((f) => (
          <div key={f.id} className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
            <div className="flex items-start gap-2">
              <input
                defaultValue={f.question}
                onBlur={(e) => { if (e.target.value !== f.question) updFn({ data: { id: f.id, patch: { question: e.target.value } } }).then(refresh).catch(() => {}); }}
                className="flex-1 bg-transparent text-sm font-medium outline-none"
              />
              <Button size="sm" variant="ghost" className="text-rose-400" onClick={() => delFn({ data: { id: f.id } }).then(refresh).catch(() => {})}>
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <textarea
              defaultValue={f.answer}
              onBlur={(e) => { if (e.target.value !== f.answer) updFn({ data: { id: f.id, patch: { answer: e.target.value } } }).then(refresh).catch(() => {}); }}
              className="w-full bg-transparent text-xs text-muted-foreground outline-none resize-none"
              rows={3}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
