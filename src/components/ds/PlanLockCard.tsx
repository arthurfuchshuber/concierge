import type { ReactNode } from "react";
import { Lock, Check } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Estado padrão de recurso bloqueado por plano (ref.: mockup
 * 12_formularios_e_estados/03_limite_plano_atingido).
 * Cadeado âmbar, título âmbar, texto de apoio, bullets do que libera,
 * botão gradiente "Fazer upgrade" e legenda com o plano atual.
 */
export function PlanLockCard({
  title,
  description,
  bullets,
  currentPlan,
  ctaLabel = "Fazer upgrade",
  ctaHref = "/admin/administrativo?tab=assinatura",
  className,
}: {
  title: string;
  description: ReactNode;
  bullets?: string[];
  currentPlan?: string | null;
  ctaLabel?: string;
  ctaHref?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-xl border border-amber-500/40 bg-amber-500/[0.04] p-6 text-center ds-surface",
        className,
      )}
    >
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-amber-500/15">
        <Lock className="size-6 text-amber-500" />
      </div>
      <h2 className="ds-section-title text-amber-500">{title}</h2>
      <p className="ds-body mt-2 text-muted-foreground">{description}</p>

      {bullets && bullets.length > 0 ? (
        <ul className="mx-auto mt-5 grid max-w-sm gap-1.5 text-left">
          {bullets.map((b) => (
            <li key={b} className="ds-body flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <a
        href={ctaHref}
        className="mt-5 inline-flex h-9 w-full items-center justify-center rounded-lg bg-gradient-to-r from-primary to-accent px-5 text-sm font-semibold text-primary-foreground"
      >
        {ctaLabel}
      </a>

      {currentPlan ? (
        <p className="ds-meta mt-3">Seu plano atual: {currentPlan}</p>
      ) : null}
    </div>
  );
}
