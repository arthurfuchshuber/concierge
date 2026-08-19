import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Cabeçalho padrão de página do painel (pacote UX v4).
 *
 * Eyebrow (10.5px, caixa alta, tom âmbar) → Título (Sora 700 · 22px) →
 * Subtítulo (Manrope 400 · 13px, muted). O espaçamento até o primeiro
 * conteúdo da página é sempre space-10 (40px) — quem usa este componente
 * não repete margens próprias.
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
  /** Ações à direita do título (desktop) — sempre botões de 36px. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-10", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {eyebrow ? <div className="ui-eyebrow mb-2">{eyebrow}</div> : null}
          <h1 className="ui-page-title">{title}</h1>
          {subtitle ? <p className="ui-page-subtitle mt-1.5">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function SectionTitle({
  children,
  className,
  right,
}: {
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={cn("mb-6 flex items-center justify-between gap-3", className)}>
      <h2 className="ui-section-title">{children}</h2>
      {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
    </div>
  );
}
