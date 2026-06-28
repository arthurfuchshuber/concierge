import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import React, { useState } from "react";
import { RecGroup, PlaceAutocomplete, type RecItem } from "@/routes/_authenticated/admin.properties.$id";
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
  adminListPublishedGuidesForSigma, adminApplySigmaPackToProperty,
} from "@/lib/sigma-recommendations.functions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cityKey as makeCityKey } from "@/lib/city-key";
import { ArrowLeft, Plus, Trash2, Loader2, Eye, EyeOff, MapPin, Link2, HelpCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { friendlyErrorMessage } from "@/lib/friendly-error";

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
    } catch (e) { toast.error(friendlyErrorMessage(e)); }
  }

  return (
    <div className="container mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <Link to="/admin/recomendacoes-sigma" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3.5" /> Voltar
        </Link>
        <div className="flex items-center gap-2">
          <ApplySigmaToGuideButton cityKey={cityKey} disabled={!pack.is_published} />
          <Button variant="outline" onClick={togglePublish} className="rounded-full">
            {pack.is_published ? <><EyeOff className="size-3.5" /> Despublicar</> : <><Eye className="size-3.5" /> Publicar</>}
          </Button>
        </div>
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
          <TabsTrigger value="mkt" className="rounded-full"><Link2 className="size-3.5" /> Marketplace ({marketplace.length})</TabsTrigger>
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

function ApplySigmaToGuideButton({ cityKey, disabled }: { cityKey: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const listFn = useServerFn(adminListPublishedGuidesForSigma);
  const applyFn = useServerFn(adminApplySigmaPackToProperty);
  const q = useQuery({
    queryKey: ["sigma-published-guides", cityKey],
    queryFn: () => listFn({ data: { city_key: cityKey } }),
    enabled: open,
  });

  async function apply(propertyId: string) {
    setApplyingId(propertyId);
    try {
      await applyFn({ data: { city_key: cityKey, property_id: propertyId } });
      toast.success("Recomendação SigmaGuide aplicada ao guia.");
      void q.refetch();
    } catch (e) {
      toast.error(friendlyErrorMessage(e, "Não foi possível aplicar agora."));
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled} className="rounded-full" title={disabled ? "Publique antes de aplicar" : "Aplicar em um Guia"}>
        <Send className="size-3.5" /> Aplicar em um Guia
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Aplicar em um Guia</DialogTitle>
            <DialogDescription>
              Escolha um guia publicado/ativo desta cidade. O conteúdo SigmaGuide substituirá pontos da cidade e marketplace, mantendo FAQs manuais editáveis.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
            {q.isLoading && <div className="text-sm text-muted-foreground py-6">Carregando guias…</div>}
            {!q.isLoading && (q.data ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground py-6">Nenhum guia publicado/ativo encontrado para esta cidade.</div>
            )}
            {(q.data ?? []).map((g) => {
              const sameCity = makeCityKey(g.city ?? "") === cityKey;
              return (
                <div key={g.id} className="rounded-xl border border-border/60 bg-card/60 p-3 flex items-center gap-3">
                  {g.hero_image_url ? <img src={g.hero_image_url} alt="" className="size-11 rounded-lg object-cover" /> : <div className="size-11 rounded-lg bg-muted grid place-items-center"><MapPin className="size-4 text-muted-foreground" /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-medium truncate">{g.name}</p>
                      {g.sigma_pack_city_key === cityKey && <Badge variant="secondary" className="shrink-0">Já aplicado</Badge>}
                      {!sameCity && <Badge variant="outline" className="shrink-0">Outra cidade</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{g.city}{g.state ? `/${g.state}` : ""} · {g.owner_email ?? "sem e-mail"}</p>
                  </div>
                  <Button size="sm" className="rounded-full" onClick={() => apply(g.id)} disabled={!sameCity || applyingId === g.id}>
                    {applyingId === g.id && <Loader2 className="size-3.5 animate-spin" />} Aplicar
                  </Button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---- Tabs ----
function RecsTab({ cityKey, items, refresh }: { cityKey: string; items: Awaited<ReturnType<typeof adminGetSigmaPack>>["recs"]; refresh: () => void }) {
  const addFn = useServerFn(addSigmaRec);
  const updFn = useServerFn(updateSigmaRec);
  const delFn = useServerFn(deleteSigmaRecs);

  // server rows -> RecItem (mesmo formato usado dentro do guia)
  const serverItems: RecItem[] = React.useMemo(
    () => items.map((r) => ({
      scope: "city" as const,
      type: r.type || "other",
      name: r.name || "",
      category: r.category ?? null,
      rating: r.rating ?? null,
      user_ratings_total: r.user_ratings_total ?? null,
      distance_text: null,
      distance_meters: null,
      drive_minutes: null,
      walk_minutes: null,
      opening_hours: r.opening_hours ?? null,
      note: r.note ?? null,
      image_url: r.image_url ?? null,
      maps_url: r.maps_url ?? null,
      place_id: r.place_id ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
      _dbId: r.id,
    })),
    [items],
  );

  const [localItems, setLocalItems] = React.useState<RecItem[]>(serverItems);
  React.useEffect(() => { setLocalItems(serverItems); }, [serverItems]);

  const pendingUpdates = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const inflightAdds = React.useRef<Set<string>>(new Set());

  function scheduleUpdate(id: string, patch: Record<string, unknown>) {
    const map = pendingUpdates.current;
    const existing = map.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      map.delete(id);
      updFn({ data: { id, patch } }).then(refresh).catch((e) => toast.error(friendlyErrorMessage(e, "Não foi possível salvar agora.")));
    }, 700);
    map.set(id, t);
  }

  function handleChange(next: RecItem[]) {
    const prev = localItems;
    setLocalItems(next);

    // Exclusões
    const prevIds = new Set(prev.map((p) => p._dbId).filter(Boolean) as string[]);
    const nextIds = new Set(next.map((p) => p._dbId).filter(Boolean) as string[]);
    const deletedIds = [...prevIds].filter((id) => !nextIds.has(id));
    if (deletedIds.length) {
      delFn({ data: { ids: deletedIds } }).then(refresh).catch((e) => toast.error(friendlyErrorMessage(e, "Não foi possível excluir agora.")));
    }

    // Adições — exige place_id (somente Google)
    const additions = next.filter((n) => !n._dbId && n.place_id && n.name && n.name.trim().length > 0);
    for (const rec of additions) {
      const key = `pid:${rec.place_id}`;
      if (inflightAdds.current.has(key)) continue;
      inflightAdds.current.add(key);
      addFn({
        data: {
          city_key: cityKey,
          type: rec.type || "other",
          name: rec.name.trim(),
          category: rec.category || rec.type || "Outros",
          rating: rec.rating ?? null,
          user_ratings_total: rec.user_ratings_total ?? null,
          note: rec.note ?? null,
          image_url: rec.image_url ?? null,
          maps_url: rec.maps_url ?? null,
          place_id: rec.place_id!,
          lat: rec.lat ?? null,
          lng: rec.lng ?? null,
          opening_hours: rec.opening_hours ?? null,
        },
      })
        .then(refresh)
        .catch((e) => toast.error(friendlyErrorMessage(e, "Não foi possível adicionar agora.")))
        .finally(() => inflightAdds.current.delete(key));
    }

    // Updates
    for (const n of next) {
      if (!n._dbId) continue;
      const before = prev.find((p) => p._dbId === n._dbId);
      if (!before) continue;
      const patch: Record<string, unknown> = {};
      if ((n.name ?? "") !== (before.name ?? "")) patch.name = n.name;
      if ((n.note ?? null) !== (before.note ?? null)) patch.note = n.note ?? null;
      if ((n.maps_url ?? null) !== (before.maps_url ?? null)) patch.maps_url = n.maps_url ?? null;
      if ((n.category ?? null) !== (before.category ?? null)) patch.category = n.category ?? null;
      if (Object.keys(patch).length) scheduleUpdate(n._dbId, patch);
    }
  }

  const existingPlaceIds = new Set(localItems.map((i) => i.place_id).filter((x): x is string => !!x));

  return (
    <div className="space-y-3">
      <PlaceAutocomplete
        scope="city"
        lat={null}
        lng={null}
        existingPlaceIds={existingPlaceIds}
        onSelect={(rec) => handleChange([...localItems, rec])}
      />
      <RecGroup
        title="Pontos da cidade"
        desc="Curadoria oficial SigmaGuide para esta cidade. Mesmo racional do guia: categorias expansivas, busca via Google, bloqueio de duplicidade."
        items={localItems}
        onChange={handleChange}
        scope="city"
        lat={null}
        lng={null}
        hideSearch
      />
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
    } catch (e) { toast.error(friendlyErrorMessage(e)); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
        <h3 className="text-sm font-medium">Adicionar link de marketplace</h3>
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
    } catch (e) { toast.error(friendlyErrorMessage(e)); }
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
