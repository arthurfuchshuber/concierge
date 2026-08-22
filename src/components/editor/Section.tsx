import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

export type SectionIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

const SectionGroupContext = React.createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

const DensityContext = React.createContext(false);

/** Aplica a formatação compacta (Design System) a todas as Sections filhas. */
export function DenseSections({ children }: { children: React.ReactNode }) {
  return <DensityContext.Provider value={true}>{children}</DensityContext.Provider>;
}

/** Agrupa Sections colapsáveis permitindo apenas uma aberta por vez. */
export function SectionGroup({
  children,
  defaultOpenId = null,
}: {
  children: React.ReactNode;
  defaultOpenId?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(defaultOpenId);
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
  children: React.ReactNode;
}) {
  const accent = tone === "accent";
  const densityCtx = React.useContext(DensityContext);
  dense = dense || densityCtx;
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
            className={`flex items-start gap-3 min-w-0 flex-1 text-left ${collapsible ? "cursor-pointer" : "cursor-default"}`}
            aria-expanded={collapsible ? isOpen : undefined}
            disabled={!collapsible}
          >
            {Icon && (
              <span
                className={[
                  dense ? "grid place-items-center size-7 rounded-[0.3rem] shrink-0" : "grid place-items-center size-8 rounded-lg shrink-0 mt-0.5",
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
                className={`${dense ? "size-3.5 mt-0.5" : "size-4 mt-1.5"} text-muted-foreground transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`}
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
