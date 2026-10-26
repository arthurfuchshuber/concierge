import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

const INTERACTIVE =
  "button, a, input, select, textarea, label, [role='button'], [role='checkbox'], [role='switch'], [data-radix-popper-content-wrapper]";

/**
 * Pressionar e segurar (touch e mouse), sem dependências.
 *  - dispara após `delay` ms contínuos (padrão 500);
 *  - cancela se o ponteiro andar mais de `tolerance` px (rolagem natural da
 *    página) ou se o navegador cancelar o toque (início de scroll);
 *  - ignora toques nascidos em controles internos (chat, interruptor, links);
 *  - quando dispara, o `click` que vem ao soltar o dedo é engolido
 *    (`consumeClick` devolve true uma única vez) para não abrir o menu.
 */
export function useLongPress(
  onLongPress: () => void,
  { delay = 500, tolerance = 8 }: { delay?: number; tolerance?: number } = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  cb.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      fired.current = false;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = e.target as HTMLElement | null;
      const interactive = el?.closest(INTERACTIVE);
      if (interactive && interactive !== e.currentTarget) return;
      start.current = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        try {
          navigator.vibrate?.(40);
        } catch {
          /* sem vibração disponível */
        }
        cb.current();
      }, delay);
    },
    [delay],
  );
  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const s = start.current;
      if (!s || !timer.current) return;
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > tolerance) cancel();
    },
    [tolerance, cancel],
  );

  /** true UMA vez após um long press: o chamador deve ignorar esse click. */
  const consumeClick = useCallback(() => {
    if (!fired.current) return false;
    fired.current = false;
    return true;
  }, []);

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onPointerLeave: cancel,
      // Evita o menu de contexto/seleção de texto do toque longo no celular.
      onContextMenu: (e: ReactMouseEvent) => {
        if (fired.current || timer.current) e.preventDefault();
      },
    },
    consumeClick,
  };
}
