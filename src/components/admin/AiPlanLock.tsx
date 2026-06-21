import { Link } from "@tanstack/react-router";
import { Lock, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type Props = {
  locked: boolean;
  children: React.ReactNode;
  className?: string;
  /** When true, render only the lock badge + tooltip (no children wrapper). */
  badgeOnly?: boolean;
};

/**
 * Wraps AI-only UI. When `locked`, disables interaction, dims content, and
 * shows a tooltip directing the host to upgrade.
 */
export function AiPlanLock({ locked, children, className, badgeOnly }: Props) {
  if (!locked) return <>{children}</>;

  const tip = (
    <TooltipContent side="top" className="max-w-xs">
      <div className="space-y-2">
        <p className="font-medium flex items-center gap-1.5">
          <Sparkles className="size-3.5" /> Recurso da IA bloqueado
        </p>
        <p className="text-xs leading-relaxed">
          A assistente IA e a base de conhecimento estão disponíveis nos planos{" "}
          <strong>Pro</strong>, <strong>Business</strong> e <strong>Enterprise</strong>.
          Faça upgrade para deixar a IA respondendo os seus hóspedes 24h.
        </p>
        <Link
          to="/precos"
          className="inline-block text-xs underline underline-offset-2 hover:no-underline"
        >
          Ver planos →
        </Link>
      </div>
    </TooltipContent>
  );

  if (badgeOnly) {
    return (
      <TooltipProvider delayDuration={150}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 cursor-help">
              <Lock className="size-3" /> Pro / Business / Enterprise
            </span>
          </TooltipTrigger>
          {tip}
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={cn("relative group", className)}>
            <div className="pointer-events-none select-none opacity-60 saturate-50">{children}</div>
            <div className="absolute inset-0 rounded-xl bg-background/30 backdrop-blur-[1px] flex items-center justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-background/95 px-3 py-1 text-xs font-medium text-amber-700 dark:text-amber-300 shadow-sm">
                <Lock className="size-3.5" /> Disponível no Pro, Business e Enterprise
              </span>
            </div>
          </div>
        </TooltipTrigger>
        {tip}
      </Tooltip>
    </TooltipProvider>
  );
}
