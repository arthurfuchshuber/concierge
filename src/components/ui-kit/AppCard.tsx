import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Card padrão do painel — raio, borda, fundo e padding únicos (pacote UX v4). */
export function AppCard({
  children,
  className,
  padding = "comfortable",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  /** 16px (denso) ou 20px (confortável). */
  padding?: "dense" | "comfortable" | "none";
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick } : {})}
      className={cn(
        "ui-card",
        padding === "dense" && "p-4",
        padding === "comfortable" && "p-5",
        onClick && "w-full text-left transition-colors hover:bg-secondary/40",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ui-card-title", className)}>{children}</div>;
}

export function CardMeta({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("ui-meta", className)}>{children}</div>;
}
