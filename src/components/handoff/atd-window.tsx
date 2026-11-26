/**
 * JANELAS DO ATENDIMENTO (mockups ATD-D04…D16 / M05…M17, aprovados em 23–26/11/2026). Casca, cabeçalho, linhas
 * de opção, busca de janela, botões, rótulos, seletor segmentado e a chave compacta — as MESMAS classes do mockup.
 * Regras: sem bordas na casca (23/11/2026), título 14px negrito em uma linha com reticências e subtítulo 12px,
 * "X" de canto ou "‹ Voltar" no lugar dele quando há etapa anterior (`onBack`), tudo centralizado na tela.
 */
import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const WIN_SHELL =
  "sg-elegant-scroll [scrollbar-gutter:auto]! flex max-w-none flex-col gap-0 overflow-hidden rounded-[var(--win-radius)] border-0 bg-[var(--panel)] p-0 sm:p-0 text-foreground shadow-[0_24px_60px_rgba(0,0,0,0.6),0_2px_8px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.05)] sm:max-w-none";

export function AtdWindow({
  open,
  onOpenChange,
  title,
  subtitle,
  width = 280,
  onBack,
  children,
  description,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  subtitle?: string | null;
  width?: number;
  /** "‹ Voltar" no lugar do "X" (etapa anterior na MESMA janela). */
  onBack?: () => void;
  children: ReactNode;
  description?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onBack={onBack}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={cn(WIN_SHELL, "max-h-[min(90dvh,calc(100dvh-32px))]")}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
      >
        <div className={cn("flex shrink-0 items-start border-b border-[var(--panel-div)] pt-[7px] pb-[9px] pl-4", onBack ? "pr-24" : "pr-14")}>
          <div className="min-w-0 flex-1">
            <DialogTitle className="block truncate font-display text-[14px] font-bold leading-[18px] text-foreground">{title}</DialogTitle>
            {subtitle ? (
              <span className="mt-0.5 block truncate text-[12px] leading-tight text-muted-foreground">{subtitle}</span>
            ) : null}
          </div>
          <DialogDescription className="sr-only">{description ?? subtitle ?? title}</DialogDescription>
        </div>
        {/* rolagem só no conteúdo (o cabeçalho e o canto ficam fixos) quando a janela passa de 90% da tela */}
        <div className="sg-elegant-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Linha de opção da janela (ícone em quadrado de 28px, título 13px, apoio 11px; rosa para ação destrutiva). */
export function WinRow({
  icon,
  title,
  sub,
  last,
  rose,
  onClick,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  sub?: string | null;
  last?: boolean;
  rose?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const col = rose ? { color: "#c98c8c" } : undefined;
  return (
    <div className={cn("flex items-center gap-2.5", !last && "border-b border-[var(--panel-div)]")}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-4 pr-4 text-left transition-colors hover:bg-foreground/[0.03] disabled:opacity-50"
      >
        <span
          className={cn("grid size-7 shrink-0 place-items-center rounded-[9px] text-foreground", rose ? "bg-[#c98c8c]/12" : "bg-foreground/[0.06]")}
          style={col}
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-[13px] font-semibold leading-[1.3]" style={col}>
            {title}
          </span>
          {sub ? <span className="truncate text-[11px] leading-[1.3] text-muted-foreground">{sub}</span> : null}
        </span>
      </button>
    </div>
  );
}

/** Busca de janela: reta, sem preenchimento, com filete embaixo (regra de 16/11/2026). */
export function WinSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="mx-4 mb-1.5 mt-2 flex h-8 shrink-0 items-center gap-2 border-b border-[var(--panel-div)] text-foreground/40">
      <Search className="size-3.5 shrink-0" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 truncate bg-transparent text-xs text-foreground placeholder:text-foreground/40 focus:outline-none"
      />
    </label>
  );
}

export const BTN_SOFT =
  "grid h-9 flex-1 place-items-center rounded-[10px] bg-foreground/[0.06] text-[12.5px] font-semibold text-foreground transition-colors hover:bg-foreground/[0.1] disabled:opacity-50";
export const BTN_BRAND =
  "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-[12.5px] font-bold text-white disabled:opacity-50";

export function WinLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{children}</span>;
}

/** Seletor segmentado das janelas (regra de 16/11/2026): trilha única, sem borda, ~30px, ativa elevada. */
export function Seg<T extends string>({ options, value, onChange }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="flex h-[30px] items-center gap-0.5 rounded-full bg-foreground/[0.06] p-[2px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "flex h-[26px] flex-1 items-center justify-center rounded-full px-2 text-[12px]",
              on ? "bg-card font-bold text-foreground shadow-[0_1px_3px_rgba(40,25,10,0.18)]" : "font-medium text-muted-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Chave compacta 24×14 (regra global de 15/11/2026). */
export function CompactSwitch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn(
        "relative inline-flex h-[14px] w-[24px] shrink-0 items-center rounded-full transition-colors",
        on ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE]" : "bg-foreground/[0.14]",
      )}
    >
      <span className={cn("absolute size-[10px] rounded-full bg-white shadow-sm transition-[left]", on ? "left-[12px]" : "left-[2px]")} />
    </button>
  );
}
