import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  useTaxonomy,
  TAXONOMY_QUERY_KEY,
} from "@/components/admin/TagPicker";
import {
  createPoiCategory,
  updatePoiCategory,
  deletePoiCategory,
  createPoiTag,
  updatePoiTag,
  deletePoiTag,
  mergePoiCategories,
  type PoiTag,
  type PoiCategory,
} from "@/lib/poi-taxonomy.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, ChevronDown, Lock, Pencil, Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/taxonomia")({
  component: TaxonomyPage,
});

function TaxonomyPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useTaxonomy();
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({});
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newTagInCat, setNewTagInCat] = useState<PoiCategory | null>(null);
  const [editTag, setEditTag] = useState<PoiTag | null>(null);
  const [editCat, setEditCat] = useState<PoiCategory | null>(null);

  const createCatFn = useServerFn(createPoiCategory);
  const updateCatFn = useServerFn(updatePoiCategory);
  const deleteCatFn = useServerFn(deletePoiCategory);
  const createTagFn = useServerFn(createPoiTag);
  const updateTagFn = useServerFn(updatePoiTag);
  const deleteTagFn = useServerFn(deletePoiTag);

  const invalidate = () => qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });

  const groups = (data?.categories ?? []).map((c) => ({
    cat: c,
    tags: (data?.tags ?? []).filter((t) => t.category_id === c.id),
  }));

  return (
    <div className="container mx-auto max-w-3xl p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="size-3.5" /> Painel
        </Link>
        <Button size="sm" onClick={() => setNewCatOpen(true)}>
          <Plus className="size-3.5" /> Nova categoria
        </Button>
      </div>

      <div>
        <h1 className="text-xl font-semibold">Categorias & Tags</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Organize como os pontos são classificados nos guias. Tags padrão (com cadeado) podem ser renomeadas — mas não excluídas — porque a IA usa o identificador interno para classificar pontos do Google Maps.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <div className="space-y-2">
          {groups.map(({ cat, tags }) => {
            const open = openCats[cat.id] ?? true;
            return (
              <div key={cat.id} className="rounded-xl border border-border/60 overflow-hidden">
                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-muted/20">
                  <button
                    type="button"
                    onClick={() => setOpenCats((s) => ({ ...s, [cat.id]: !open }))}
                    className="flex-1 flex items-center gap-2 text-left"
                  >
                    <ChevronDown className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`} />
                    <span className="text-sm font-medium">{cat.label}</span>
                    {cat.is_protected && <Lock className="size-3 text-muted-foreground/60" />}
                    <span className="text-[11px] text-muted-foreground">({tags.length})</span>
                  </button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditCat(cat)}>
                    <Pencil className="size-3" />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNewTagInCat(cat)}>
                    <Plus className="size-3" /> tag
                  </Button>
                </div>
                {open && (
                  <div className="divide-y divide-border/40">
                    {tags.length === 0 ? (
                      <div className="px-3.5 py-3 text-xs text-muted-foreground">Nenhuma tag nesta categoria.</div>
                    ) : (
                      tags.map((tag) => (
                        <div key={tag.id} className="px-3.5 py-2 flex items-center gap-2">
                          <span className="text-sm flex-1 truncate">{tag.label}</span>
                          <code className="text-[10px] text-muted-foreground/70">{tag.slug}</code>
                          {tag.is_protected && <Lock className="size-3 text-muted-foreground/60" />}
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditTag(tag)}>
                            <Pencil className="size-3" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {newCatOpen && (
        <SimpleNewDialog
          title="Nova categoria"
          placeholder="Ex: Aventura"
          onClose={() => setNewCatOpen(false)}
          onSave={async (label) => {
            await createCatFn({ data: { label } });
            toast.success("Categoria criada");
            setNewCatOpen(false);
            invalidate();
          }}
        />
      )}
      {newTagInCat && (
        <NewTagDialog
          categoryId={newTagInCat.id}
          categoryLabel={newTagInCat.label}
          onClose={() => setNewTagInCat(null)}
          onSave={async (payload) => {
            await createTagFn({ data: { ...payload, category_id: newTagInCat.id } });
            toast.success("Tag criada");
            setNewTagInCat(null);
            invalidate();
          }}
        />
      )}
      {editCat && (
        <EditCategoryDialog
          cat={editCat}
          onClose={() => setEditCat(null)}
          onSave={async (label) => {
            await updateCatFn({ data: { id: editCat.id, label } });
            toast.success("Categoria atualizada");
            setEditCat(null);
            invalidate();
          }}
          onDelete={async () => {
            try {
              await deleteCatFn({ data: { id: editCat.id } });
              toast.success("Excluída");
              setEditCat(null);
              invalidate();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro");
            }
          }}
        />
      )}
      {editTag && (
        <EditTagDialog
          tag={editTag}
          categories={data?.categories ?? []}
          onClose={() => setEditTag(null)}
          onSave={async (patch) => {
            await updateTagFn({ data: { id: editTag.id, ...patch } });
            toast.success("Tag atualizada");
            setEditTag(null);
            invalidate();
          }}
          onDelete={async () => {
            try {
              await deleteTagFn({ data: { id: editTag.id } });
              toast.success("Excluída");
              setEditTag(null);
              invalidate();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Erro");
            }
          }}
        />
      )}
    </div>
  );
}

function SimpleNewDialog({ title, placeholder, onClose, onSave }: {
  title: string; placeholder: string;
  onClose: () => void; onSave: (label: string) => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={placeholder} maxLength={60} />
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving || !label.trim()} onClick={async () => { setSaving(true); try { await onSave(label.trim()); } finally { setSaving(false); } }}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCategoryDialog({ cat, onClose, onSave, onDelete }: {
  cat: PoiCategory;
  onClose: () => void;
  onSave: (label: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [label, setLabel] = useState(cat.label);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Editar categoria</DialogTitle></DialogHeader>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
        {cat.is_protected && (
          <p className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
            <Lock className="size-3 mt-0.5" /> Categoria padrão — pode renomear, não pode excluir.
          </p>
        )}
        <DialogFooter className="flex sm:justify-between">
          {!cat.is_protected ? (
            <Button variant="destructive" size="sm" disabled={saving} onClick={async () => { setSaving(true); await onDelete(); setSaving(false); }}>
              <Trash2 className="size-3.5" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button disabled={saving || !label.trim()} onClick={async () => { setSaving(true); await onSave(label.trim()); setSaving(false); }}>Salvar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditTagDialog({ tag, categories, onClose, onSave, onDelete }: {
  tag: PoiTag;
  categories: PoiCategory[];
  onClose: () => void;
  onSave: (patch: { label?: string; category_id?: string; accepted_primary_types?: string[]; places_types?: string[]; query_variants?: string[]; min_reviews?: number }) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [label, setLabel] = useState(tag.label);
  const [catId, setCatId] = useState(tag.category_id);
  const [showAi, setShowAi] = useState(false);
  const [primary, setPrimary] = useState(tag.accepted_primary_types.join(", "));
  const [places, setPlaces] = useState(tag.places_types.join(", "));
  const [variants, setVariants] = useState(tag.query_variants.join(", "));
  const [minR, setMinR] = useState(tag.min_reviews);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Editar tag</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={catId} onValueChange={setCatId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button type="button" onClick={() => setShowAi(!showAi)} className="text-[11px] text-muted-foreground underline">
            {showAi ? "Ocultar" : "Mostrar"} mapeamento avançado (IA)
          </button>
          {showAi && (
            <div className="space-y-2 border-l-2 border-border pl-3">
              <p className="text-[11px] text-muted-foreground">A IA usa esses dados para classificar pontos automaticamente nesta tag durante "Gerar com IA".</p>
              <Input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="Primary types (vírgula)" />
              <Input value={places} onChange={(e) => setPlaces(e.target.value)} placeholder="Places types (vírgula)" />
              <Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="Variantes de busca (vírgula)" />
              <Input type="number" value={minR} onChange={(e) => setMinR(Number(e.target.value) || 0)} placeholder="Mínimo de avaliações" />
            </div>
          )}
          {tag.is_protected && (
            <p className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
              <Lock className="size-3 mt-0.5" /> Tag padrão — pode renomear e mudar categoria; não pode excluir (a IA usa o slug <code>{tag.slug}</code>).
            </p>
          )}
        </div>
        <DialogFooter className="flex sm:justify-between">
          {!tag.is_protected ? (
            <Button variant="destructive" size="sm" disabled={saving} onClick={async () => { setSaving(true); await onDelete(); setSaving(false); }}>
              <Trash2 className="size-3.5" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button disabled={saving || !label.trim()} onClick={async () => {
              setSaving(true);
              try {
                await onSave({
                  label: label.trim(),
                  category_id: catId,
                  accepted_primary_types: primary.split(",").map((s) => s.trim()).filter(Boolean),
                  places_types: places.split(",").map((s) => s.trim()).filter(Boolean),
                  query_variants: variants.split(",").map((s) => s.trim()).filter(Boolean),
                  min_reviews: minR,
                });
              } finally { setSaving(false); }
            }}>Salvar</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewTagDialog({ categoryId, categoryLabel, onClose, onSave }: {
  categoryId: string;
  categoryLabel: string;
  onClose: () => void;
  onSave: (payload: { label: string; accepted_primary_types: string[]; places_types: string[]; query_variants: string[]; min_reviews: number }) => Promise<void>;
}) {
  void categoryId;
  const [label, setLabel] = useState("");
  const [primary, setPrimary] = useState("");
  const [places, setPlaces] = useState("");
  const [variants, setVariants] = useState("");
  const [minR, setMinR] = useState(150);
  const [showAi, setShowAi] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova tag em "{categoryLabel}"</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Nome (ex: Cachoeira)" maxLength={60} />
          <button type="button" onClick={() => setShowAi(!showAi)} className="text-[11px] text-muted-foreground underline">
            {showAi ? "Ocultar" : "Mostrar"} mapeamento avançado (IA)
          </button>
          {showAi && (
            <div className="space-y-2 border-l-2 border-border pl-3">
              <p className="text-[11px] text-muted-foreground">Preencha para a IA classificar pontos automaticamente nesta tag.</p>
              <Input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="Primary types (vírgula)" />
              <Input value={places} onChange={(e) => setPlaces(e.target.value)} placeholder="Places types (vírgula)" />
              <Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="Variantes de busca" />
              <Input type="number" value={minR} onChange={(e) => setMinR(Number(e.target.value) || 0)} placeholder="Mínimo de avaliações" />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={saving || !label.trim()} onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                label: label.trim(),
                accepted_primary_types: primary.split(",").map((s) => s.trim()).filter(Boolean),
                places_types: places.split(",").map((s) => s.trim()).filter(Boolean),
                query_variants: variants.split(",").map((s) => s.trim()).filter(Boolean),
                min_reviews: minR,
              });
            } finally { setSaving(false); }
          }}>Criar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
