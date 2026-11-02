import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho padrão de página do Sistema de Design.
 * - Page Title: Sora 700 22px
 * - Page Subtitle: Manrope 400 13px (muted)
 * - Ações à direita, nunca quebrando em 2ª linha (rolagem horizontal no mobile)
 * - 40px de respiro até o primeiro conteúdo
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:flex sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="ds-eyebrow">{eyebrow}</p> : null}
        <h1 className="ds-page-title truncate">{title}</h1>
        {subtitle ? <p className="ds-page-subtitle mt-1">{subtitle}</p> : null}
      </div>

      {actions ? <div className="ds-scroll-x gap-2 max-w-full">{actions}</div> : null}
    </header>
  );
}

/** Barra de ações/filtros/abas que rola na horizontal em vez de quebrar. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ds-scroll-x gap-2 py-0.5", className)}>{children}</div>;
}
