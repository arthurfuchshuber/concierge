import { useGlobalOverlayOpen } from "@/lib/global-overlay-store";
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
 * A Dialog (janelas maiores) já tem seu próprio overlay, mais forte, e
 * continua exatamente como está — este véu nunca se aplica a ela.
 */
export function GlobalOverlayScrim() {
  const open = useGlobalOverlayOpen();
  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 z-40 bg-black/10 backdrop-blur-[2.5px] transition-opacity duration-150",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
    />
  );
}
