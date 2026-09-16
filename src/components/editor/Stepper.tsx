import type * as React from "react";
import { Lock, Home, FileText, DoorOpen, LogOut, LifeBuoy, Compass } from "lucide-react";
import { useAntiClipBar } from "@/hooks/useAntiClipBar";
export type StepDef = {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
};

/** Abas do editor de guia — mesma ordem em todas as telas do imóvel. */
export const GUIDE_STEPS: StepDef[] = [
  { value: "house", label: "A casa", icon: Home },
  { value: "guide", label: "O guia", icon: FileText },
  { value: "checkin", label: "Checkin", icon: DoorOpen },
  { value: "checkout", label: "Checkout", icon: LogOut },
  { value: "faq", label: "FAQ & Contatos", icon: LifeBuoy },
  { value: "recs", label: "Recomendações", icon: Compass },
];

/** Todas as abas exceto "A casa" — usado nas telas que só editam a casa. */
export const NON_HOUSE_STEPS = GUIDE_STEPS.filter((s) => s.value !== "house").map((s) => s.value);

export function Stepper({
  steps = GUIDE_STEPS,
  current,
  onChange,
  lockedValues,
  lockedTitle,
}: {
  steps?: StepDef[];
  current: string;
  onChange: (v: string) => void;
  // Abas visíveis mas ainda não liberadas (ex.: guia com dados obrigatórios
  // pendentes) — aparecem com cadeado e não respondem a clique.
  lockedValues?: string[];
  lockedTitle?: string;
}) {
  // ANTI-CORTE (regra global): toda a lógica que garante que nenhuma aba
  // aparece cortada nas bordas vive agora em `useAntiClipBar`, compartilhada
  // com todas as outras barras de menu/abas do app.
  const navRef = useAntiClipBar<HTMLElement>();

  return (
    <nav ref={navRef} className="ds-segmented mb-5 -mx-1 px-1 rounded-[0.3rem] bg-foreground/5 p-1">
      {steps.map((s) => {
        const active = s.value === current;
        const locked = lockedValues?.includes(s.value) ?? false;
        return (
          <button
            key={s.value}
            type="button"
            disabled={locked}
            data-state={active ? "active" : "inactive"}
            onClick={() => !locked && onChange(s.value)}
            title={
              locked
                ? (lockedTitle ?? 'Complete as informações obrigatórias em "A casa" para desbloquear')
                : undefined
            }
            className={`whitespace-nowrap px-3 py-2 text-center text-[13px] font-normal leading-none flex items-center justify-center gap-1.5 min-h-[34px] rounded-[0.25rem] transition-colors ${
              active
                ? "bg-gradient-to-br from-[#7C1AD8] to-[#E82DAE] text-white"
                : locked
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {locked ? <Lock className="size-3" /> : null}
            {s.label}
          </button>
        );
      })}
    </nav>
  );
}
