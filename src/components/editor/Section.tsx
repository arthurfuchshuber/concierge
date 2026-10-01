import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PANEL_SHELL } from "@/components/dashboard/panel-chrome";

export type SectionIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

const SectionGroupContext = React.createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

type Density = false | "dense" | "presence";
const DensityContext = React.createContext<Density>(false);

/**
 * Aplica a formatação compacta (Design System) a todas as Sections filhas.
 *
 * `variant="presence"` (01/10/2026, mockup "Editar guia — padrão Presença"
 * aprovado): a MESMA anatomia dos quadrantes do Dashboard — casca
 * `PANEL_SHELL` (luz do `ds-3d`, raio 14px), ícone em caixinha, título numa
 * linha com reticências e, à direita, um selo (contagem ou "Pendente"). É só
 * do editor de guia: o diálogo de proprietário/prestador, que também usa
 * `DenseSections`, tem o próprio mockup aprovado e não muda.
 */
export function DenseSections({ children, variant = "dense" }: { children: React.ReactNode; variant?: "dense" | "presence" }) {
  return <DensityContext.Provider value={variant}>{children}</DensityContext.Provider>;
}

/** O fio colorido de 2px na aresta de cima do quadrante (padrão Presença). */
export type SectionTopLine = "brand" | "amber" | "rose";
const TOP_LINE: Record<SectionTopLine, string> = {
  brand: "bg-[linear-gradient(120deg,#7c1ad8,#e82dae)]",
  amber: "bg-[linear-gradient(90deg,transparent,#c9a962_18%,#c9a962_82%,transparent)]",
  rose: "bg-[linear-gradient(90deg,transparent,#c98c8c_18%,#c98c8c_82%,transparent)]",
};
export function SectionTopLineBar({ tone }: { tone: SectionTopLine }) {
  return <span aria-hidden className={`pointer-events-none absolute inset-x-3.5 top-0 h-0.5 rounded-full ${TOP_LINE[tone]}`} />;
}

/**
 * Agrupa Sections colapsáveis permitindo apenas uma aberta por vez.
 * Por padrão é não controlado (guarda o próprio estado). Passando `openId` +
 * `onOpenIdChange`, quem chama passa a decidir qual seção fica aberta — usado
 * quando algo de fora precisa abrir uma seção específica (ex.: validação de
 * formulário abrindo a seção com o campo inválido e rolando até ele).
 */
export function SectionGroup({
  children,
  defaultOpenId = null,
  openId: openIdProp,
  onOpenIdChange,
}: {
  children: React.ReactNode;
  defaultOpenId?: string | null;
  openId?: string | null;
  onOpenIdChange?: (id: string | null) => void;
}) {
  const [localOpenId, setLocalOpenId] = useState<string | null>(defaultOpenId);
  const isControlled = openIdProp !== undefined;
  const openId = isControlled ? openIdProp : localOpenId;
  const setOpenId = (id: string | null) => {
    if (!isControlled) setLocalOpenId(id);
    onOpenIdChange?.(id);
  };
  return <SectionGroupContext.Provider value={{ openId, setOpenId }}>{children}</SectionGroupContext.Provider>;
}

