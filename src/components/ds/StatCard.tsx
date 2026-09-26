import type { ElementType, ReactNode } from "react";

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
      } ${active ? "bg-secondary/50 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)]" : ""}`}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5">
        <span
          className="grid size-6 shrink-0 place-items-center rounded-[8px] bg-foreground/[0.05] text-muted-foreground"
          style={iconTone ? { color: iconTone, background: `color-mix(in oklab, ${iconTone} 12%, transparent)` } : undefined}
        >
          <Icon className="size-3.5" strokeWidth={2} />
        </span>
        <span
          className="ds-eyebrow min-w-0 flex-1 truncate text-[9px] tracking-[0.04em] sm:text-[10px] sm:tracking-[0.08em]"
          title={label}
        >
          {label}
        </span>
      </div>
      <div
        className={`w-full pt-1.5 text-center font-display font-bold leading-none tracking-[-0.03em] tabular-nums ${
          size === "sm" ? "text-[22px] sm:text-[26px]" : "text-[26px] sm:text-[30px]"
        }`}
      >
        {loading ? "—" : value}
      </div>
      {note && !loading ? (
        <p className="ds-atencao w-full truncate pt-1 text-center text-[10px] font-bold">{note}</p>
      ) : null}
    </button>
  );
}
