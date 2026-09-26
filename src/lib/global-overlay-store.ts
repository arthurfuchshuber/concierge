import * as React from "react";

/**
 * PILHA ÚNICA DE JANELAS ABERTAS (pedidos de 24 e 26/09/2026).
 *
 * Todo Popover/DropdownMenu ("float") e toda Dialog/Sheet/Drawer ("window")
 * se registra aqui ao montar o conteúdo e sai ao desmontar. Dois usos:
 *  1. `GlobalOverlayScrim` desenha o véu enquanto houver algum "float".
 *  2. "CLICAR FORA SÓ FECHA A JANELA DO TOPO": só a última aberta reage ao
 *     clique fora; as de baixo ignoram — a tela recua exatamente uma janela,
 *     na ordem em que foram abertas, seja qual for o tipo.
 */

type Kind = "float" | "window";
type Listener = () => void;
const listeners = new Set<Listener>();
let stack: { id: number; kind: Kind }[] = [];
let seq = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function pushGlobalOverlay(kind: Kind = "float"): { id: number; release: () => void } {
  const id = ++seq;
  stack = [...stack, { id, kind }];
  emit();
  let released = false;
  return {
    id,
    release: () => {
      if (released) return;
      released = true;
      stack = stack.filter((l) => l.id !== id);
      emit();
    },
  };
}

export function isTopOverlay(id: number | null): boolean {
  if (id == null) return true;
  return stack.length === 0 || stack[stack.length - 1].id === id;
}

/**
 * Registra a camada enquanto o NÓ estiver de fato no DOM (ref de callback,
 * não efeito: árvores ocultas/pré-carregadas reconectam efeitos sem que a
 * janela esteja visível — isso deixava o véu preso na tela).
 * Devolve [idRef, ref] — combine `ref` com o ref encaminhado do componente.
 */
export function useOverlayLayer<T extends Element>(
  kind: Kind,
  forwarded?: React.ForwardedRef<T>,
): [React.MutableRefObject<number | null>, (node: T | null) => void] {
  const idRef = React.useRef<number | null>(null);
  const releaseRef = React.useRef<(() => void) | null>(null);
  const fwd = React.useRef(forwarded);
  fwd.current = forwarded;
  const ref = React.useCallback(
    (node: T | null) => {
      releaseRef.current?.();
      releaseRef.current = null;
      idRef.current = null;
      if (node) {
        const layer = pushGlobalOverlay(kind);
        idRef.current = layer.id;
        releaseRef.current = layer.release;
      }
      const f = fwd.current;
      if (typeof f === "function") f(node);
      else if (f) f.current = node;
    },
    [kind],
  );
  React.useEffect(() => () => releaseRef.current?.(), []);
  return [idRef, ref];
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Véu só quando a camada do TOPO é flutuante: uma janela aberta por cima de um
// popover não pode ficar embaixo do véu.
const getSnapshot = () => stack.length > 0 && stack[stack.length - 1].kind === "float";
const getServerSnapshot = () => false;

/** true enquanto qualquer Popover/DropdownMenu do app estiver aberto. */
export function useGlobalOverlayOpen(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Bloqueia o "clique fora" de uma camada que não é a do topo. */
export function guardNestedOutside<E extends { preventDefault: () => void }>(
  idRef: React.MutableRefObject<number | null>,
  handler?: (e: E) => void,
) {
  return (e: E) => {
    if (!isTopOverlay(idRef.current)) {
      e.preventDefault();
      return;
    }
    handler?.(e);
  };
}