export function Section({
  id,
  icon: Icon,
  title,
  desc,
  action,
  tone = "default",
  collapsible = false,
  defaultOpen = false,
  dense = false,
  badge,
  topLine,
  children,
}: {
  id?: string;
  icon?: SectionIcon;
  title?: string;
  desc?: string;
  action?: React.ReactNode;
  tone?: "default" | "accent";
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Versão compacta (Design System): cantos 0.3rem, títulos 13px, menos padding. */
  dense?: boolean;
  /** Selo à direita do título, antes da seta (contagem, "Pendente"). Só no padrão Presença. */
  badge?: React.ReactNode;
  /** Fio de 2px no topo, na cor do tom. Só no padrão Presença. */
  topLine?: SectionTopLine;
  children: React.ReactNode;
}) {
  const accent = tone === "accent";
  const densityCtx = React.useContext(DensityContext);
  dense = dense || !!densityCtx;
  const group = React.useContext(SectionGroupContext);
  const autoId = React.useId();
  const sid = id ?? autoId;
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const inGroup = collapsible && !!group;
  const groupOpen = inGroup && group!.openId === sid;
  const isOpen = collapsible ? (inGroup ? groupOpen : localOpen) : true;
  const toggle = () => {
    if (!collapsible) return;
    if (inGroup) group!.setOpenId(groupOpen ? null : sid);
    else setLocalOpen((v) => !v);
  };
  if (densityCtx === "presence") {
    // Padrão Presença: o "accent" deixou de pintar o quadrante inteiro de
    // roxo — virou o fio da marca no topo, como a aba ativa.
    const line = topLine ?? (accent ? "brand" : undefined);
    return (
      <section className={PANEL_SHELL}>
        {line ? <SectionTopLineBar tone={line} /> : null}
        {(title || action) && (
          <header className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 px-3.5 py-2.5 text-left ${collapsible ? "cursor-pointer" : "cursor-default"}`}
              aria-expanded={collapsible ? isOpen : undefined}
              disabled={!collapsible}
            >
              {Icon && (
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-[8px] shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent)] ${
                    isOpen ? "bg-foreground/[0.08] text-foreground" : "bg-foreground/[0.05] text-muted-foreground"
                  }`}
                >
                  <Icon className="size-3.5" strokeWidth={2} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                {title && <span className="block truncate text-[13.5px] font-semibold leading-snug text-foreground">{title}</span>}
                {desc && <span className="ds-faint mt-0.5 block truncate text-[11px] font-medium">{desc}</span>}
              </span>
              {badge ? <span className="shrink-0">{badge}</span> : null}
              {collapsible && (
                <ChevronDown
                  className={`size-[15px] shrink-0 transition-transform ${isOpen ? "rotate-180 text-muted-foreground" : "ds-faint"}`}
                />
              )}
            </button>
            {action && <div className="ds-scroll-x ml-auto max-w-[60%] gap-2 pr-3.5">{action}</div>}
          </header>
        )}
        {isOpen && (
          <div
            className={`${title || action ? "border-t border-foreground/[0.06]" : ""} flex flex-col gap-4 px-3.5 py-4`}
          >
            {children}
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      className={[
        dense ? "rounded-[0.3rem] border" : "rounded-2xl border shadow-sm",
        accent
          ? "border-primary/25 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02]"
          : "border-border/60 bg-card",
      ].join(" ")}
    >
      {(title || action) && (
        <header className={`flex items-start justify-between gap-3 ${dense ? "px-3 pt-3 pb-2.5" : "px-4 sm:px-5 pt-4 sm:pt-5 pb-3"}`}>
          <button
            type="button"
            onClick={toggle}
            // Alinhamento vertical do cabeçalho: quando NÃO há `desc` (a
            // maioria das Sections hoje — o subtítulo foi removido em quase
            // todo o SaaS num pedido anterior), o ícone e o título ficam
            // numa única linha, então `items-center` centraliza o título
            // certinho no meio do ícone (pedido do cliente em 03/09/2026,
            // print da Section "Título do Anúncio" — o título estava
            // "colado" no topo do ícone em vez de centralizado). Quando AINDA
            // existe `desc` (ex.: RecGroup "Aqui pertinho"/"Pela cidade"),
            // mantém `items-start`: com duas linhas de texto, alinhar pelo
            // topo continua sendo o mais correto visualmente.
            className={`flex ${desc ? "items-start" : "items-center"} gap-3 min-w-0 flex-1 text-left ${collapsible ? "cursor-pointer" : "cursor-default"}`}
            aria-expanded={collapsible ? isOpen : undefined}
            disabled={!collapsible}
          >
            {Icon && (
              <span
                className={[
                  dense
                    ? "grid place-items-center size-7 rounded-[0.3rem] shrink-0"
                    : `grid place-items-center size-8 rounded-lg shrink-0 ${desc ? "mt-0.5" : ""}`,
                  accent ? "bg-primary/15 text-primary" : "bg-muted text-foreground/70",
                ].join(" ")}
              >
                <Icon className={dense ? "size-3.5" : "size-4"} strokeWidth={2} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && (
                <h3
                  className={
                    dense
                      ? "truncate text-[13px] font-medium leading-snug text-foreground"
                      : "ds-section-title text-foreground truncate"
                  }
                >
                  {title}
                </h3>
              )}
              {desc && (
                <p className={dense ? "mt-0.5 text-[11px] font-normal leading-snug text-muted-foreground" : "ds-card-desc mt-1"}>{desc}</p>
              )}
            </div>
            {collapsible && (
              <ChevronDown
                className={`${dense ? "size-3.5 mt-0.5" : desc ? "size-4 mt-1.5" : "size-4"} text-muted-foreground transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>
          {/* Ações nunca quebram em 2ª linha: rolam na horizontal com fade. */}
          {action && <div className="ds-scroll-x gap-2 ml-auto max-w-[60%]">{action}</div>}
        </header>
      )}
      {isOpen && (
        <div
          className={`${title || action ? "border-t border-border/50" : ""} ${dense ? "px-3 py-3 space-y-2.5" : "px-4 sm:px-5 py-4 sm:py-5 space-y-3.5"}`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
