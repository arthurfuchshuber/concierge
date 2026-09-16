import { cn } from "@/lib/utils";

/**
 * Skeleton de carregamento padrão do Sistema de Design (ref.: mockup
 * 10_carregamento_upload/01_loading_skeleton). Blocos com raio de 8px
 * (ds-surface) e gap de 6px entre os itens, imitando a silhueta de um card
 * de guia/imóvel: imagem + duas linhas de texto.
 */
export function LoadingState({
  count = 3,
  className,
  columns = "grid md:grid-cols-2 lg:grid-cols-3",
}: {
  count?: number;
  className?: string;
  columns?: string;
}) {
  return (
    <div className={cn(columns, "gap-1.5", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ds-surface border border-border bg-card overflow-hidden">
          <div className="aspect-[16/10] bg-secondary animate-pulse" />
          <div className="p-4 space-y-2">
            <div className="h-4 bg-secondary rounded animate-pulse w-2/3" />
            <div className="h-3 bg-secondary rounded animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Variante em lista (linhas), para telas de diretório/tabela. */
export function LoadingListState({ count = 3, className }: { count?: number; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="ds-surface border border-border bg-card p-4">
          <div className="h-4 bg-secondary rounded animate-pulse w-1/3 mb-2" />
          <div className="h-3 bg-secondary rounded animate-pulse w-1/2" />
        </div>
      ))}
    </div>
  );
}
