import type { ReactNode } from "react";
import { Search, X } from "lucide-react";
import { ACTION_BAR, PANEL_SHELL } from "./panel-chrome";

/** Linha única: campo de busca que cresce + barra de ações à direita
 * (mesmo desenho da página Guias). */
export function SearchActionRow({
  value,
  onChange,
  placeholder,
  actions,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${PANEL_SHELL} !rounded-[9px] lg:!rounded-[13px] h-[var(--ds-action-h)] w-full pl-9 pr-9 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none lg:h-[var(--ds-action-h-lg)]`}
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-2 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      {actions && (
        <div className={`${ACTION_BAR} !w-auto shrink-0 ds-icon-actions`}>{actions}</div>
      )}
    </div>
  );
}
