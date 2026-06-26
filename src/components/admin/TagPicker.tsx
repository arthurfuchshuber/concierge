import { useState, useRef, useEffect } from "react";
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
  bulkMovePoiTags,
  bulkDeletePoiTags,
  type PoiTag,
  type PoiCategory,
} from "@/lib/poi-taxonomy.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2, Plus, Lock, ChevronDown, ChevronRight, Loader2, MoveRight, CheckSquare, Square } from "lucide-react";
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
  value: string;
  onChange: (slug: string) => void;
  className?: string;
};

export function TagPicker({ value, onChange, className }: Props) {
  const { data } = useTaxonomy();
  const [open, setOpen] = useState(false);

  const tags = data?.tags ?? [];
  const categories = data?.categories ?? [];
  const selected = tags.find((t) => t.slug === value);

  return (
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
      <PopoverContent align="end" className="p-0 w-[340px] max-h-[520px] overflow-hidden flex flex-col">
        <TaxonomyTree
          categories={categories}
          tags={tags}
          selectedSlug={value}
          onPickTag={(slug) => { onChange(slug); setOpen(false); }}
        />
      </PopoverContent>
    </Popover>
  );
}

/* ============================================================
   Reusable taxonomy tree: accordion + inline rename + bulk ops
   ============================================================ */
