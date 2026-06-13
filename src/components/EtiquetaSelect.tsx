import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getEtiquetaOptions, setEtiquetaOptions } from "@/lib/etiquetas.functions";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Plus, X, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export function EtiquetaSelect({ value, onChange }: Props) {
  const fetchOpts = useServerFn(getEtiquetaOptions);
  const saveOpts = useServerFn(setEtiquetaOptions);
  const qc = useQueryClient();

  const { data: options = [] } = useQuery({
    queryKey: ["etiqueta-options"],
    queryFn: () => fetchOpts(),
  });

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [newOpt, setNewOpt] = useState("");
  const [saving, setSaving] = useState(false);

  // Make sure current value appears even if not yet in saved list
  const allOptions = value && !options.includes(value) ? [value, ...options] : options;

  function openManager() {
    setDraft(options);
    setNewOpt("");
    setOpen(true);
  }

  function addDraft() {
    const t = newOpt.trim();
    if (!t) return;
    if (draft.includes(t)) {
      toast.error("Essa opção já existe");
      return;
    }
    setDraft((d) => [...d, t]);
    setNewOpt("");
  }

  async function persist() {
    setSaving(true);
    try {
      const r = await saveOpts({ data: { options: draft } });
      qc.setQueryData(["etiqueta-options"], r.options);
      // If the currently selected value was removed, clear it
      if (value && !r.options.includes(value)) onChange("");
      toast.success("Etiquetas atualizadas");
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex gap-2">
      <Select value={value || undefined} onValueChange={(v) => onChange(v === "__clear__" ? "" : v)}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Selecione uma etiqueta" />
        </SelectTrigger>
        <SelectContent>
          {value && <SelectItem value="__clear__">Sem etiqueta</SelectItem>}
          {allOptions.map((o) => (
            <SelectItem key={o} value={o}>{o}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="icon" onClick={openManager} title="Gerenciar etiquetas">
            <Pencil className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Gerenciar etiquetas</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {draft.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma etiqueta. Adicione a primeira abaixo.</p>
            )}
            {draft.map((opt, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 bg-card">
                <Input
                  value={opt}
                  maxLength={80}
                  onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? e.target.value : x)))}
                  className="border-0 shadow-none focus-visible:ring-0 px-0 h-7"
                />
                <button
                  type="button"
                  onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-destructive p-1"
                  aria-label="Remover"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2 pt-2">
              <Input
                placeholder="Nova etiqueta"
                value={newOpt}
                maxLength={80}
                onChange={(e) => setNewOpt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addDraft();
                  }
                }}
              />
              <Button type="button" variant="secondary" onClick={addDraft}>
                <Plus className="size-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="button" onClick={persist} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin mr-1.5" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
