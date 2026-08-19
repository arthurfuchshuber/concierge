import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KpiTone = "green" | "orange" | "amber" | "blue" | "neutral";

const TONE_TEXT: Record<KpiTone, string> = {
  green: "text-emerald-400",
  orange: "text-orange-400",
  amber: "text-amber-400",
  blue: "text-sky-400",
  neutral: "text-foreground",
};

const TONE_DOT: Record<KpiTone, string> = {
  green: "bg-emerald-400",
  orange: "bg-orange-400",
  amber: "bg-amber-400",
  blue: "bg-sky-400",
  neutral: "bg-muted-foreground",
};

/**
 * Card de KPI do Dashboard (pacote UX v4): rótulo em caixa alta com marcador
 * colorido e o número em destaque, na cor do próprio indicador.
 */
export function KpiCard({
  label,
  value,
  tone = "neutral",
  icon,
  onClick,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: KpiTone;
  /** Emoji/ícone no lugar do marcador circular. */
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "ui-card p-5 text-left transition-colors",
        onClick && "hover:bg-secondary/40",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {icon ? (
          <span className="text-[13px] leading-none">{icon}</span>
        ) : (
          <span className={cn("size-2.5 shrink-0 rounded-full", TONE_DOT[tone])} aria-hidden />
        )}
        <span className="ui-eyebrow !text-muted-foreground">{label}</span>
      </div>
      <div className={cn("mt-3 font-display text-[34px] leading-none", TONE_TEXT[tone])}>
        {value}
      </div>
    </Tag>
  );
}

/** Faixa fina de KPI (ex.: "Em limpeza") — rótulo à esquerda, número à direita. */
export function KpiStrip({
  label,
  value,
  icon,
  onClick,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-400/[0.06] px-5 py-4 text-left",
        className,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon ? <span className="text-[13px] leading-none">{icon}</span> : null}
        <span className="ui-eyebrow !text-amber-300/90 truncate">{label}</span>
      </span>
      <span className="font-display text-[22px] leading-none text-amber-400">{value}</span>
    </Tag>
  );
}
