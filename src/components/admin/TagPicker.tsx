import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getPoiTaxonomy,
  createPoiCategory,
  updatePoiCategory,
  deletePoiCategory,
  createPoiTag,
  updatePoiTag,
  deletePoiTag,
  type PoiTag,
  type PoiCategory,
} from "@/lib/poi-taxonomy.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, Trash2, Plus, Lock, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const TAXONOMY_QUERY_KEY = ["poi-taxonomy"] as const;

export function useTaxonomy() {
  const fetchFn = useServerFn(getPoiTaxonomy);
  return useQuery({
    queryKey: TAXONOMY_QUERY_KEY,
    queryFn: () => fetchFn({}),
    staleTime: 60_000,
  });
}

type Props = {
  value: string; // tag slug
  onChange: (slug: string) => void;
  className?: string;
};

export function TagPicker({ value, onChange, className }: Props) {
  const qc = useQueryClient();
  const { data } = useTaxonomy();
  const [open, setOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<PoiTag | null>(null);
  const [editingCat, setEditingCat] = useState<PoiCategory | null>(null);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newCatOpen, setNewCatOpen] = useState(false);

  const updateTagFn = useServerFn(updatePoiTag);
  const deleteTagFn = useServerFn(deletePoiTag);
  const updateCatFn = useServerFn(updatePoiCategory);
  const deleteCatFn = useServerFn(deletePoiCategory);

  const tags = data?.tags ?? [];
  const categories = data?.categories ?? [];
  const selected = tags.find((t) => t.slug === value);
  const groups = categories
    .map((c) => ({ cat: c, items: tags.filter((t) => t.category_id === c.id) }))
    .filter((g) => g.items.length > 0);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
  }

  async function saveTagLabel(tag: PoiTag, label: string, categoryId: string) {
    try {
      await updateTagFn({ data: { id: tag.id, label, category_id: categoryId } });
      toast.success("Tag atualizada");
      setEditingTag(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }
  async function removeTag(tag: PoiTag) {
    if (!confirm(`Excluir a tag "${tag.label}"?`)) return;
    try {
      await deleteTagFn({ data: { id: tag.id } });
      toast.success("Tag removida");
      setEditingTag(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }
  async function saveCatLabel(cat: PoiCategory, label: string) {
    try {
      await updateCatFn({ data: { id: cat.id, label } });
      toast.success("Categoria atualizada");
      setEditingCat(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }
  async function removeCat(cat: PoiCategory) {
    if (!confirm(`Excluir a categoria "${cat.label}"?`)) return;
    try {
      await deleteCatFn({ data: { id: cat.id } });
      toast.success("Categoria removida");
      setEditingCat(null);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`inline-flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted/40 transition-colors w-full sm:w-44 ${className ?? ""}`}
          >
            <span className="truncate">{selected?.label ?? value}</span>
            <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="p-0 w-72 max-h-[420px] overflow-auto">
          <div className="flex items-center justify-between gap-1 px-3 py-2 border-b sticky top-0 bg-background z-10">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Tags</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNewCatOpen(true)}>
                <Plus className="size-3" /> categoria
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNewTagOpen(true)}>
                <Plus className="size-3" /> tag
              </Button>
            </div>
          </div>
          <div className="py-1">
            {groups.map(({ cat, items }) => (
              <div key={cat.id} className="group/cat">
                <div className="flex items-center gap-1 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span className="flex-1 truncate">{cat.label}</span>
                  {cat.is_protected && <Lock className="size-2.5 opacity-40" />}
                  <button
                    type="button"
                    aria-label="Editar categoria"
                    onClick={(e) => { e.stopPropagation(); setEditingCat(cat); }}
                    className="opacity-0 group-hover/cat:opacity-60 hover:!opacity-100 transition-opacity"
                  >
                    <Pencil className="size-3" />
                  </button>
                </div>
                {items.map((tag) => (
                  <div key={tag.id} className="group/tag flex items-center gap-1 px-2">
                    <button
                      type="button"
                      onClick={() => { onChange(tag.slug); setOpen(false); }}
                      className={`flex-1 text-left text-sm rounded-md px-2 py-1.5 truncate hover:bg-muted/60 ${tag.slug === value ? "bg-accent/40 text-accent-foreground font-medium" : ""}`}
                    >
                      {tag.label}
                      {tag.is_protected && <Lock className="inline size-2.5 ml-1 opacity-40" />}
                    </button>
                    <button
                      type="button"
                      aria-label="Editar tag"
                      onClick={(e) => { e.stopPropagation(); setEditingTag(tag); }}
                      className="opacity-0 group-hover/tag:opacity-60 hover:!opacity-100 transition-opacity p-1"
                    >
                      <Pencil className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Editar tag */}
      {editingTag && (
        <EditTagDialog
          tag={editingTag}
          categories={categories}
          onClose={() => setEditingTag(null)}
          onSave={(label, catId) => saveTagLabel(editingTag, label, catId)}
          onDelete={() => removeTag(editingTag)}
        />
      )}
      {/* Editar categoria */}
      {editingCat && (
        <EditCategoryDialog
          cat={editingCat}
          onClose={() => setEditingCat(null)}
          onSave={(label) => saveCatLabel(editingCat, label)}
          onDelete={() => removeCat(editingCat)}
        />
      )}
      {/* Nova tag */}
      {newTagOpen && (
        <NewTagDialog
          categories={categories}
          onClose={() => setNewTagOpen(false)}
          onSaved={() => { setNewTagOpen(false); invalidate(); }}
        />
      )}
      {/* Nova categoria */}
      {newCatOpen && (
        <NewCategoryDialog
          onClose={() => setNewCatOpen(false)}
          onSaved={() => { setNewCatOpen(false); invalidate(); }}
        />
      )}
    </>
  );
}

function EditTagDialog({ tag, categories, onClose, onSave, onDelete }: {
  tag: PoiTag;
  categories: PoiCategory[];
  onClose: () => void;
  onSave: (label: string, categoryId: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [label, setLabel] = useState(tag.label);
  const [catId, setCatId] = useState(tag.category_id);
  const [saving, setSaving] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar tag</DialogTitle>
        </DialogHeader>
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
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {tag.is_protected && (
            <p className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
              <Lock className="size-3 mt-0.5 shrink-0" />
              Esta é uma tag padrão — você pode renomear e mudar a categoria, mas não excluir, porque a IA usa o slug "<code>{tag.slug}</code>" para classificar pontos do Google.
            </p>
          )}
        </div>
        <DialogFooter className="flex sm:justify-between gap-2">
          {!tag.is_protected ? (
            <Button variant="destructive" size="sm" onClick={async () => { setSaving(true); await onDelete(); setSaving(false); }} disabled={saving}>
              <Trash2 className="size-3.5" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={saving || !label.trim()} onClick={async () => { setSaving(true); await onSave(label.trim(), catId); setSaving(false); }}>
              {saving && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </Button>
          </div>
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
        <DialogHeader>
          <DialogTitle>Editar categoria</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Label className="text-xs">Nome</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          {cat.is_protected && (
            <p className="text-[11px] text-muted-foreground flex gap-1.5 items-start">
              <Lock className="size-3 mt-0.5 shrink-0" />
              Categoria padrão — pode renomear, não pode excluir.
            </p>
          )}
        </div>
        <DialogFooter className="flex sm:justify-between gap-2">
          {!cat.is_protected ? (
            <Button variant="destructive" size="sm" onClick={async () => { setSaving(true); await onDelete(); setSaving(false); }} disabled={saving}>
              <Trash2 className="size-3.5" /> Excluir
            </Button>
          ) : <div />}
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
            <Button size="sm" disabled={saving || !label.trim()} onClick={async () => { setSaving(true); await onSave(label.trim()); setSaving(false); }}>
              {saving && <Loader2 className="size-3.5 animate-spin" />} Salvar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewTagDialog({ categories, onClose, onSaved }: {
  categories: PoiCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [catId, setCatId] = useState(categories[0]?.id ?? "");
  const [primary, setPrimary] = useState("");
  const [places, setPlaces] = useState("");
  const [variants, setVariants] = useState("");
  const [minR, setMinR] = useState(150);
  const [showAi, setShowAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const createFn = useServerFn(createPoiTag);

  async function save() {
    if (!label.trim() || !catId) return;
    setSaving(true);
    try {
      await createFn({
        data: {
          label: label.trim(),
          category_id: catId,
          accepted_primary_types: primary.split(",").map((s) => s.trim()).filter(Boolean),
          places_types: places.split(",").map((s) => s.trim()).filter(Boolean),
          query_variants: variants.split(",").map((s) => s.trim()).filter(Boolean),
          min_reviews: minR,
        },
      });
      toast.success("Tag criada");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova tag</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nome (ex: Cachoeira)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={catId} onValueChange={setCatId}>
              <SelectTrigger><SelectValue placeholder="Escolha" /></SelectTrigger>
              <SelectContent>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <button type="button" onClick={() => setShowAi(!showAi)} className="text-[11px] text-muted-foreground underline">
            {showAi ? "Ocultar" : "Mostrar"} mapeamento avançado (para IA)
          </button>
          {showAi && (
            <div className="space-y-2 border-l-2 border-border pl-3">
              <p className="text-[11px] text-muted-foreground">Preencha para que a IA classifique pontos automaticamente nesta tag. Deixe vazio para usar apenas manualmente.</p>
              <div>
                <Label className="text-xs">Primary types do Google (vírgula)</Label>
                <Input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="waterfall, scenic_lookout" />
              </div>
              <div>
                <Label className="text-xs">Places types (busca, vírgula)</Label>
                <Input value={places} onChange={(e) => setPlaces(e.target.value)} placeholder="tourist_attraction" />
              </div>
              <div>
                <Label className="text-xs">Variantes de busca (vírgula)</Label>
                <Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="cachoeiras em, quedas d'água em" />
              </div>
              <div>
                <Label className="text-xs">Mínimo de avaliações</Label>
                <Input type="number" value={minR} onChange={(e) => setMinR(Number(e.target.value) || 0)} />
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving || !label.trim() || !catId}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewCategoryDialog({ onClose, onSaved }: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const createFn = useServerFn(createPoiCategory);
  async function save() {
    setSaving(true);
    try {
      await createFn({ data: { label: label.trim() } });
      toast.success("Categoria criada");
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setSaving(false); }
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Nova categoria</DialogTitle></DialogHeader>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Aventura" maxLength={60} />
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
