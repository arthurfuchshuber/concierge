import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";

/**
 * Padrão único de feedback de ação no produto:
 * - mensagem informativa no topo da tela (toast do sonner, 5s)
 * - botão "Desfazer" flutuante no canto inferior direito, também por 5s
 *
 * Use `notifyAction("Check-out confirmado.", () => desfazer())`. Sem função de
 * desfazer, só a mensagem do topo aparece.
 */

type UndoEntry = { id: number; message: string; onUndo: () => void; expiresAt: number };

let current: UndoEntry | null = null;
const listeners = new Set<(e: UndoEntry | null) => void>();
let seq = 0;

function emit() {
  for (const l of listeners) l(current);
}

function clearUndo(id?: number) {
  if (id !== undefined && current?.id !== id) return;
  current = null;
  emit();
}

export const UNDO_WINDOW_MS = 5000;

export function notifyAction(message: string, onUndo?: () => void) {
  toast.success(message, { duration: UNDO_WINDOW_MS });
  if (!onUndo) return;
  const id = ++seq;
  current = { id, message, onUndo, expiresAt: Date.now() + UNDO_WINDOW_MS };
  emit();
  window.setTimeout(() => clearUndo(id), UNDO_WINDOW_MS);
}

export function UndoActionBar() {
  const [entry, setEntry] = useState<UndoEntry | null>(current);

  useEffect(() => {
    listeners.add(setEntry);
    return () => {
      listeners.delete(setEntry);
    };
  }, []);

  if (!entry) return null;

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-4 z-[80] flex justify-end sm:inset-x-auto sm:right-5">
      <button
        type="button"
        onClick={() => {
          const e = entry;
          clearUndo(e.id);
          e.onUndo();
        }}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-card/95 px-4 py-2 text-sm font-medium text-foreground shadow-lg backdrop-blur transition hover:bg-accent hover:text-accent-foreground"
      >
        <Undo2 className="size-4 shrink-0" />
        Desfazer
      </button>
    </div>
  );
}
