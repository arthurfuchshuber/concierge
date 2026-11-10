import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Peças do celular de Administrativo (Meu Perfil, Assinatura, Integrações) — mockups aprovados de
 * 05/11/2026. Os valores (alturas, raios, tamanhos de texto) são os dos mockups, na ordem em que
 * aparecem. As cores de status são o sálvia/âmbar/rosa do sistema, só em detalhes pequenos.
 */

export const SAGE = "#7fb79a";
export const AMBER = "#c9a962";
export const ROSE = "#c98c8c";

type Tone = "neutral" | "sage" | "amber" | "rose";

const TONE: Record<Tone, string> = {
  neutral: "bg-foreground/[0.07] text-muted-foreground",
  sage: "bg-[rgba(127,183,154,0.12)] text-[#7fb79a]",
  amber: "bg-[rgba(201,169,98,0.12)] text-[#c9a962]",
  rose: "bg-[rgba(201,140,140,0.12)] text-[#c98c8c]",
};

/** Etiqueta (pílula) de 18px: sempre na cor do status em questão. */
export function Tag({ tone = "neutral", icon, className, children }: { tone?: Tone; icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "box-border inline-flex h-[18px] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-[7px] text-[10px] font-bold",
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Campo denso do DS: 36px, raio 5px, 13px, fio de `--input`, fundo transparente. */
export const DENSE_INPUT =
  "box-border h-9 w-full min-w-0 rounded-[5px] border border-[var(--input)] bg-transparent px-[11px] text-[13px] text-foreground outline-none placeholder:text-[var(--faint)] focus:border-foreground/40";

/** Rótulo + controle + dica, como nos formulários densos dos mockups. */
export function DenseField({
  label,
  required,
  optional,
  hint,
  info,
  right,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  /** Explicação curta atrás de um (i) ao lado do rótulo (toque abre). */
  info?: string;
  /** Selo à direita do rótulo. */
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-h-[18px] items-center justify-between gap-2">
        <label className="text-[12px] font-semibold text-muted-foreground">
          {label}
          {optional ? <span className="font-medium text-[var(--faint)]"> (Opcional)</span> : null}
          {required ? <span className="text-[#c98c8c]"> *</span> : null}
        </label>
        {info ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" aria-label="Mais informações" className="ml-auto flex cursor-pointer text-[var(--faint)]">
                <Info className="size-[13px]" strokeWidth={2} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[260px] max-w-[calc(100vw-32px)] p-3 text-[12px] leading-[1.45] text-muted-foreground">
              {info}
            </PopoverContent>
          </Popover>
        ) : null}
        {right ? <span className="ml-auto">{right}</span> : null}
      </div>
      {children}
      {hint ? <p className="mt-1.5 text-[11.5px] font-medium leading-[1.4] text-[var(--faint)]">{hint}</p> : null}
    </div>
  );
}

/** Botão de ação de 28px (principal: raio 7px, cheio; neutro: raio 5px, fio fino). */
export function ActionButton({
  kind = "neutral",
  icon,
  children,
  full,
  className,
  ...rest
}: {
  kind?: "primary" | "neutral" | "danger";
  icon?: ReactNode;
  full?: boolean;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "box-border inline-flex h-7 items-center justify-center gap-2 whitespace-nowrap px-2.5 font-semibold leading-none disabled:cursor-not-allowed disabled:opacity-50",
        full ? "min-w-0 flex-1" : "flex-none",
        kind === "primary"
          ? "rounded-[8px] border border-transparent bg-foreground text-[11.5px] tracking-[-0.01em] text-background"
          : "rounded-[8px] border border-border/60 bg-muted text-[11.5px] font-medium transition-colors hover:bg-muted/80",
        kind === "danger" ? "text-[#c98c8c]" : kind === "neutral" ? "text-foreground" : "",
        className,
      )}
    >
      {icon}
      <span className="overflow-hidden text-ellipsis">{children}</span>
    </button>
  );
}

/** Chavinha discreta (28x16) de ativar/desativar. */
export function MiniSwitch({
  on,
  onChange,
  label,
  disabled,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cn(
        "relative inline-block h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-wait disabled:opacity-60",
        on ? "bg-[rgba(127,183,154,0.35)]" : "bg-foreground/[0.08]",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 size-3 rounded-full transition-[left]",
          on ? "left-[14px] bg-[#7fb79a]" : "left-0.5 bg-muted-foreground",
        )}
      />
    </button>
  );
}
