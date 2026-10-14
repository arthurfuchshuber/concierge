import { useRef, useState, type ElementType, type ReactNode } from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * NOME EM UMA LINHA, COM RETICÊNCIAS (regra global de janelas, 14/10/2026).
 *
 * Nome de imóvel/anúncio nunca quebra em duas linhas: fica em uma linha com "…" e,
 * quando está cortado, tocar nele abre uma dica com o nome completo. Se o nome
 * cabe inteiro, o toque passa direto (por exemplo, para selecionar a linha).
 * Em linhas de seleção (`passThrough`) o toque também segue para a linha.
 */
export function ClampName({
  text,
  as: Tag = "span",
  passThrough,
  className,
  children,
}: {
  text: string;
  as?: ElementType;
  /** Linha clicável (seleção): mostra o nome completo E deixa o toque seguir para a linha. */
  passThrough?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Tag
          ref={ref}
          title={text}
          className={cn("block min-w-0 max-w-full truncate", className)}
          onClick={(e: React.MouseEvent) => {
            const el = ref.current;
            if (!el || el.scrollWidth <= el.clientWidth + 1) return;
            if (!passThrough) {
              e.preventDefault();
              e.stopPropagation();
            }
            setOpen((o) => !o);
          }}
        >
          {children ?? text}
        </Tag>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="ds-overlay-compact w-auto max-w-[min(18rem,calc(100vw-32px))] px-3 py-1.5 text-xs font-semibold leading-snug"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {text}
      </PopoverContent>
    </Popover>
  );
}
