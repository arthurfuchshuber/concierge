import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";

/**
 * Padrão único de feedback de ação no produto:
 * - mensagem informativa no topo da tela (toast do sonner, 5s)
 * - botão "Desfazer" DESTACADO, também por 5s
 *
 * Use `notifyAction("Check-out confirmado.", () => desfazer())`. Sem função de
 * desfazer, só a mensagem do topo aparece.
 *
 * DESFAZER EM QUALQUER AÇÃO (pedido explícito, 17/09/2026): "precisa mostrar
 * o botão 'Desfazer' sobre QUALQUER AÇÃO realizada, por 5 segundos, de forma
 * destacada". Mockup aprovado com um ajuste do cliente: o botão leva SÓ a
 * palavra "Desfazer" — nada de nome de imóvel ou detalhe da ação (a mensagem
 * continua no topo). Borda em gradiente da marca e uma linha que esvazia nos
 * 5 segundos, para a pessoa ver quanto tempo ainda tem.
 *
 * No celular ele fica centralizado logo ACIMA do menu inferior (antes ficava
 * no canto, por cima do menu e do botão flutuante do assistente).
 *
 * `onExpire` roda quando os 5s acabam sem ninguém desfazer — é onde mora a
 * limpeza definitiva de algo que precisou ficar guardado para o desfazer
 * funcionar (ex.: o arquivo de um registro excluído). Uma nova ação no meio
 * da janela encerra a anterior: o desfazer antigo sai de cena e o `onExpire`
 * dele roda na hora.
 */

type UndoEntry = {
  id: number;
  message: string;
  onUndo: () => void;
  onExpire?: () => void;
  expiresAt: number;
};

let current: UndoEntry | null = null;
const listeners = new Set<(e: UndoEntry | null) => void>();
let seq = 0;

function emit() {
  for (const l of listeners) l(current);
}

function finish(id: number, how: "undo" | "expire") {
  if (current?.id !== id) return;
  const e = current;
  current = null;
  emit();
  if (how === "undo") e.onUndo();
  else e.onExpire?.();
}

export const UNDO_WINDOW_MS = 5000;

export function notifyAction(
  message: string,
  onUndo?: () => void,
  options?: { onExpire?: () => void },
) {
  toast.success(message, { duration: UNDO_WINDOW_MS });
  if (!onUndo) {
    options?.onExpire?.();
    return;
  }
  if (current) finish(current.id, "expire");
  const id = ++seq;
  current = {
    id,
    message,
    onUndo,
    onExpire: options?.onExpire,
    expiresAt: Date.now() + UNDO_WINDOW_MS,
  };
  emit();
  window.setTimeout(() => finish(id, "expire"), UNDO_WINDOW_MS);
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
  const remaining = Math.max(0, entry.expiresAt - Date.now());

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(104px+env(safe-area-inset-bottom))] z-[80] flex justify-center px-3 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:px-0">
      <div
        key={entry.id}
        className="pointer-events-auto rounded-[14px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] p-px shadow-[0_18px_40px_-12px_rgba(232,45,174,0.55)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200"
      >
        <button
          type="button"
          onClick={() => finish(entry.id, "undo")}
          className="relative flex h-11 items-center gap-2 overflow-hidden rounded-[13px] bg-[#1a1016] px-5 text-[14px] font-extrabold text-white transition-colors hover:bg-[#241420]"
        >
          <Undo2 className="size-[17px] shrink-0" strokeWidth={2.4} />
          Desfazer
          <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/[0.06]">
            <span
              className="undo-drain block h-full origin-left bg-gradient-to-r from-[#7C1AD8] to-[#E82DAE]"
              style={{ animationDuration: `${remaining}ms` }}
            />
          </span>
        </button>
      </div>
    </div>
  );
}
