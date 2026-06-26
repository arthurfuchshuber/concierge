import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { SlidersHorizontal, X } from "lucide-react";

export type SortKey = "distance" | "rating" | "alpha";

export type FilterSheetProps = {
  // estado
  sortBy: SortKey;
  setSortBy: (k: SortKey) => void;
  minReviews: number;
  setMinReviews: (n: number) => void;
  showNear: boolean;
  setShowNear: (b: boolean) => void;
  showRefs: boolean;
  setShowRefs: (b: boolean) => void;
  // visibilidade (de acordo com itens reais)
  showSort?: boolean;
  showProximity?: boolean;
  reviewOptions: { value: number; label: string }[];
  proximityCounts?: { near: number; refs: number };
};

const SORT_OPTS: { key: SortKey; label: string }[] = [
  { key: "distance", label: "Distância" },
  { key: "rating", label: "Avaliação" },
  { key: "alpha", label: "A-Z" },
];

/**
 * Botão "Filtros" + bottom-sheet com ordenação, mínimo de avaliações
 * e toggles de proximidade. Substitui as 3 linhas empilhadas no mobile.
 * Mostra badge com a contagem de filtros ativos.
 */
export function FilterSheetButton(props: FilterSheetProps) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (props.sortBy !== "distance" ? 1 : 0) +
    (props.minReviews > 0 ? 1 : 0) +
    (props.showProximity && (!props.showNear || !props.showRefs) ? 1 : 0);

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="rounded-full h-9 px-3.5 gap-1.5 relative"
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="text-[12px]">Filtros</span>
        {activeCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-accent-foreground text-[10px] font-semibold">
            {activeCount}
          </span>
        )}
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto sm:max-w-md sm:mx-auto">
          <SheetHeader>
            <SheetTitle className="text-base">Filtros</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            {(props.showSort ?? true) && (
              <section>
                <Label>Ordenação</Label>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  {SORT_OPTS.map((o) => (
                    <Chip key={o.key} active={props.sortBy === o.key} onClick={() => props.setSortBy(o.key)}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </section>
            )}

            {props.reviewOptions.length > 0 && (
              <section>
                <Label>Mínimo de avaliações</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {props.reviewOptions.map((o) => (
                    <Chip key={o.value} active={props.minReviews === o.value} onClick={() => props.setMinReviews(o.value)}>
                      {o.label}
                    </Chip>
                  ))}
                </div>
              </section>
            )}

            {props.showProximity && (
              <section>
                <Label>Proximidade</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(props.proximityCounts?.near ?? 0) > 0 && (
                    <Chip active={props.showNear} onClick={() => props.setShowNear(!props.showNear)}>
                      Pertinho
                    </Chip>
                  )}
                  {(props.proximityCounts?.refs ?? 0) > 0 && (
                    <Chip active={props.showRefs} onClick={() => props.setShowRefs(!props.showRefs)}>
                      Referências na Cidade
                    </Chip>
                  )}
                </div>
              </section>
            )}
          </div>

          <SheetFooter className="mt-6 gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                props.setSortBy("distance");
                props.setMinReviews(0);
                props.setShowNear(true);
                props.setShowRefs(true);
              }}
            >
              <X className="size-3.5" /> Limpar
            </Button>
            <Button onClick={() => setOpen(false)}>Aplicar</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium">{children}</div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors ${
        active
          ? "bg-accent text-accent-foreground border-accent shadow-sm"
          : "bg-card/60 text-muted-foreground border-border hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
