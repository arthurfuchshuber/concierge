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
 * A Dialog (janelas maiores) tem seu próprio overlay (z-50) — mas um
 * Popover/DropdownMenu pode abrir POR CIMA de um Dialog já aberto (ex.: o
 * editor de "Previsão" dentro de um card expandido), e nesse caso o véu
 * também precisa cobrir o conteúdo do Dialog, não só o fundo da página —
 * daí z-[55] (acima do Dialog) em vez do z-40 original. O conteúdo do
 * próprio Popover/DropdownMenu sobe ainda mais (z-[60], ver
 * `ui/popover.tsx`/`ui/dropdown-menu.tsx`) pra continuar nítido por cima do
 * véu (bug real corrigido 24/09/2026: sem isso o desfoque nunca aparecia
 * nesse caso, e o Dialog ficava cheio/cluttered atrás do popover pequeno).
 */
export function GlobalOverlayScrim() {
  const open = useGlobalOverlayOpen();
  return (
    <div
      aria-hidden="true"
      className={cn(
        "fixed inset-0 z-[55] bg-black/10 backdrop-blur-[2.5px] transition-opacity duration-150",
        open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
      )}
    />
  );
}
