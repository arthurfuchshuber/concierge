import type { ReactNode } from "react";
import { ACTION_BAR } from "@/components/dashboard/panel-chrome";

/**
 * Cabeçalho de página no MESMO molde do Dashboard (`OperationShell`):
 * data por extenso em cima, título + subtítulo, e as ações numa peça só
 * (`ACTION_BAR`) — à direita no computador, largura inteira no celular.
 * Para páginas sem a barra de abas do Dashboard (ex.: Guias).
 */
export function PageShell({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  const hoje = new Date()
    .toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .replace(/^\w/, (c) => c.toUpperCase());
  return (
    <div className="ds-page-heading">
      <p className="ds-eyebrow ds-data text-[10.5px] tracking-[0.2em]">{hoje}</p>
      <div className="lg:flex lg:items-end lg:justify-between lg:gap-8">
        <div className="ds-page-heading min-w-0 lg:flex-1">
          <h1 className="ds-page-title !text-lg truncate">{title}</h1>
          {subtitle ? <p className="ds-page-subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className={`mt-5 lg:mt-0 lg:shrink-0 ${ACTION_BAR}`}>{actions}</div> : null}
      </div>
    </div>
  );
}
