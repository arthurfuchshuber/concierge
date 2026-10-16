import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

/** Linha única: campo de busca que cresce + barra de ações à direita
 * (mesmo desenho da página Guias).
 *
 * BUSCA + FILTROS = UMA PEÇA SÓ NO CELULAR (pedido explícito, 08/10/2026,
 * mockup B aprovado): antes eram dois objetos separados (28px de altura, botões
 * de 36px). Agora o celular tem UMA casca de 40px de altura, com a busca e os
 * botões dentro, separados por fios, e cada botão com 48px de largura. O
 * TAMANHO DOS ÍCONES não mudou (lupa 14px, demais 15px).
 *
 * PROFUNDIDADE IGUAL À DOS CARDS (pedido explícito, 08/10/2026, mockup A
 * aprovado): "o campo dos filtros está mais 'fundo' do que os cards". A barra já
 * tinha o mesmo desenho dos cards (`ds-3d`: degradê + fio de luz + contorno),
 * mas a sombra de `ds-3d` (`0 10px 24px -16px`) foi calculada para um card alto:
 * com 40px de altura o recuo de -16px a come por inteiro e a barra parecia
 * afundada. No celular a sombra é proporcional à altura da barra
 * (`0 8px 14px -8px`); as camadas de luz e contorno são as mesmas de `ds-3d`.
 *
 * DESKTOP IGUAL AO CELULAR (pedido explícito, 15/10/2026, mockup "Main"
 * aprovado): no computador também é UMA casca só — 44px de altura (a da barra
 * de abas), raio 13px (o do ACTION_BAR), busca + botões separados por fios,
 * botões de 52px (o "wide" continua automático). Antes eram dois objetos. */
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
      className={`flex min-w-0 items-stretch ds-3d ds-3d-hover h-10 overflow-hidden rounded-[9px] bg-card !shadow-[inset_0_1px_0_color-mix(in_oklab,var(--foreground)_7%,transparent),inset_0_0_0_1px_var(--border),0_8px_14px_-8px_rgb(0_0_0/0.55)] lg:h-[var(--ds-action-h-lg)] lg:rounded-[13px] ${className}`}
    >
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground opacity-60" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-full w-full bg-transparent pl-9 pr-9 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none"
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
        <div className="ds-icon-actions flex shrink-0 divide-x divide-[color-mix(in_oklab,var(--foreground)_11%,transparent)] border-l border-[color-mix(in_oklab,var(--foreground)_11%,transparent)] [&>*:not([data-action-wide])]:!w-12 lg:[&>*:not([data-action-wide])]:!w-[52px] [&>*]:!flex-none [&>*:not([data-action-wide])]:!px-0 [&>[data-action-wide]]:!w-auto [&>[data-action-wide]]:!px-2.5 lg:[&>[data-action-wide]]:!px-3.5">
          {actions}
        </div>
      )}
    </div>
  );
}
