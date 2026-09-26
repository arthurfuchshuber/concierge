import * as React from "react";

/**
 * FUNDO COM DESFOQUE GLOBAL (pedido explícito, 24/09/2026: "que tal
 * colocarmos um fundo com um desfoque de leve destaque... para toda vez que
 * abrirmos um tooltip/popover/janela/filtro", ajustado depois para 10% de
 * escurecimento — mockup aprovado "Fundo com desfoque").
 *
 * Central mínima (sem Context/Provider) que qualquer Popover/DropdownMenu do
 * sistema avisa quando abre e fecha. `GlobalOverlayScrim` (montado uma única
 * vez no `__root`) lê esse estado e desenha o véu escurecido + desfocado por
 * cima do resto do app enquanto `openCount > 0`. Um contador (não um
 * booleano) porque mais de um pode estar aberto ao mesmo tempo (ex.: um
 * DropdownMenu com um Popover dentro) — o véu só some quando o ÚLTIMO fecha.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
let openCount = 0;

function emit() {
  listeners.forEach((l) => l());
}

/** Chame ao abrir; guarde e chame a função devolvida ao fechar. */
export function pushGlobalOverlay(): () => void {
  openCount += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    openCount = Math.max(0, openCount - 1);
    emit();
  };
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return openCount > 0;
}

function getServerSnapshot() {
  return false;
}

/** true enquanto qualquer Popover/DropdownMenu do app estiver aberto. */
export function useGlobalOverlayOpen(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * "CLICAR FORA SÓ FECHA A ÚLTIMA JANELA" (pedido explícito, 26/09/2026):
 * um clique no véu ou dentro de um popover/menu/tooltip aberto por cima de
 * um Dialog/Sheet/Drawer não pode fechar essa janela de baixo — só a de
 * cima fecha, e a tela volta para a janela onde o clique aconteceu.
 */
export function guardNestedOutside<E extends { target: EventTarget | null; preventDefault: () => void }>(
  handler?: (e: E) => void,
) {
  return (e: E) => {
    const t = e.target as Element | null;
    const nested =
      openCount > 0 ||
      !!t?.closest?.("[data-global-scrim],[data-radix-popper-content-wrapper]");
    if (nested) {
      e.preventDefault();
      return;
    }
    handler?.(e);
  };
}
