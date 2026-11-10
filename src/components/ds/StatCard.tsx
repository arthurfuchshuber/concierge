import type { ElementType, ReactNode } from "react";

/**
 * CABEÇALHO DO CARTÃO DE NÚMERO (pedido do cliente, 09/11/2026, "para todo o
 * sistema"): o TÍTULO fica centralizado no cartão sem contar o ícone; o ícone
 * é puro (sem caixinha de fundo) e fica colado à esquerda do título, fora do
 * cálculo do centro. As laterais reservam o espaço do ícone dos dois lados
 * (px-5), então o título longo reticencia sem invadir o ícone.
 */
export function StatHead({
  icon: Icon,
  label,
  title,
  iconClassName = "text-muted-foreground",
  iconTone,
  labelClassName = "",
  className = "",
  inlineLg = false,
}: {
  icon: ElementType;
  label: ReactNode;
  title?: string;
  iconClassName?: string;
  iconTone?: string;
  labelClassName?: string;
  className?: string;
  /** No computador o cartão vira linha (ícone à esquerda, título ao lado, número à direita). */
  inlineLg?: boolean;
}) {
  return (
    <div className={`flex w-full min-w-0 justify-center px-5 ${inlineLg ? "lg:flex-1 lg:justify-start lg:px-0" : ""} ${className}`}>
      <span className={`relative min-w-0 max-w-full ${inlineLg ? "lg:flex lg:flex-1 lg:items-center lg:gap-2.5" : ""}`}>
        <Icon
          aria-hidden="true"
          className={`absolute right-full top-1/2 mr-1.5 size-3.5 -translate-y-1/2 ${inlineLg ? "lg:static lg:mr-0 lg:size-[15px] lg:translate-y-0" : ""} ${iconClassName}`}
          style={iconTone ? { color: iconTone } : undefined}
          strokeWidth={2}
        />
        <span
          className={`ds-eyebrow block min-w-0 truncate text-[9px] tracking-[0.04em] sm:text-[10px] sm:tracking-[0.08em] ${inlineLg ? "lg:flex-1" : ""} ${labelClassName}`}
          title={title}
        >
          {label}
        </span>
      </span>
    </div>
  );
}

/**
 * CARTÃO DE NÚMERO — o padrão da Limpeza/Operacional, num lugar só.
 *
 * Ícone em caixinha + rótulo em caixa alta numa linha só + número grande
 * centralizado + aviso opcional embaixo. É a mesma anatomia do
 * `StatDisplayCard` da Limpeza; as páginas novas usam este.
 *
 * `onClick` torna o cartão um filtro/atalho; `active` acende a seleção
 * (luz por dentro, sem cor própria no número — padrão "Presença").
 * `iconTone` pinta só a caixinha do ícone (cor da categoria).
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  loading,
  note,
  onClick,
  active,
  iconTone,
  size = "lg",
}: {
  label: string;
  value: ReactNode;
  icon: ElementType;
  loading?: boolean;
  note?: ReactNode | null;
  onClick?: () => void;
  active?: boolean;
  iconTone?: string;
  /** "sm" para as grades de categoria (número um pouco menor). */
  size?: "lg" | "sm";
}) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-pressed={clickable ? !!active : undefined}
      className={`ds-3d relative flex h-full w-full flex-col gap-1 overflow-hidden rounded-[14px] border-0 bg-card px-2.5 pb-2.5 pt-3 text-left transition disabled:cursor-default ${
        clickable ? "ds-3d-hover hover:bg-secondary/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" : ""
      } ${active ? "bg-secondary/50" : ""}`}
      style={
        active
          ? { boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${iconTone ?? "var(--primary)"} 70%, transparent)` }
          : undefined
      }
    >
      <StatHead icon={Icon} label={label} title={label} iconTone={iconTone} />
      <div
        className={`w-full pt-1.5 text-center font-display font-bold leading-none tracking-[-0.03em] tabular-nums ${
          size === "sm" ? "text-[18px] sm:text-[21px]" : "text-[21px] sm:text-[24px]"
        }`}
      >
        {loading ? "—" : value}
      </div>
      {note && !loading ? (
        <p className="ds-atencao w-full truncate pt-1 text-center text-[11.5px] font-bold">{note}</p>
      ) : null}
    </button>
  );
}
