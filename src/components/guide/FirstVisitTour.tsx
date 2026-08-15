import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Rect = { top: number; left: number; width: number; height: number };

function measure(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Tour de primeiro acesso: depois que o hóspede preenche seus dados pela
 * primeira vez para ESSA reserva (telefone+nome+data+imóvel), guiamos ele
 * até o essencial — sem isso, muita gente nem descobria que "Check-in" tinha
 * uma aba de senhas dentro.
 *
 * Passo 1 aponta para o card "Check-in" (data-tour="checkin-card").
 * Assim que ele toca ali (o card abre), passo 2 aponta para a aba "Senhas"
 * dentro do card (data-tour="senhas-tab"). Ao tocar nela, o tour termina.
 * "Pular" encerra a qualquer momento. Nunca reaparece na mesma reserva.
 */
export function FirstVisitTour({ active, onDone }: { active: boolean; onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    setStep(1);
  }, [active]);

  // Reposiciona continuamente enquanto o passo está ativo (o card abrindo
  // desloca o layout, então a posição do alvo muda logo depois do clique).
  useEffect(() => {
    if (!active) return;
    const selector = step === 1 ? '[data-tour="checkin-card"]' : '[data-tour="senhas-tab"]';

    let found = false;
    function tick() {
      const el = document.querySelector(selector);
      if (el) {
        if (!found) {
          found = true;
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
        const r = measure(el);
        setRect(r);
        setPlacement(r.top > window.innerHeight * 0.55 ? "top" : "bottom");
      } else {
        setRect(null);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, step]);

  // Avança/termina quando o hóspede toca no alvo de verdade (não interceptamos
  // o clique — só escutamos, então o comportamento normal do acordeão/aba
  // continua funcionando exatamente como sem o tour).
  useEffect(() => {
    if (!active) return;
    function onClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      if (step === 1 && target.closest('[data-tour="checkin-card"]')) {
        setStep(2);
      } else if (step === 2 && target.closest('[data-tour="senhas-tab"]')) {
        onDone();
      }
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [active, step, onDone]);

  if (!active || !rect) return null;

  const pad = 6;
  const spotStyle: React.CSSProperties = {
    position: "fixed",
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    borderRadius: 18,
    boxShadow: "0 0 0 9999px rgba(8,8,12,0.74)",
    zIndex: 70,
    pointerEvents: "none",
  };

  const tooltipTop = placement === "bottom" ? rect.top + rect.height + pad + 12 : undefined;
  const tooltipBottom = placement === "top" ? window.innerHeight - (rect.top - pad) + 12 : undefined;

  return (
    <>
      <div style={spotStyle} className="ring-2 ring-accent/80 animate-pulse" aria-hidden />
      <div
        style={{
          position: "fixed",
          top: tooltipTop,
          bottom: tooltipBottom,
          left: Math.max(12, Math.min(rect.left, window.innerWidth - 300)),
          width: 280,
          zIndex: 71,
        }}
        className={cn(
          "rounded-2xl border border-accent/40 bg-card/95 backdrop-blur-xl p-4 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.6)]",
          "animate-in fade-in-0 zoom-in-95 duration-200",
        )}
        role="dialog"
        aria-live="polite"
      >
        <button
          type="button"
          onClick={onDone}
          className="absolute top-2.5 right-2.5 text-muted-foreground hover:text-foreground"
          aria-label="Pular"
        >
          <X className="size-4" />
        </button>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-accent mb-1.5">
          Passo {step} de 2
        </p>
        <p className="text-[14px] leading-relaxed text-foreground/90 pr-4">
          {step === 1
            ? "Toque aqui para ver o passo a passo da chegada e as senhas de acesso."
            : "Agora toque em \"Senhas\" para ver o código do portão e do Wi-Fi."}
        </p>
        <button
          type="button"
          onClick={onDone}
          className="mt-3 text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Pular
        </button>
      </div>
    </>
  );
}
