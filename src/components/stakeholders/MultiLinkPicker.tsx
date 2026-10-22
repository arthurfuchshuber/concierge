import { useEffect, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type MultiLinkOption = { id: string; label: string; hint?: string | null };

/**
 * Seleção MÚLTIPLA de vínculos (imóveis dentro do proprietário/prestador,
 * prestadores dentro do imóvel). Antes cada vínculo exigia abrir o menu,
 * clicar, esperar o salvamento e abrir de novo — agora marca-se tudo de uma
 * vez e confirma numa ação só.
 *
 * `initialSelected` já vem marcado: o mesmo diálogo serve para adicionar e
 * remover vínculos (o pai recebe a lista final e calcula a diferença).
 */
export function MultiLinkPicker({
  open,
  onOpenChange,
  title,
  description,
  options,
  initialSelected,
  confirmLabel = "Salvar vínculos",
  emptyText = "Nada disponível para vincular.",
  onConfirm,
  variant = "dialog",
}: {
  /** "menu": desenho do mockup Prop13 (cartão enxuto, caixas de marcar, botão único). */
  variant?: "dialog" | "menu";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  options: MultiLinkOption[];
  initialSelected: string[];
  confirmLabel?: string;
  emptyText?: string;
  onConfirm: (selectedIds: string[]) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setSelected(initialSelected);
      setQ("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const term = q.trim().toLowerCase();
  const visible = term
    ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(term))
    : options;

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function confirm() {
    setSaving(true);
    try {
      await onConfirm(selected);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  if (variant === "menu") {
    return (
      <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
        <DialogContent className="grid max-h-[90dvh] w-[calc(100%-2rem)] max-w-[300px] gap-3 overflow-y-auto rounded-sm p-4">
          <DialogHeader className="space-y-0 text-left">
            <DialogTitle className="text-[13.5px] font-bold">{title}</DialogTitle>
            <DialogDescription className="sr-only">{description ?? title}</DialogDescription>
          </DialogHeader>
          {options.length > 6 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar..."
                className="h-9 pl-9 text-[13px]"
              />
            </div>
          )}
          <div className="max-h-[46dvh] overflow-y-auto">
            {visible.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
            ) : (
              visible.map((o) => {
                const on = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => toggle(o.id)}
                    aria-pressed={on}
                    className="flex min-h-8 w-full items-center gap-2.5 text-left text-[12.5px] font-semibold text-foreground"
                  >
                    <span
                      className={`grid size-4 shrink-0 place-items-center rounded-[5px] ${
                        on
                          ? "bg-primary text-primary-foreground"
                          : "shadow-[inset_0_0_0_1.5px_color-mix(in_oklab,var(--foreground)_25%,transparent)]"
                      }`}
                    >
                      {on && <Check className="size-2.5" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 truncate">{o.label}</span>
                  </button>
                );
              })
            )}
          </div>
          <button
            type="button"
            onClick={confirm}
            disabled={saving || selected.length === 0}
            className="ds-3d ds-3d-hover relative flex h-10 w-full items-center justify-center overflow-hidden rounded-md bg-card text-[12px] font-bold text-foreground disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              `Vincular ${selected.length || ""}`.trim()
            )}
          </button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {options.length > 6 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar..."
              className="pl-9"
            />
          </div>
        )}

        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto pr-0.5">
          {visible.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            visible.map((o) => {
              const on = selected.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggle(o.id)}
                  aria-pressed={on}
                  className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[0.3rem] border px-3 py-2.5 text-left transition-colors ${
                    on
                      ? "border-primary/50 bg-primary/10"
                      : "border-border bg-card hover:bg-secondary/50"
                  }`}
                >
                  <span
                    className={`grid size-[18px] shrink-0 place-items-center rounded-[0.2rem] border ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-medium text-foreground">
                      {o.label}
                    </span>
                    {o.hint && <span className="block truncate ds-meta">{o.hint}</span>}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className="ds-meta">{selected.length} selecionado(s)</p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={confirm} disabled={saving} className="min-w-[140px]">
              {saving ? <Loader2 className="size-4 animate-spin" /> : confirmLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
