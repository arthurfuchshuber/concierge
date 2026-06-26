import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listAllSigmaPacks, createSigmaPack, deleteSigmaPack, updateSigmaPack,
} from "@/lib/sigma-recommendations.functions";
import { Star, Plus, Globe2, Users, MapPin, Eye, EyeOff, Trash2, Loader2, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/recomendacoes-sigma/")({
  component: SigmaPacksIndex,
});

type PackRow = Awaited<ReturnType<typeof listAllSigmaPacks>>[number];

function SigmaPacksIndex() {
  const qc = useQueryClient();
  const listFn = useServerFn(listAllSigmaPacks);
  const updateFn = useServerFn(updateSigmaPack);
  const deleteFn = useServerFn(deleteSigmaPack);

  const q = useQuery({ queryKey: ["sigma-packs"], queryFn: () => listFn() });
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState<PackRow | null>(null);

  const packs = q.data ?? [];
  const publishedCount = packs.filter((p) => p.is_published).length;
  const totalRecs = packs.reduce((s, p) => s + p.recs_count, 0);
  const totalAdoption = packs.reduce((s, p) => s + p.adoption_count, 0);

  async function togglePublish(p: PackRow) {
    try {
      await updateFn({ data: { city_key: p.city_key, patch: { is_published: !p.is_published } } });
      toast.success(p.is_published ? "Despublicado" : "Publicado");
      qc.invalidateQueries({ queryKey: ["sigma-packs"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }
  async function doDelete() {
    if (!confirmDel) return;
    try {
      await deleteFn({ data: { city_key: confirmDel.city_key } });
      toast.success("Cidade removida");
      setConfirmDel(null);
      qc.invalidateQueries({ queryKey: ["sigma-packs"] });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Erro"); }
  }

  return (
    <div className="container mx-auto max-w-6xl px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl flex items-center gap-2">
            <Star className="size-6 text-amber-400" /> Recomendações
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            Curadoria por cidade que qualquer anfitrião pode importar em 1 clique para o guia dele.
          </p>
        </div>
        <Button onClick={() => setNewOpen(true)} className="rounded-full">
          <Plus className="size-4" /> Nova cidade
        </Button>
      </div>

      {/* Dashboard cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Globe2 className="size-4" />} label="Cidades publicadas" value={publishedCount} />
        <StatCard icon={<MapPin className="size-4" />} label="Pontos curados" value={totalRecs} />
        <StatCard icon={<Users className="size-4" />} label="Guias usando" value={totalAdoption} />
        <StatCard icon={<Star className="size-4 text-amber-400" />} label="Total de cidades" value={packs.length} />
      </div>

      {/* City cards */}
      {q.isLoading ? (
        <div className="text-sm text-muted-foreground py-12 text-center">Carregando…</div>
      ) : packs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center space-y-3">
          <div className="size-12 rounded-full bg-amber-500/10 grid place-items-center mx-auto">
            <Star className="size-6 text-amber-400" />
          </div>
          <p className="text-sm text-muted-foreground">Nenhuma cidade ainda. Comece adicionando a primeira.</p>
          <Button onClick={() => setNewOpen(true)}>Criar cidade</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packs.map((p) => (
            <article key={p.id} className="group rounded-2xl border border-border/60 bg-card overflow-hidden hover:border-border transition">
              <div className="aspect-[16/9] relative bg-gradient-to-br from-amber-500/20 via-rose-500/10 to-fuchsia-500/20">
                {p.cover_url && <img src={p.cover_url} alt={p.city_label} className="absolute inset-0 size-full object-cover" />}
                <div className="absolute top-2 right-2">
                  <span className={`text-[10px] uppercase tracking-wider font-medium px-2 py-1 rounded-full backdrop-blur ${
                    p.is_published ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30" : "bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30"
                  }`}>
                    {p.is_published ? "Publicado" : "Rascunho"}
                  </span>
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <h3 className="font-display text-lg leading-tight">{p.city_label}</h3>
                  {p.country && <p className="text-xs text-muted-foreground mt-0.5">{p.country}</p>}
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <Metric label="Pontos" value={p.recs_count} />
                  <Metric label="Marketplace" value={p.marketplace_count} />
                  <Metric label="FAQs" value={p.faqs_count} />
                  <Metric label="Guias" value={p.adoption_count} highlight />
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  <Link
                    to="/admin/recomendacoes-sigma/$cityKey"
                    params={{ cityKey: p.city_key }}
                    className="flex-1 inline-flex items-center justify-center gap-1 h-9 px-3 rounded-full text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                  >
                    Editar <ArrowRight className="size-3.5" />
                  </Link>
                  <Button size="sm" variant="ghost" className="h-9 w-9 p-0 rounded-full"
                    onClick={() => togglePublish(p)} title={p.is_published ? "Despublicar" : "Publicar"}>
                    {p.is_published ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="h-9 w-9 p-0 rounded-full text-rose-400 hover:text-rose-300"
                    onClick={() => setConfirmDel(p)} title="Excluir">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {newOpen && <NewCityDialog existingPacks={packs} onClose={() => setNewOpen(false)} onCreated={() => { setNewOpen(false); qc.invalidateQueries({ queryKey: ["sigma-packs"] }); }} />}
      <AlertDialog open={!!confirmDel} onOpenChange={(o) => { if (!o) setConfirmDel(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir {confirmDel?.city_label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove a cidade e todos os pontos, FAQs e links de marketplace dela. Guias que estavam usando esta recomendação serão desvinculados (o conteúdo original deles é preservado).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={doDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <div className="text-3xl font-display mt-2 tabular-nums">{value}</div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`rounded-lg py-1.5 ${highlight ? "bg-amber-500/10 ring-1 ring-amber-400/20" : "bg-muted/30"}`}>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
    </div>
  );
}

function NewCityDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const createFn = useServerFn(createSigmaPack);
  const [label, setLabel] = useState("");
  const [country, setCountry] = useState("Brasil");
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await createFn({ data: { city_label: label.trim(), country: country.trim() || null } });
      toast.success("Cidade criada");
      onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao criar");
    } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nova cidade SigmaGuide</DialogTitle>
          <DialogDescription>Comece em rascunho — publique quando estiver pronta para uso.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Cidade</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Foz do Iguaçu" autoFocus />
          </div>
          <div>
            <Label className="text-xs">País</Label>
            <Input value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !label.trim()}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
