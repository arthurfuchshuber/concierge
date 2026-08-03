import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

export type SectionIcon = React.ComponentType<{ className?: string; strokeWidth?: number }>;

const SectionGroupContext = React.createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

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
  children: React.ReactNode;
}) {
  const accent = tone === "accent";
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
        "rounded-2xl border shadow-sm",
        accent
          ? "border-primary/25 bg-gradient-to-br from-primary/[0.06] to-primary/[0.02]"
          : "border-border/60 bg-card",
      ].join(" ")}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-4 sm:px-5 pt-4 sm:pt-5 pb-3.5">
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
                  "grid place-items-center size-8 rounded-lg shrink-0 mt-0.5",
                  accent ? "bg-primary/15 text-primary" : "bg-muted text-foreground/70",
                ].join(" ")}
              >
                <Icon className="size-4" strokeWidth={2} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              {title && <h3 className="text-sm font-semibold leading-tight text-foreground">{title}</h3>}
              {desc && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>}
            </div>
            {collapsible && (
              <ChevronDown
                className={`size-4 text-muted-foreground transition-transform shrink-0 mt-1.5 ${isOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>
          {action && <div className="flex flex-wrap items-center gap-1.5 ml-auto">{action}</div>}
        </header>
      )}
      {isOpen && (
        <div
          className={`${title || action ? "border-t border-border/50" : ""} px-4 sm:px-5 py-4 sm:py-5 space-y-3.5`}
        >
          {children}
        </div>
      )}
    </section>
  );
}
