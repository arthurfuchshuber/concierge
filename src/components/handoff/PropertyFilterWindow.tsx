import { useEffect, useState } from "react";
import { LoaderCircle, X } from "lucide-react";
import { AtdWindow, BTN_BRAND, WinSearch } from "./atd-window";
import { cn } from "@/lib/utils";

/** Filtro "Imóveis" (padrão de seleção das janelas: busca, Selecionar Todos, "N Selecionados" + X, até 5 visíveis). */
export function PropertyFilterWindow({
  open,
  onOpenChange,
  loading,
  options,
  value,
  onApply,
  subtitle = "Mostrar só as conversas destes imóveis",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  loading: boolean;
  options: Array<{ id: string; name: string; owner: string | null }>;
  value: string[];
  onApply: (v: string[]) => void;
  subtitle?: string;
}) {
  const [draft, setDraft] = useState<string[]>(value);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (open) {
      setDraft(value);
      setSearch("");
    }
  }, [open, value]);
  const q = search.trim().toLowerCase();
  const shown = q ? options.filter((p) => `${p.name} ${p.owner ?? ""}`.toLowerCase().includes(q)) : options;
  const allOn = shown.length > 0 && shown.every((p) => draft.includes(p.id));
  return (
    <AtdWindow open={open} onOpenChange={onOpenChange} title="Imóveis" subtitle={subtitle} width={360}>
      <WinSearch value={search} onChange={setSearch} placeholder="Buscar imóvel…" />
      <div className="flex items-center gap-2 px-4 pb-1.5 pt-1 text-[12px]">
        <button
          type="button"
          className="font-semibold text-foreground"
          onClick={() => setDraft(allOn ? draft.filter((id) => !shown.some((p) => p.id === id)) : [...new Set([...draft, ...shown.map((p) => p.id)])])}
        >
          {allOn ? "Desmarcar Todos" : "Selecionar Todos"}
        </button>
        <span className="flex-1" />
        <span className="font-semibold tabular-nums text-muted-foreground">
          {draft.length} {draft.length === 1 ? "Selecionado" : "Selecionados"}
        </span>
        <button type="button" aria-label="Remover seleção" onClick={() => setDraft([])} className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-foreground/[0.06]">
          <X className="size-3.5" />
        </button>
      </div>
      <div className="sg-elegant-scroll mx-2 flex max-h-[262px] flex-col gap-0.5 overflow-y-auto pr-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Carregando…
          </div>
        ) : (
          shown.map((p) => {
            const on = draft.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                onClick={() => setDraft(on ? draft.filter((x) => x !== p.id) : [...draft, p.id])}
                className={cn("flex min-w-0 flex-col gap-px rounded-[9px] px-3 py-2 text-left", on && "bg-foreground/[0.07]")}
              >
                <span className={cn("truncate text-[13px] leading-[1.3]", on ? "font-bold" : "font-semibold")}>{p.name}</span>
                {p.owner ? <span className="truncate text-[11.5px] text-muted-foreground">{p.owner}</span> : null}
              </button>
            );
          })
        )}
      </div>
      <div className="px-4 pb-4 pt-3">
        <button type="button" onClick={() => onApply(draft)} className={`${BTN_BRAND} w-full flex-none`}>
          Confirmar
        </button>
      </div>
    </AtdWindow>
  );
}
