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
  //
  // Padrão Presença (01/10/2026, mockup "Editar guia" aprovado): a MESMA barra
  // das abas do Dashboard (`ds-tabs`) — fatias coladas numa casca com fio de
  // 1px, a ativa numa mancha neutra com o fio de 2px da marca embaixo
  // (`ds-tab-active`). Como aqui são seis abas e elas não cabem no celular, a
  // barra continua rolando, e o anti-corte roda em modo `stretch`: só abas
  // INTEIRAS na vista, e a sobra é dividida entre elas (nunca um vão vazio no
  // fim — pedido explícito, "replicar a regra dos quadrantes do Dashboard").
  const navRef = useAntiClipBar<HTMLElement>({ stretch: true });

  return (
    <nav
      ref={navRef}
      // `ds-segmented` dá a rolagem sem barra; o resto é a casca do `ds-tabs`.
      // O `gap` volta a 0: as fatias se encostam, como no Dashboard.
      style={{ gap: 0 }}
      className="ds-segmented rounded-[14px] bg-card p-0 shadow-[inset_0_0_0_1px_var(--border)]"
    >
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
            className={`relative flex min-h-[44px] items-center justify-center gap-1.5 whitespace-nowrap text-center text-[13px] leading-none transition-colors ${
              active
                ? "ds-tab-active font-bold"
                : locked
                  ? "cursor-not-allowed font-semibold text-muted-foreground/40"
                  : "font-semibold text-muted-foreground hover:text-foreground"
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
