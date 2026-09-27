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
let stack: { id: number; kind: Kind; z: number }[] = [];
let seq = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function pushGlobalOverlay(kind: Kind = "float"): { id: number; release: () => void } {
  const id = ++seq;
  // Z sempre acima da camada mais alta ainda aberta — calcular pelo índice
  // fazia uma janela nova empatar com a de baixo quando alguma camada
  // intermediária fechava (a nova ficava sob o véu e "fechava sozinha").
  const top = stack.reduce((m, l) => Math.max(m, l.z), 57);
  stack = [...stack, { id, kind, z: top + 3 }];
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

export function layerZ(id: number): number {
  return stack.find((l) => l.id === id)?.z ?? 60;
}

export function useTopOverlayZ(): number {
  return React.useSyncExternalStore(
    subscribe,
    () => (stack.length ? stack[stack.length - 1].z : 55),
    () => 55,
  );
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
  const nodeRef = React.useRef<T | null>(null);
  const pendingRelease = React.useRef(false);
  const fwd = React.useRef(forwarded);
  fwd.current = forwarded;
  const ref = React.useCallback(
    (node: T | null) => {
      const forward = () => {
        const f = fwd.current;
        if (typeof f === "function") f(node);
        else if (f) f.current = node;
      };
      // MESMO NÓ REANEXADO: o Radix troca a função de ref a cada render de
      // janelas aninhadas (null → mesmo nó). Tratar isso como "reabriu"
      // jogava a janela de baixo para o topo da pilha, cobrindo a nova — era
      // por isso que a janela de anexo "abria e fechava" na Fila de Limpeza.
      if (node && node === nodeRef.current && idRef.current != null) {
        pendingRelease.current = false;
        forward();
        return;
      }
      if (!node) {
        // Solta só se o nó não voltar no mesmo ciclo.
        pendingRelease.current = true;
        queueMicrotask(() => {
          if (!pendingRelease.current) return;
          pendingRelease.current = false;
          releaseRef.current?.();
          releaseRef.current = null;
          idRef.current = null;
          nodeRef.current = null;
        });
        forward();
        return;
      }
      pendingRelease.current = false;
      releaseRef.current?.();
      releaseRef.current = null;
      idRef.current = null;
      nodeRef.current = node;
      if (node) {
        const layer = pushGlobalOverlay(kind);
        idRef.current = layer.id;
        releaseRef.current = layer.release;
        // Z-INDEX PELA ORDEM DE ABERTURA: a janela aberta por último fica
        // sempre por cima (ex.: Resolver pendência sobre a lista de
        // pendências), e o véu fica logo abaixo dela.
        const z = String(layerZ(layer.id));
        (node as unknown as HTMLElement).style.zIndex = z;
        const wrap = node.parentElement;
        if (wrap?.hasAttribute("data-radix-popper-content-wrapper")) wrap.style.zIndex = z;
        // O Radix recalcula o z-index do invólucro depois de montar — reaplica
        // para listas (Select) dentro de janelas não ficarem por trás delas.
        const el = node as unknown as HTMLElement;
        const reapply = () => {
          if (idRef.current !== layer.id) return;
          el.style.zIndex = z;
          const w = el.parentElement;
          if (w?.hasAttribute("data-radix-popper-content-wrapper")) w.style.zIndex = z;
        };
        if (typeof requestAnimationFrame !== "undefined") {
          requestAnimationFrame(() => { reapply(); requestAnimationFrame(reapply); });
          setTimeout(reapply, 60);
        }
        const prev = node.previousElementSibling as HTMLElement | null;
        if (prev && prev.getAttribute("data-state") && !prev.hasAttribute("role")) {
          prev.style.zIndex = String(Number(z) - 1);
        }
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

/**
 * Integra listas flutuantes feitas à mão (autocompletes/docks) à mesma pilha
 * dos componentes Radix. Só a camada visível no topo reage ao clique externo.
 */
export function useManualOverlayLayer<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
): React.RefObject<T | null> {
  const nodeRef = React.useRef<T | null>(null);
  const idRef = React.useRef<number | null>(null);
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;

  React.useEffect(() => {
    if (!open) return;
    const layer = pushGlobalOverlay("float");
    idRef.current = layer.id;
    const node = nodeRef.current;
    if (node) node.style.zIndex = String(layerZ(layer.id));

    const handlePointerDown = (event: PointerEvent) => {
      if (!isTopOverlay(idRef.current)) return;
      if (nodeRef.current?.contains(event.target as Node)) return;
      dismissRef.current();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      layer.release();
      idRef.current = null;
    };
  }, [open]);

  return nodeRef;
}
