import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type WorkspaceTab = {
  key: string;
  label: ReactNode;
  /** Rota (quando as abas são páginas separadas). */
  to?: string;
};

/**
 * Cabeçalho padrão dos workspaces (referência: página "Operação").
 * - Título Sora 700 22px + subtítulo Manrope 13px muted
 * - Segmented control ocupando 100% da largura da página, cantos 0.3rem,
 *   fundo foreground/5, abas flex-1 com 46px de altura mínima,
 *   aba ativa com gradiente roxo→rosa.
 */
export function WorkspaceHeader({
  title,
  subtitle,
  tabs,
  activeTab,
  onTabChange,
  renderLink,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  tabs?: WorkspaceTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  /** Para abas que navegam por rota, o consumidor fornece o <Link>. */
  renderLink?: (tab: WorkspaceTab, className: string, active: boolean) => ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h1 className="ds-page-title truncate">{title}</h1>
        {subtitle ? <p className="ds-page-subtitle mt-1.5">{subtitle}</p> : null}
      </div>

      {tabs && tabs.length > 0 ? (
        <nav className="mb-5 flex w-full overflow-hidden rounded-[0.3rem] bg-foreground/5">
          {tabs.map((t) => {
            const active = t.key === activeTab;
            const cls = `flex-1 px-3 py-3.5 text-center text-sm font-semibold leading-none flex items-center justify-center gap-2 min-h-[46px] transition-colors ${
              active
                ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                : "text-muted-foreground hover:text-foreground"
            }`;
            if (renderLink) return <span key={t.key}>{renderLink(t, cls, active)}</span>;
            return (
              <button key={t.key} type="button" className={cls} onClick={() => onTabChange?.(t.key)}>
                {t.label}
              </button>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}
