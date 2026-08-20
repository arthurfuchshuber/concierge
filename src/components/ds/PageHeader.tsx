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
  title,
  subtitle,
  actions,
  className,
}: {
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
        <h1 className="ds-page-title truncate">{title}</h1>
        {subtitle ? <p className="ds-page-subtitle mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="ds-scroll-x gap-2 max-w-full">{actions}</div> : null}
    </header>
  );
}

/** Título de seção (Sora 700 15px) com 24px até o conteúdo. */
export function SectionTitle({
  children,
  className,
  actions,
}: {
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between",
        className,
      )}
    >
      <h2 className="ds-section-title min-w-0 truncate">{children}</h2>
      {actions ? <div className="ds-scroll-x gap-2">{actions}</div> : null}
    </div>
  );
}

/** Barra de ações/filtros/abas que rola na horizontal em vez de quebrar. */
export function ActionBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ds-scroll-x gap-2 py-0.5", className)}>{children}</div>;
}
