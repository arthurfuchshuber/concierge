import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Barra horizontal de filtros/abas (pacote UX v4).
 *
 * Regra: uma barra de opções NUNCA quebra em segunda linha nem esconde itens
 * atrás de "mais". Ela rola na horizontal e mostra um esmaecimento na borda
 * enquanto houver conteúdo fora da vista, para o usuário saber que pode
 * arrastar.
 */
export function PillScroller({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 4, right: max > 4 && el.scrollLeft < max - 4 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [children]);

  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={ref}
        className={cn("no-scrollbar flex items-center gap-2 overflow-x-auto", contentClassName)}
      >
        {children}
      </div>
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background to-transparent transition-opacity",
          edges.left ? "opacity-100" : "opacity-0",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent transition-opacity",
          edges.right ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

/** Pílula de filtro/aba — altura única de 36px, como todo botão do sistema. */
export function FilterPill({
  active,
  onClick,
  children,
  count,
  className,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  count?: number;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "ui-pill shrink-0 whitespace-nowrap",
        active ? "ui-pill-active" : "ui-pill-idle",
        className,
      )}
    >
      {children}
      {typeof count === "number" && (
        <span className={cn("ml-1 tabular-nums", active ? "opacity-90" : "opacity-70")}>
          · {count}
        </span>
      )}
    </button>
  );
}