export function TaxonomyTree({
  categories,
  tags,
  selectedSlug,
  onPickTag,
}: {
  categories: PoiCategory[];
  tags: PoiTag[];
  selectedSlug?: string;
  onPickTag?: (slug: string) => void;
}) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<string | null>(null); // accordion: only one
  const [manageMode, setManageMode] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newTagPresetCat, setNewTagPresetCat] = useState<string | null>(null);
  const [deleteCat, setDeleteCat] = useState<PoiCategory | null>(null);

  const moveFn = useServerFn(bulkMovePoiTags);
  const delFn = useServerFn(bulkDeletePoiTags);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: TAXONOMY_QUERY_KEY });
  }

  const groups = categories.map((c) => ({
    cat: c,
    items: tags.filter((t) => t.category_id === c.id),
  }));

  function toggleId(id: string) {
    setSelectedIds((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  async function bulkMove(catId: string) {
    try {
      await moveFn({ data: { tag_ids: Array.from(selectedIds), category_id: catId } });
      toast.success("Tags movidas");
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }
  async function bulkDelete() {
    if (!confirm(`Excluir ${selectedIds.size} tag(s)? Tags padrão do Google são preservadas.`)) return;
    try {
      const r = await delFn({ data: { tag_ids: Array.from(selectedIds) } });
      toast.success(`${r.deleted} excluída(s)${r.skipped ? `, ${r.skipped} preservada(s)` : ""}`);
      setSelectedIds(new Set());
      setSelectMode(false);
      invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  const hasSelection = selectedIds.size > 0;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between gap-1 px-3 py-2 border-b bg-background z-10 shrink-0">
        {manageMode && selectMode ? (
          <>
            <span className="text-[11px] text-muted-foreground">{selectedIds.size} selecionada(s)</span>
            <div className="flex items-center gap-1">
              {hasSelection && (
                <>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                        <MoveRight className="size-3" /> mover
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Mover para</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {categories.map((c) => (
                        <DropdownMenuItem key={c.id} onClick={() => bulkMove(c.id)}>
                          {c.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-destructive" onClick={bulkDelete}>
                    <Trash2 className="size-3" /> excluir
                  </Button>
                </>
              )}
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setSelectMode(false); setSelectedIds(new Set()); }}>
                cancelar
              </Button>
            </div>
          </>
        ) : manageMode ? (
          <>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Modo edição</span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setSelectMode(true)}>
                <CheckSquare className="size-3" /> selecionar
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setNewCatOpen(true)}>
                <Plus className="size-3" /> categoria
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => { setNewTagPresetCat(null); setNewTagOpen(true); }}>
                <Plus className="size-3" /> tag
              </Button>
              <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" onClick={() => setManageMode(false)}>
                concluir
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Escolher tag</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setManageMode(true)}>
              Editar
            </Button>
          </>
        )}
      </div>

      <div className="overflow-auto flex-1 py-1">
        {groups.map(({ cat, items }) => {
          const isOpen = expanded === cat.id;
          return (
            <div key={cat.id} className="border-b border-border/40 last:border-0">
              <CategoryRow
                cat={cat}
                count={items.length}
                isOpen={isOpen}
                manageMode={manageMode}
                onToggle={() => setExpanded(isOpen ? null : cat.id)}
                onRequestDelete={() => setDeleteCat(cat)}
                onAddTag={() => { setNewTagPresetCat(cat.id); setNewTagOpen(true); }}
                onRenamed={invalidate}
              />
              {isOpen && (
                <div className="pb-1">
                  {items.length === 0 && (
                    <p className="px-6 py-2 text-[11px] text-muted-foreground italic">
                      {manageMode ? "Sem tags — use “+ tag” acima." : "Sem tags nesta categoria."}
                    </p>
                  )}
                  {items.map((tag) => (
                    <TagRow
                      key={tag.id}
                      tag={tag}
                      categories={categories}
                      selected={selectedSlug === tag.slug}
                      manageMode={manageMode}
                      selectMode={manageMode && selectMode}
                      checked={selectedIds.has(tag.id)}
                      onToggleCheck={() => toggleId(tag.id)}
                      onPick={() => onPickTag?.(tag.slug)}
                      onChanged={invalidate}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {newTagOpen && (
        <NewTagDialog
          categories={categories}
          presetCategoryId={newTagPresetCat}
          onClose={() => setNewTagOpen(false)}
          onSaved={() => { setNewTagOpen(false); invalidate(); }}
        />
      )}
      {newCatOpen && (
        <NewCategoryDialog
          onClose={() => setNewCatOpen(false)}
          onSaved={() => { setNewCatOpen(false); invalidate(); }}
        />
      )}
      {deleteCat && (
        <DeleteCategoryDialog
          cat={deleteCat}
          categories={categories}
          tagCount={tags.filter((t) => t.category_id === deleteCat.id).length}
          onClose={() => setDeleteCat(null)}
          onDeleted={() => { setDeleteCat(null); invalidate(); }}
        />
      )}
    </>
  );
}

/* ============================================================
   Category row (header) — inline rename + delete + add tag
   ============================================================ */
function CategoryRow({
  cat, count, isOpen, manageMode, onToggle, onRequestDelete, onAddTag, onRenamed,
}: {
  cat: PoiCategory;
  count: number;
  isOpen: boolean;
  manageMode: boolean;
  onToggle: () => void;
  onRequestDelete: () => void;
  onAddTag: () => void;
  onRenamed: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateFn = useServerFn(updatePoiCategory);

  async function commit(newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed || trimmed === cat.label) { setEditing(false); return; }
    try {
      await updateFn({ data: { id: cat.id, label: trimmed } });
      toast.success("Categoria renomeada");
      setEditing(false);
      onRenamed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
      setEditing(false);
    }
  }

  return (
    <div className="group/cat flex items-center gap-1 px-2 py-1.5 hover:bg-muted/30">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1 flex-1 min-w-0 text-left"
      >
        {isOpen
          ? <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          : <ChevronRight className="size-3 text-muted-foreground shrink-0" />}
        {editing ? (
          <InlineRename initial={cat.label} onCommit={commit} onCancel={() => setEditing(false)} />
        ) : (
          <span
            className="text-[11px] uppercase tracking-wider font-medium truncate"
            onDoubleClick={(e) => { if (manageMode) { e.stopPropagation(); setEditing(true); } }}
          >
            {cat.label}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/60 shrink-0">({count})</span>
        {cat.is_protected && <Lock className="size-2.5 opacity-40 shrink-0" />}
      </button>
      {manageMode && (
        <div className="flex items-center gap-0.5">
          {!editing && (
            <button
              type="button"
              aria-label="Renomear"
              onClick={(e) => { e.stopPropagation(); setEditing(true); }}
              className="p-1 text-[10px] text-muted-foreground hover:text-foreground"
            >
              renomear
            </button>
          )}
          <button
            type="button"
            aria-label="Adicionar tag"
            onClick={(e) => { e.stopPropagation(); onAddTag(); }}
            className="p-1 text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3" />
          </button>
          {!cat.is_protected && (
            <button
              type="button"
              aria-label="Excluir categoria"
              onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
              className="p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Tag row — pick / rename / move / delete inline
   ============================================================ */
function TagRow({
  tag, categories, selected, manageMode, selectMode, checked, onToggleCheck, onPick, onChanged,
}: {
  tag: PoiTag;
  categories: PoiCategory[];
  selected: boolean;
  manageMode: boolean;
  selectMode: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  onPick: () => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const updateFn = useServerFn(updatePoiTag);
  const deleteFn = useServerFn(deletePoiTag);

  async function commitLabel(newLabel: string) {
    const trimmed = newLabel.trim();
    if (!trimmed || trimmed === tag.label) { setEditing(false); return; }
    try {
      await updateFn({ data: { id: tag.id, label: trimmed } });
      toast.success("Tag renomeada");
      setEditing(false);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
      setEditing(false);
    }
  }

  async function moveTo(catId: string) {
    try {
      await updateFn({ data: { id: tag.id, category_id: catId } });
      toast.success("Tag movida");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  async function remove() {
    if (!confirm(`Excluir a tag "${tag.label}"?`)) return;
    try {
      await deleteFn({ data: { id: tag.id } });
      toast.success("Tag removida");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    }
  }

  return (
    <div className={`group/tag flex items-center gap-1 pl-5 pr-2 ${selected ? "bg-accent/30" : "hover:bg-muted/30"}`}>
      {selectMode && (
        <Checkbox checked={checked} onCheckedChange={onToggleCheck} className="size-3.5" />
      )}
      {editing ? (
        <div className="flex-1 py-1">
          <InlineRename initial={tag.label} onCommit={commitLabel} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { if (selectMode) onToggleCheck(); else onPick(); }}
          onDoubleClick={(e) => {
            if (tag.is_protected) return;
            e.stopPropagation();
            setEditing(true);
          }}
          title={tag.is_protected ? "Tag padrão do Google — não editável" : "Duplo-clique para renomear"}
          className={`flex-1 text-left text-sm py-1.5 px-1 truncate ${selected ? "font-medium" : ""}`}
        >
          {tag.label}
          {tag.is_protected && <Lock className="inline size-2.5 ml-1 opacity-40" />}
        </button>
      )}
      {!editing && !selectMode && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover/tag:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Mover" className="p-1 text-muted-foreground hover:text-foreground">
                <MoveRight className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Mover para</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {categories.filter((c) => c.id !== tag.category_id).map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => moveTo(c.id)}>{c.label}</DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {!tag.is_protected && (
            <button
              type="button"
              aria-label="Excluir"
              onClick={(e) => { e.stopPropagation(); remove(); }}
              className="p-1 text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InlineRename({ initial, onCommit, onCancel }: {
  initial: string;
  onCommit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <Input
      ref={ref}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); onCommit(v); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      className="h-7 text-sm py-1"
      maxLength={60}
    />
  );
}

/* ============================================================
   New tag — supports preset category + multiple labels at once
   ============================================================ */
function NewTagDialog({ categories, presetCategoryId, onClose, onSaved }: {
  categories: PoiCategory[];
  presetCategoryId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [labels, setLabels] = useState("");
  const [catId, setCatId] = useState(presetCategoryId ?? categories[0]?.id ?? "");
  const [primary, setPrimary] = useState("");
  const [places, setPlaces] = useState("");
  const [variants, setVariants] = useState("");
  const [minR, setMinR] = useState(150);
  const [showAi, setShowAi] = useState(false);
  const [saving, setSaving] = useState(false);
  const createFn = useServerFn(createPoiTag);

  async function save() {
    const list = labels.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    if (list.length === 0 || !catId) return;
    setSaving(true);
    try {
      for (const label of list) {
        await createFn({
          data: {
            label,
            category_id: catId,
            accepted_primary_types: primary.split(",").map((s) => s.trim()).filter(Boolean),
            places_types: places.split(",").map((s) => s.trim()).filter(Boolean),
            query_variants: variants.split(",").map((s) => s.trim()).filter(Boolean),
            min_reviews: minR,
          },
        });
      }
      toast.success(`${list.length} tag(s) criada(s)`);
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
        <DialogHeader><DialogTitle>Novas tags</DialogTitle>
          <DialogDescription>Uma por linha (ou separadas por vírgula) para criar várias de uma vez.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Nomes</Label>
            <textarea
              value={labels}
              onChange={(e) => setLabels(e.target.value)}
              rows={3}
              placeholder="Cachoeira&#10;Mirante&#10;Trilha"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            />
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
              <p className="text-[11px] text-muted-foreground">Aplicado a todas as tags criadas agora.</p>
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
                <Input value={variants} onChange={(e) => setVariants(e.target.value)} placeholder="cachoeiras em" />
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
          <Button onClick={save} disabled={saving || !labels.trim() || !catId}>
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
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Aventura" maxLength={60} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && label.trim()) save(); }}
        />
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

/* ============================================================
   Delete category — prompts for reassignment when tags exist
   ============================================================ */
function DeleteCategoryDialog({ cat, categories, tagCount, onClose, onDeleted }: {
  cat: PoiCategory;
  categories: PoiCategory[];
  tagCount: number;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const others = categories.filter((c) => c.id !== cat.id);
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const deleteFn = useServerFn(deletePoiCategory);

  async function confirm() {
    setSaving(true);
    try {
      await deleteFn({ data: { id: cat.id, reassign_to_category_id: tagCount > 0 ? target : undefined } });
      toast.success("Categoria excluída");
      onDeleted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro");
    } finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Excluir “{cat.label}”</DialogTitle>
          {tagCount > 0 ? (
            <DialogDescription>
              Esta categoria tem <b>{tagCount} tag(s)</b>. Escolha para qual categoria as tags devem ser movidas antes da exclusão.
            </DialogDescription>
          ) : (
            <DialogDescription>Esta categoria não tem tags. A exclusão é definitiva.</DialogDescription>
          )}
        </DialogHeader>
        {tagCount > 0 && (
          <div>
            <Label className="text-xs">Mover tags para</Label>
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {others.map((c) => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={confirm} disabled={saving || (tagCount > 0 && !target)}>
            {saving && <Loader2 className="size-3.5 animate-spin" />} Excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
