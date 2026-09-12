import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, Loader2, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listPropertyTypes,
  savePropertyType,
  deletePropertyType,
} from "@/lib/property-types.functions";

/**
 * Seleção do tipo do imóvel: dropdown de escolha única, com lista padrão
 * (Casa, Apartamento, Chalé...) que o anfitrião pode renomear, excluir ou
 * ampliar livremente — mesmo padrão de gerenciamento do CategoryPicker.
 */
export function PropertyTypeSelect({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const listFn = useServerFn(listPropertyTypes);
  const saveFn = useServerFn(savePropertyType);
  const delFn = useServerFn(deletePropertyType);

  const [manage, setManage] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: types = [], isLoading } = useQuery({
    queryKey: ["property-types"],
    queryFn: () => listFn(),
    staleTime: 60_000,
  });

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["property-types"] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs text-muted-foreground">Tipo do imóvel</Label>
        <button
          type="button"
          onClick={() => setManage(true)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <Settings2 className="size-3" /> Gerenciar opções
        </button>
      </div>

      <Select
        value={value ?? undefined}
        onValueChange={(v) => onChange(v || null)}
        disabled={isLoading}
      >
        <SelectTrigger>
          {isLoading ? (
            <span className="inline-flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Carregando…
            </span>
          ) : (
            <SelectValue placeholder="Selecione o tipo do imóvel" />
          )}
        </SelectTrigger>
        <SelectContent>
          {types.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              {t.label}
            </SelectItem>
          ))}
          {types.length === 0 && !isLoading && (
            <div className="px-3 py-2 text-xs text-muted-foreground">Nenhum tipo cadastrado.</div>
          )}
        </SelectContent>
      </Select>

      <Dialog open={manage} onOpenChange={setManage}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tipos de imóvel</DialogTitle>
            <DialogDescription>
              Crie, renomeie ou exclua as opções disponíveis para os seus imóveis.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2">
            <Input
              value={newLabel}
              maxLength={60}
              placeholder="Novo tipo..."
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
            {types.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-2 rounded-xl border border-border/60 px-3 py-2"
              >
                {editing?.id === t.id ? (
                  <>
                    <Input
                      value={editing.label}
                      maxLength={60}
                      onChange={(e) => setEditing({ id: t.id, label: e.target.value })}
                      className="h-8 flex-1 min-w-0"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await saveFn({ data: { id: t.id, label: editing.label.trim() } });
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
                    <span className="flex-1 min-w-0 truncate text-sm">{t.label}</span>
                    <button
                      type="button"
                      onClick={() => setEditing({ id: t.id, label: t.label })}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await delFn({ data: { id: t.id } });
                          if (value === t.id) onChange(null);
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
