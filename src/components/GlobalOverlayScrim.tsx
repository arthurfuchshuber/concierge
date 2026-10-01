import * as React from "react";
import { useGlobalOverlayOpen, useTopOverlayZ } from "@/lib/global-overlay-store";
import { cn } from "@/lib/utils";

/**
 * O VÉU POR TRÁS DE QUALQUER POPOVER/DROPDOWN ABERTO (pedido explícito,
 * 24/09/2026, mockup aprovado "Fundo com desfoque" — escurecimento ajustado
 * para 10% no mesmo pedido).
 *
 * `Popover`/`DropdownMenu` (ver `ui/popover.tsx`/`ui/dropdown-menu.tsx`)
 * avisam `pushGlobalOverlay()` quando abrem; este componente só lê esse
 * estado e desenha o véu por cima do app — montado uma única vez, aqui no
 * `__root`. `backdrop-filter` (em vez de borrar o conteúdo da página) porque
 * o conteúdo do Popover/DropdownMenu é renderizado num Portal fora da árvore
 * do app: com um véu abaixo dele (mas acima de tudo o resto) o desfoque
 * atinge só o fundo, nunca o próprio tooltip.
 *
 * A Dialog (janelas maiores) tem seu próprio overlay (z-50) — mas um
 * Popover/DropdownMenu pode abrir POR CIMA de um Dialog já aberto (ex.: o
 * editor de "Previsão" dentro de um card expandido), e nesse caso o véu
 * também precisa cobrir o conteúdo do Dialog, não só o fundo da página —
 * daí z-[55] (acima do Dialog) em vez do z-40 original. O conteúdo do
 * próprio Popover/DropdownMenu sobe ainda mais (z-[60], ver
 * `ui/popover.tsx`/`ui/dropdown-menu.tsx`) pra continuar nítido por cima do
 * véu (bug real corrigido 24/09/2026: sem isso o desfoque nunca aparecia
 * nesse caso, e o Dialog ficava cheio/cluttered atrás do popover pequeno).
 *
 * A TELA DE TRÁS NÃO ROLA (pedido explícito, 01/10/2026): "a tela principal
 * NÃO PODE SER rolada quando um tooltip estiver aberto — ela está rolando por
 * trás e atrapalhando a visibilidade do tooltip". O Popover do Radix não
 * trava a rolagem (só o Dialog trava). Como o véu cobre a tela inteira, é ele
 * que recebe o gesto: roda/arrasto sobre o véu não chegam mais à página
 * (`wheel`/`touchmove` com `preventDefault`, ouvintes NÃO passivos — o React
 * registra esses eventos como passivos e não deixaria impedir) e
 * `touch-action: none` impede o gesto de começar. Sem mexer em `overflow` da
 * página, para nada deslocar de lugar quando a barra de rolagem some. O
 * conteúdo do tooltip, que fica ACIMA do véu, continua rolando por dentro e
 * não passa a rolagem para a página quando chega ao fim (`overscroll-contain`,
 * ver `ui/popover.tsx` e `filter-panel.tsx`).
 */
export function GlobalOverlayScrim() {
  const open = useGlobalOverlayOpen();
  const z = useTopOverlayZ();
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || !open) return;
    const stop = (e: Event) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener("wheel", stop, { passive: false });
    el.addEventListener("touchmove", stop, { passive: false });
    return () => {
      el.removeEventListener("wheel", stop);
      el.removeEventListener("touchmove", stop);
    };
  }, [open]);
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-global-scrim=""
      style={{ zIndex: z - 1, touchAction: open ? "none" : undefined }}
      className={cn(
        "fixed inset-0 z-[55] bg-black/10 backdrop-blur-[2.5px] transition-opacity duration-150",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
    />
  );
}
