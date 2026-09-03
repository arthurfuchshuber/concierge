import { useEffect, useRef } from "react";
import { Lock, Home, FileText, DoorOpen, LogOut, LifeBuoy, Compass } from "lucide-react";

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
  const navRef = useRef<HTMLElement>(null);
  const btnRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const settleTimer = useRef<number | null>(null);

  // ANTI-CORTE, parte 3 (03/09/2026) — as partes 1 e 2 (CSS + scrollIntoView
  // simples) ainda deixavam a PRÓXIMA aba "espiando" cortada na borda direita
  // (print real do cliente: "Check-in & Checkout" ativa e inteira, mas "FAQ"
  // aparecendo cortada do lado). Rolagem horizontal comum NUNCA garante isso
  // sozinha: o navegador sempre mostra o que fisicamente cabe no espaço, e
  // dificilmente esse espaço é um múltiplo exato da largura de cada aba.
  //
  // Corrigido com um algoritmo próprio, rodado sempre que a aba ativa muda E
  // sempre que o usuário termina de arrastar a barra manualmente:
  //   1) A partir de uma aba "âncora" (a que precisa ficar visível), soma a
  //      largura das abas seguintes enquanto elas couberem INTEIRAS no
  //      espaço visível.
  //   2) Se sobrar um pedaço de espaço menor que a próxima aba inteira (ou
  //      seja, ela apareceria cortada), esse resto vira um `padding-right`
  //      aplicado na ÚLTIMA aba que coube inteira — "empurra" a aba seguinte
  //      pra fora da área visível por completo, em vez de deixá-la aparecer
  //      pela metade. Se a última aba que coube já é a última da lista, não
  //      sobra nada pra esconder (chegou no fim de verdade) e nada é
  //      aplicado.
  //   3) Rola a barra pra deixar a âncora exatamente no início da área
  //      visível (nunca cortada do lado esquerdo).
  // Isso garante — não só sugere — que NENHUMA aba, ativa ou não, jamais
  // fica parcialmente visível em nenhuma das duas bordas.
  const clearPadding = () => {
    for (const b of btnRefs.current) {
      if (b) b.style.paddingRight = "";
    }
  };

  const findLeadingIndex = (): number => {
    const nav = navRef.current;
    if (!nav) return 0;
    let idx = 0;
    for (let i = 0; i < btnRefs.current.length; i++) {
      const b = btnRefs.current[i];
      if (!b) continue;
      if (b.offsetLeft <= nav.scrollLeft + 1) idx = i;
      else break;
    }
    return idx;
  };

  const applyPage = (anchorIndex: number, scroll: boolean) => {
    const nav = navRef.current;
    const btns = btnRefs.current;
    const anchorBtn = btns[anchorIndex];
    if (!nav || !anchorBtn) return;

    // Limpa qualquer padding aplicado numa rodada anterior ANTES de medir —
    // senão a medição ficaria contaminada pelo espaçador da página anterior.
    clearPadding();
    void nav.offsetWidth; // força o navegador a recalcular o layout já sem o padding antigo antes do próximo read

    const containerWidth = nav.clientWidth;
    const anchorLeft = anchorBtn.offsetLeft;
    let lastIncluded = anchorIndex;
    let consumedEnd = anchorLeft;
    for (let i = anchorIndex; i < btns.length; i++) {
      const b = btns[i];
      if (!b) break;
      const end = b.offsetLeft + b.offsetWidth;
      if (end - anchorLeft > containerWidth) break;
      lastIncluded = i;
      consumedEnd = end;
    }

    const leftover = containerWidth - (consumedEnd - anchorLeft);
    const isTrueEnd = lastIncluded === btns.length - 1;
    if (!isTrueEnd && leftover > 1) {
      const lastBtn = btns[lastIncluded];
      if (lastBtn) lastBtn.style.paddingRight = `${leftover}px`;
    }

    if (scroll) nav.scrollTo({ left: anchorLeft, behavior: "smooth" });
  };

  // Aba ativa mudou (clique OU navegação programática, ex.: `setStep`
  // chamado de outro lugar da tela): se ela já está inteira à vista, só
  // recalcula o espaçador da página atual (útil após um resize); senão,
  // ancora a janela nela.
  useEffect(() => {
    const idx = steps.findIndex((s) => s.value === current);
    if (idx < 0) return;
    const nav = navRef.current;
    const btn = btnRefs.current[idx];
    if (!nav || !btn) return;
    const containerWidth = nav.clientWidth;
    const fullyVisible =
      btn.offsetLeft >= nav.scrollLeft - 1 && btn.offsetLeft + btn.offsetWidth <= nav.scrollLeft + containerWidth + 1;
    applyPage(fullyVisible ? findLeadingIndex() : idx, !fullyVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, steps.length]);

  // Arraste manual (dedo/mouse): espera o usuário "soltar" (150ms sem
  // eventos de scroll) e corrige a posição pra uma página limpa — sem isso,
  // rolar à mão podia parar bem no meio de uma aba, cortando-a nas DUAS
  // bordas, não só na direita. Também reage a mudanças de largura da tela
  // (ex.: girar o celular).
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onScroll = () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
      settleTimer.current = window.setTimeout(() => {
        applyPage(findLeadingIndex(), true);
      }, 150);
    };
    nav.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => applyPage(findLeadingIndex(), false));
    ro.observe(nav);
    return () => {
      nav.removeEventListener("scroll", onScroll);
      ro.disconnect();
      if (settleTimer.current) window.clearTimeout(settleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // ANTI-CORTE (regra global): `ds-segmented` adapta o espaçamento à largura
    // real da tela e rola horizontalmente em vez de cortar qualquer aba.
    <nav
      ref={navRef}
      className="ds-segmented mb-5 -mx-1 px-1 rounded-[0.3rem] bg-foreground/5 p-1"
      // O snap nativo do `ds-segmented` (CSS) só resolve a borda esquerda —
      // este componente já faz um cálculo próprio, mais completo, que cobre
      // as duas bordas (ver comentários acima). Desliga o snap nativo só
      // aqui pra evitar os dois "brigarem" pela posição de rolagem ao mesmo
      // tempo; os outros consumidores de `ds-segmented` continuam com o
      // snap nativo normalmente.
      style={{ scrollSnapType: "none" }}
    >
      {steps.map((s, i) => {
        const active = s.value === current;
        const locked = lockedValues?.includes(s.value) ?? false;
        return (
          <button
            key={s.value}
            ref={(el) => {
              btnRefs.current[i] = el;
            }}
            type="button"
            disabled={locked}
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
