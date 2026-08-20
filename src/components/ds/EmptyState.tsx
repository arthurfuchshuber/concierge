import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Estado vazio padrão do Sistema de Design (ref.: mockups
 * 05_padroes_sistema/01_vazio_conta_nova e 02_vazio_busca).
 * Ícone em bloco arredondado, título, descrição de apoio (até 2 linhas) e
 * uma ação opcional (botão primário para "conta nova", ação neutra para
 * "sem resultados de busca").
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "ds-surface border border-dashed border-border bg-card/30 p-12 text-center",
        className,
      )}
    >
      <div className="size-12 ds-surface bg-secondary grid place-items-center mx-auto mb-4">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <h3 className="ds-section-title mb-2">{title}</h3>
      {description ? (
        <p className="ds-body text-muted-foreground mb-5 max-w-md mx-auto">{description}</p>
      ) : null}
      {action ? <div className="flex justify-center">{action}</div> : null}
    </div>
  );
}
