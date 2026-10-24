import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PhoneActionButton } from "@/components/PhoneActionButton";
import { OwnerLine } from "@/components/dashboard/OwnerLine";

/**
 * CABEÇALHO PADRÃO DE JANELAS (26/09/2026): selo de ícone, título, subtítulo
 * e chips de contexto (imóvel, proprietário, situação...). Textos quebram
 * linha em vez de cortar; chips rolam para baixo (flex-wrap), nunca além da
 * margem direita.
 */
export function OverlayHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  chips,
  owner,
  className,
}: {
  owner?: { name: string | null; phone?: string | null; country?: string | null } | null;
  /** Sem uso: janelas não mostram mais ícone no cabeçalho (23/10/2026). */
  icon?: LucideIcon;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  chips?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <span className="block text-[9.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            {eyebrow}
          </span>
        )}
        <span
          className="block truncate text-[14px] font-semibold leading-snug text-foreground"
          title={typeof title === "string" ? title : undefined}
        >
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block break-words text-[11px] leading-snug text-muted-foreground">{subtitle}</span>
        )}
        {owner?.name && (
          <OwnerLine name={owner.name} phone={owner.phone} country={owner.country} phonePosition="adjacent" className="mt-0.5 text-[11px]" />
        )}
        {chips && <div className="mt-2 flex flex-wrap gap-1">{chips}</div>}
      </div>
    </div>
  );
}

export function OverlayChip({ children, dot }: { children: ReactNode; dot?: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--panel-border)] bg-foreground/[0.04] px-2 py-0.5 text-[10px] font-semibold text-foreground/85">
      {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}
