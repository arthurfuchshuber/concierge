import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, Menu } from "lucide-react";
import conciergeLogo from "@/assets/concierge-logo.png";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Data dourada das páginas ("Domingo, 22 de novembro"), a mesma do `PageShell`/`DialogDateRow`. */
export function hojeExtenso(): string {
  return new Date()
    .toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "numeric", month: "long" })
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** Evento que o layout do painel escuta para abrir o menu lateral do celular. */
export const ABRIR_MENU_EVENT = "sg:abrir-menu";

const VOLTAR_CLASS =
  "inline-flex h-[26px] shrink-0 cursor-pointer items-center gap-0.5 rounded-[8px] bg-[color-mix(in_oklab,var(--foreground)_9%,transparent)] pl-1.5 pr-2.5 text-[12px] font-bold text-foreground/80 transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_16%,transparent)] hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * TOPO DA JANELA DE TELA CHEIA NO CELULAR (mockup "TelaCheia-01/02" opção A, aprovado em 22/11/2026: "sempre
 * o botão voltar, e exatamente nessa posição"). Repete o cabeçalho do sistema (menu, marca e tema) e, logo
 * abaixo, a data dourada com o "‹ Voltar" à direita — o título e o subtítulo da própria janela vêm em seguida,
 * no tamanho do título de página (ver `.sg-tela-cheia` em styles.css). Só aparece abaixo de `lg`.
 * "‹ Voltar" volta uma camada (`onBack`) ou fecha a janela. O menu fecha a janela e abre o menu lateral.
 */
export function TelaCheiaTop({ onBack }: { onBack?: () => void }) {
  const voltar = (
    <>
      <ChevronLeft className="size-[15px]" strokeWidth={2.4} />
      Voltar
    </>
  );
  return (
    <div data-tela-cheia-top className="shrink-0 bg-background lg:hidden">
      <div className="flex h-[60px] items-center justify-between border-b border-border px-3">
        <DialogPrimitive.Close
          className="grid size-11 place-items-center rounded-xl text-foreground transition-colors hover:bg-secondary/60"
          aria-label="Abrir menu"
          onClick={() => window.setTimeout(() => window.dispatchEvent(new Event(ABRIR_MENU_EVENT)), 0)}
        >
          <Menu className="size-5" />
        </DialogPrimitive.Close>
        <span className="inline-flex items-center gap-2.5">
          <img src={conciergeLogo} alt="" className="size-9 shrink-0 rounded-lg object-contain" />
          <span className="font-display text-[18px] font-bold leading-none tracking-[-0.01em]">ConciergeIA</span>
        </span>
        <ThemeToggle />
      </div>
      <div className="flex min-w-0 items-center justify-between gap-3 px-4 pt-[18px]">
        <p className="ds-eyebrow ds-data truncate text-[10.5px] leading-[26px] tracking-[0.2em]">{hojeExtenso()}</p>
        {onBack ? (
          <button type="button" data-window-back onClick={onBack} className={VOLTAR_CLASS}>
            {voltar}
          </button>
        ) : (
          <DialogPrimitive.Close data-window-close className={VOLTAR_CLASS}>
            {voltar}
          </DialogPrimitive.Close>
        )}
      </div>
    </div>
  );
}
