import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Classe do "Voltar" de página: seta + texto, na altura da linha da data. */
export const PAGE_BACK_CLASS =
  "inline-flex h-[22px] shrink-0 items-center gap-1.5 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground print:hidden";

/**
 * LINHA DA DATA COM "VOLTAR" À DIREITA (regra global, 22/10/2026 — mesma do celular e do
 * computador): a data dourada igual à das páginas e, na mesma linha, no canto direito, o
 * "Voltar" da página/subpágina. Quem usa passa o próprio `<Link>`/botão em `back`.
 */
export function PageDateRow({ back, className }: { back?: ReactNode; className?: string }) {
  const hoje = new Date()
    .toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(/^\w/, (c) => c.toUpperCase());
  return (
    <div className={cn("flex min-w-0 items-start justify-between gap-3", className)}>
      <p className="ds-eyebrow ds-data truncate text-[10.5px] leading-[22px] tracking-[0.2em]">
        {hoje}
      </p>
      {back}
    </div>
  );
}
