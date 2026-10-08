import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

/** Linha única: campo de busca que cresce + barra de ações à direita
 * (mesmo desenho da página Guias).
 *
 * BUSCA + FILTROS = UMA PEÇA SÓ NO CELULAR (pedido explícito, 08/10/2026,
 * mockup B aprovado): antes eram dois objetos separados (28px de altura, botões
 * de 36px). Agora o celular tem UMA casca de 40px de altura, com a busca e os
 * botões dentro, separados por fios, e cada botão com 48px de largura. O
 * TAMANHO DOS ÍCONES não mudou (lupa 14px, demais 15px). No computador o
 * desenho continua o de antes — dois objetos, na altura da barra de abas. */
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
    <div
      className={`flex min-w-0 items-stretch max-lg:ds-3d max-lg:ds-3d-hover max-lg:h-10 max-lg:overflow-hidden max-lg:rounded-[9px] max-lg:bg-card lg:items-center lg:gap-2 ${className}`}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full bg-transparent pl-9 pr-9 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none lg:ds-3d lg:relative lg:h-[var(--ds-action-h-lg)] lg:overflow-hidden lg:rounded-[13px] lg:border-0 lg:bg-card"
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
        <div className="ds-icon-actions flex shrink-0 divide-x divide-[color-mix(in_oklab,var(--foreground)_11%,transparent)] max-lg:border-l max-lg:border-[color-mix(in_oklab,var(--foreground)_11%,transparent)] max-lg:[&>*]:!w-12 max-lg:[&>*]:!flex-none max-lg:[&>*]:!px-0 lg:ds-3d lg:ds-3d-hover lg:relative lg:h-[var(--ds-action-h-lg)] lg:overflow-hidden lg:rounded-[13px] lg:bg-card">
          {actions}
        </div>
      )}
    </div>
  );
}
