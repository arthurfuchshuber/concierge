import type { ComponentType, ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { PANEL_SHELL, PanelHeading } from "@/components/dashboard/panel-chrome";
import { cn } from "@/lib/utils";

/**
 * PEÇAS DO LAYOUT NOVO DO PROPRIETÁRIO (mockups Prop2–Prop12, 13/10/2026).
 * Um lugar só: ficha, janela do imóvel e formulário usam as mesmas peças, como
 * os mockups usam o mesmo CSS. Só tokens semânticos — nada de cor fixa.
 */

type Icon = ComponentType<{ className?: string; strokeWidth?: number }>;

/** Pílula "+ Vincular" / "+ Nova nota" / "+ Lançar" (mockup `.add`). */
export function AddPill({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 shrink-0 items-center gap-[5px] rounded-full px-[11px] text-[12px] font-semibold text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_14%,transparent)] transition-colors hover:bg-foreground/[0.05] disabled:opacity-40"
    >
      <Plus className="size-[13px]" />
      {children}
    </button>
  );
}

/** Título de grupo: rótulo, fio que some e contagem à direita (mockup `.gt`). */
export function GroupTitle({ title, count }: { title: string; count?: ReactNode }) {
  return (
    <PanelHeading
      title={title}
      className="mb-2.5"
      right={
        count != null ? (
          <span className="text-[10.5px] font-bold text-[color:var(--faint)]">{count}</span>
        ) : undefined
      }
    />
  );
}

/** A casca de uma lista de linhas (mockup `.gl`). */
export function GroupList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn(PANEL_SHELL, className)}>{children}</div>;
}

export function IconBox({
  icon: I,
  round,
  active,
  size = 32,
}: {
  icon: Icon;
  round?: boolean;
  active?: boolean;
  size?: 28 | 32;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]",
        size === 32 ? "size-8 rounded-[10px]" : "size-7 rounded-[8px]",
        round && "!rounded-full",
        active ? "bg-foreground/[0.09] text-foreground" : "bg-foreground/[0.05]",
      )}
    >
      <I className={size === 32 ? "size-[15px]" : "size-3.5"} />
    </span>
  );
}

/** "● Completo" / "Falta 1" no fim da linha (mockup `.tr`). */
export function StatusTrail({
  tone,
  children,
}: {
  tone: "ok" | "at" | "falta" | "nu";
  children: ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "ds-ok"
      : tone === "at"
        ? "ds-atencao"
        : tone === "falta"
          ? "ds-falta"
          : "ds-faint";
  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 text-[11px] font-bold", cls)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

/** Linha de grupo (mockup `.gr` / `.gh` / `.gb`): ícone, título + legenda, selo, seta. */
export function GroupRow({
  icon,
  title,
  sub,
  trailing,
  open,
  onToggle,
  onClick,
  chevron = true,
  minH = 62,
  roundIcon,
  titleWeight = 600,
  order,
  children,
}: {
  icon: Icon;
  title: ReactNode;
  sub?: ReactNode;
  trailing?: ReactNode;
  open?: boolean;
  /** Linha que expande (seta gira). */
  onToggle?: () => void;
  /** Linha que navega/abre algo (seta aponta para a direita). */
  onClick?: () => void;
  chevron?: boolean;
  minH?: 56 | 62;
  roundIcon?: boolean;
  titleWeight?: 500 | 600;
  /** Posição visual dentro de uma lista `flex-col` (reordena sem mexer no JSX). */
  order?: number;
  children?: ReactNode;
}) {
  const press = onToggle ?? onClick;
  const head = (
    <>
      <IconBox icon={icon} round={roundIcon} active={open} />
      <span className="min-w-0 flex-1 text-left">
        <b
          className="block truncate text-[13.5px] leading-[1.25] text-foreground"
          style={{ fontWeight: titleWeight }}
        >
          {title}
        </b>
        {sub ? (
          <small className="mt-[3px] block truncate text-[11.5px] text-[color:var(--faint)]">
            {sub}
          </small>
        ) : null}
      </span>
      {trailing}
      {chevron && press ? (
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-[color:var(--faint)] transition-transform",
            onToggle ? (open ? "rotate-0" : "-rotate-90") : "-rotate-90",
          )}
          aria-hidden
        />
      ) : null}
    </>
  );
  return (
    <div
      style={order != null ? { order } : undefined}
      className={cn(
        "relative [&+&]:before:absolute [&+&]:before:right-0 [&+&]:before:top-0 [&+&]:before:h-px [&+&]:before:bg-foreground/[0.06] [&+&]:before:content-['']",
        open ? "[&+&]:before:left-0 before:left-0" : "[&+&]:before:left-[58px]",
      )}
    >
      {press ? (
        <button
          type="button"
          onClick={press}
          aria-expanded={onToggle ? !!open : undefined}
          className="flex w-full items-center gap-3 px-3.5 transition-colors hover:bg-foreground/[0.03]"
          style={{ minHeight: minH }}
        >
          {head}
        </button>
      ) : (
        <div className="flex w-full items-center gap-3 px-3.5" style={{ minHeight: minH }}>
          {head}
        </div>
      )}
      {open && children ? (
        <div className="grid gap-3.5 pb-[18px] pl-[58px] pr-3.5 pt-0.5">{children}</div>
      ) : null}
    </div>
  );
}

/** Faixa A receber / Recebido / A pagar (mockup `.stats`). */
export function StatsStrip({
  items,
  className,
}: {
  items: Array<{ label: string; value: string; tone: "ok" | "data" | "at" }>;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 divide-x divide-foreground/[0.06]", className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 px-3 py-3.5">
          <p
            className={cn(
              "flex items-center gap-[7px] text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "size-[5px] shrink-0 rounded-full bg-current",
                it.tone === "ok" ? "ds-ok" : it.tone === "data" ? "ds-data" : "ds-atencao",
              )}
            />
            <span className="truncate">{it.label}</span>
          </p>
          <p className="mt-2 truncate font-display text-[19px] font-bold tabular-nums text-foreground">
            {it.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** Estado vazio (mockup `.empty`). */
export function OwnerEmpty({ icon: I, title, text }: { icon: Icon; title: string; text: string }) {
  return (
    <div className="grid justify-items-center gap-2 px-4 py-9 text-center">
      <span className="grid size-9 place-items-center rounded-[10px] bg-foreground/[0.05] text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)]">
        <I className="size-3.5" />
      </span>
      <b className="text-[13.5px] font-semibold text-foreground">{title}</b>
      <p className="max-w-[250px] text-[12px] leading-[1.45] text-muted-foreground">{text}</p>
    </div>
  );
}

/** Chip quadrado 28px de ação (mockup `.chip`). */
export const CHIP_BTN =
  "grid size-7 shrink-0 place-items-center rounded-[8px] bg-foreground/[0.05] text-muted-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_7%,transparent)] transition-colors hover:text-foreground disabled:opacity-40";

/** Card padrão das fichas (diretriz 5): raio 8px, borda do tema, sem sombra 3D. */
export const CARD_8 =
  "relative overflow-hidden rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--border)]";
