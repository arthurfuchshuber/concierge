import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listProviderCategories,
  saveProviderCategory,
  deleteProviderCategory,
} from "@/lib/provider-categories.functions";

/**
 * Seleção de categorias de serviço do prestador: aceita várias por cadastro e
 * permite criar, renomear e excluir as opções da conta (inclusive as padrão).
 */
export function CategoryPicker({
  value,
  onChange,
  error,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listProviderCategories);
  const saveFn = useServerFn(saveProviderCategory);
  const delFn = useServerFn(deleteProviderCategory);

  const [manage, setManage] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["provider-categories"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  function toggle(slug: string) {
    onChange(value.includes(slug) ? value.filter((v) => v !== slug) : [...value, slug]);
  }

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["provider-categories"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">Categorias de serviço *</Label>
        <button
          type="button"
          onClick={() => setManage(true)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-3" /> Gerenciar
        </button>
      </div>

      <div
        className={`flex flex-wrap gap-1.5 rounded-xl border p-2 min-w-0 ${
          error ? "border-destructive" : "border-border/60"
        }`}
      >
        {isLoading && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {categories.map((c) => {
          const on = value.includes(c.slug);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.slug)}
              className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-1 text-[11px] transition ${
                on
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/60 text-muted-foreground hover:border-primary/40"
              }`}
            >
              {on && <Check className="size-3 shrink-0" />}
              <span className="truncate">{c.label}</span>
            </button>
          );
        })}
        {!isLoading && categories.length === 0 && (
          <span className="text-[11px] text-muted-foreground">Nenhuma categoria cadastrada.</span>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Categorias de serviço</DialogTitle>
            <DialogDescription>
              Crie, renomeie ou exclua as opções disponíveis para os prestadores.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              value={newLabel}
              maxLength={60}
              placeholder="Nova categoria..."
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <Button
              type="button"
              disabled={busy || newLabel.trim().length < 2}
              onClick={() =>
                run(async () => {
                  await saveFn({ data: { label: newLabel.trim() } });
                  setNewLabel("");
                })
              }
            >
              <Plus className="size-4" />
            </Button>
          </div>

          <ul className="max-h-[45vh] space-y-1.5 overflow-y-auto">
            {categories.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2"
              >
                {editing?.id === c.id ? (
                  <>
                    <Input
                      value={editing.label}
                      maxLength={60}
                      onChange={(e) => setEditing({ id: c.id, label: e.target.value })}
                      className="h-8 flex-1 min-w-0"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await saveFn({ data: { id: c.id, label: editing.label.trim() } });
                          setEditing(null);
                        })
                      }
                      className="text-emerald-500"
                    >
                      <Check className="size-4" />
                    </button>
                    <button type="button" onClick={() => setEditing(null)} className="text-muted-foreground">
                      <X className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 min-w-0 truncate text-sm">{c.label}</span>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: c.id, label: c.label })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await delFn({ data: { id: c.id } });
                          onChange(value.filter((v) => v !== c.slug));
                        })
                      }
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>

          <div className="flex justify-center pt-2">
            <Button variant="outline" className="rounded-full" onClick={() => setManage(false)}>
              Concluir
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
