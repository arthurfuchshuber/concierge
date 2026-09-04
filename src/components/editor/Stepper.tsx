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
  // Espaçador "escondedor": some com o resto de espaço quando a próxima aba
  // só caberia pela metade (ver `applyPage`). Reposicionado via `order` pra
  // ficar sempre logo depois da última aba totalmente visível.
  const hideSpacerRef = useRef<HTMLSpanElement>(null);
  // Espaçador "de ponta": fica sempre depois da ÚLTIMA aba de verdade, com
  // uma largura fixa pequena — ver o comentário grande abaixo (parte 4) pra
  // entender por que ele existe.
  const endGutterRef = useRef<HTMLSpanElement>(null);
  const settleTimer = useRef<number | null>(null);

  // Cada aba real recebe `order: i * ORDER_STEP` (número par). Isso deixa
  // "buracos" (os números ímpares) pra reposicionar o espaçador exatamente
  // entre duas abas quaisquer via CSS `order`, sem precisar mexer na ordem
  // real do DOM nem no próprio espaço interno de nenhum botão.
  const ORDER_STEP = 2;
  const END_GUTTER_PX = 8;

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
  //      seja, ela apareceria cortada), esse resto "vira" o espaçador
  //      escondedor logo depois da última aba que coube inteira — empurra a
  //      aba seguinte pra fora da área visível por completo, em vez de
  //      deixá-la aparecer pela metade. Se a última aba que coube já é a
  //      última da lista, não sobra nada pra esconder (chegou no fim de
  //      verdade) e o espaçador some (largura 0).
  //   3) Rola a barra pra deixar a âncora exatamente no início da área
  //      visível (nunca cortada do lado esquerdo).
  // Isso garante — não só sugere — que NENHUMA aba, ativa ou não, jamais
  // fica parcialmente visível em nenhuma das duas bordas.
  //
  // PARTE 4 (03/09/2026, rodada 4) — 2 efeitos colaterais reais reportados
  // pelo cliente depois da parte 3, com causa raiz e correção:
  //
  //   a) "A primeira opção ficou colada na borda esquerda" — `scrollTo({
  //      left: anchorBtn.offsetLeft })` para a 1ª aba rolava a barra ALÉM do
  //      próprio padding-left do `<nav>` (`offsetLeft` do 1º botão já É esse
  //      padding). Corrigido: quando a âncora é o índice 0, rola pra `0`
  //      puro, não pro `offsetLeft`.
  //
  //   b) "Os títulos pararam de ficar centralizados no botão" — a versão
  //      anterior aplicava o resto de espaço como `padding-right` DENTRO de
  //      um botão real. Isso alargava a caixa do botão só do lado direito, e
  //      como o conteúdo é centralizado via `justify-content: center`
  //      DENTRO dessa caixa, um padding assimétrico empurra o conteúdo pra
  //      esquerda do centro visual real do "pill". Corrigido: o resto de
  //      espaço agora vai inteiro para o `hideSpacerRef` — um elemento
  //      próprio, invisível, que nunca é o botão em si. O botão nunca mais
  //      tem seu próprio padding alterado, então seu conteúdo permanece
  //      sempre centralizado.
  //
  //   c) Efeito colateral (não reportado ainda, corrigido preventivamente
  //      junto): sem o padding do próprio `<nav>` a área rolável de um
  //      flex/scroll container costuma "engolir" o padding-right do fim de
  //      verdade — é um comportamento conhecido dos navegadores (padding no
  //      FINAL de um container `overflow` com `display:flex` normalmente não
  //      entra na área rolável, só o padding do INÍCIO entra de forma
  //      confiável). Por isso o `endGutterRef`: um espaçador FIXO (sempre
  //      depois da última aba de verdade) garante uma "sobra" de verdade no
  //      fim da lista, porque a largura de um item flex real sempre entra no
  //      cálculo de rolagem — ao contrário do padding do container.
  //
  // PARTE 5 (03/09/2026, rodada 5) — novo print do cliente: ao abrir
  // diretamente a aba "Check-in & Checkout" (rótulo comprido) numa tela
  // estreita, sobrava um vão grande e cinza entre ela e a borda direita da
  // barra ("o espaço que sobrou entre a última opção visível e a linha
  // lateral"). Duas causas, 2 correções:
  //
  //   a) O algoritmo sempre começava a "página" exatamente na âncora, sem
  //      olhar se dava pra puxar a aba ANTERIOR pra dentro também (o que
  //      preenche melhor a barra e diminui o vão). Agora `applyPage` testa
  //      começar 1, 2, 3... abas mais cedo — sempre mantendo a âncora
  //      100% visível, nunca cortando nada — e fica com o início que sobra
  //      menos espaço vazio no final.
  //   b) Mesmo puxando o máximo possível pra trás, às vezes o rótulo da
  //      âncora sozinho já ocupa quase toda a largura da tela e não sobra
  //      espaço pra mais nenhuma aba — nesse caso o vão é inevitável (é o
  //      espaço que impede a PRÓXIMA aba de aparecer cortada). Pra não
  //      parecer um buraco vazio "quebrado", quando esse vão fica logo
  //      depois da aba ATIVA, ele ganha o mesmo degradê e cantos
  //      arredondados dela — visualmente vira uma continuação do próprio
  //      "pill" ativo, e não um espaço morto. Isso NÃO reintroduz o bug da
  //      parte 4b: o texto continua dentro do botão de verdade, que nunca
  //      teve seu próprio padding alterado — só o vizinho invisível (agora
  //      colorido) que cresce.
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
    const hideSpacer = hideSpacerRef.current;
    const anchorBtn = btns[anchorIndex];
    if (!nav || !anchorBtn) return;

    // Zera o espaçador escondedor (largura, posição E cor) e o tira do meio
    // da lista ANTES de medir — senão a medição ficaria contaminada pelo
    // espaçador da página anterior.
    if (hideSpacer) {
      hideSpacer.style.width = "0px";
      hideSpacer.style.order = String(steps.length * ORDER_STEP - 1);
      hideSpacer.style.background = "";
      hideSpacer.style.borderRadius = "";
    }
    void nav.offsetWidth; // força o navegador a recalcular o layout já sem o espaçador antigo antes do próximo read

    const containerWidth = nav.clientWidth;

    // Preenche gulosamente a partir de um início: inclui abas seguintes
    // enquanto couberem INTEIRAS dentro de `containerWidth`.
    const fillFrom = (start: number) => {
      const startBtn = btns[start];
      if (!startBtn) return null;
      const startLeft = startBtn.offsetLeft;
      let last = start;
      let end = startLeft;
      for (let i = start; i < btns.length; i++) {
        const b = btns[i];
        if (!b) break;
        const bEnd = b.offsetLeft + b.offsetWidth;
        if (bEnd - startLeft > containerWidth) break;
        last = i;
        end = bEnd;
      }
      return { last, end, startLeft };
    };

    // Começa pela âncora (comportamento mínimo garantido) e tenta "puxar"
    // abas anteriores pra dentro da página, uma de cada vez, enquanto isso
    // (1) ainda deixar a âncora inteira visível e (2) reduzir o espaço
    // sobrando no final — ver parte 5a acima.
    const initial = fillFrom(anchorIndex);
    if (!initial) return;
    let best = initial;
    let bestStart = anchorIndex;
    for (let start = anchorIndex - 1; start >= 0; start--) {
      const candidate = fillFrom(start);
      if (!candidate || candidate.last < anchorIndex) break; // não alcança mais a âncora inteira — começos ainda menores também não alcançariam
      const candidateLeftover = containerWidth - (candidate.end - candidate.startLeft);
      const bestLeftover = containerWidth - (best.end - best.startLeft);
      if (candidateLeftover < bestLeftover) {
        best = candidate;
        bestStart = start;
      }
    }

    const { last: lastIncluded, end: consumedEnd, startLeft } = best;
    const leftover = containerWidth - (consumedEnd - startLeft);
    const isTrueEnd = lastIncluded === btns.length - 1;
    if (!isTrueEnd && leftover > 1 && hideSpacer) {
      // `order` ímpar entre `lastIncluded` (par) e `lastIncluded + 1` (par) —
      // reposiciona o espaçador visualmente pra logo depois da última aba
      // que coube inteira, sem tocar no DOM nem no espaço interno de nenhum
      // botão real.
      hideSpacer.style.order = String(lastIncluded * ORDER_STEP + 1);
      hideSpacer.style.width = `${leftover}px`;
      if (steps[lastIncluded]?.value === current) {
        // O espaço sobrando é inevitável e fica logo depois da aba ATIVA —
        // ver parte 5b: colore igual ao "pill" ativo pra parecer uma
        // continuação dele, não um vão cinza vazio.
        hideSpacer.style.background = "linear-gradient(to bottom right, #7C1AD8, #E82DAE)";
        hideSpacer.style.borderRadius = "0.25rem";
      }
    }

    if (scroll) {
      // Início = 1ª aba de todas: rola pra 0 puro (preserva o padding-left
      // do `<nav>` — ver parte 4a acima). Qualquer outro início: o
      // navegador já limita sozinho ao máximo rolável, que agora inclui o
      // `endGutterRef` no fim de verdade (ver parte 4c).
      const target = bestStart === 0 ? 0 : startLeft;
      nav.scrollTo({ left: target, behavior: "smooth" });
    }
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
            // `order` fixo e par — ver comentário grande acima (parte 4) sobre
            // por que os botões precisam de números pares (deixa "buracos"
            // ímpares livres pro espaçador escondedor se encaixar entre 2
            // deles, sem mexer na ordem real do DOM).
            style={{ order: i * ORDER_STEP }}
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
      {/* Espaçador escondedor — ver parte 4b do comentário grande acima.
          `data-spacer` o exclui da regra `.ds-segmented > *` (styles.css),
          que senão forçaria um `padding-inline` nele e atrapalharia o
          cálculo exato de largura feito em `applyPage`. */}
      <span ref={hideSpacerRef} data-spacer aria-hidden="true" className="ds-end-gutter" style={{ width: 0 }} />
      {/* Espaçador de ponta — ver parte 4c do comentário grande acima: fica
          sempre depois da ÚLTIMA aba de verdade (order mais alto de todos),
          garantindo uma sobra real e visível no fim da barra. */}
      <span
        ref={endGutterRef}
        data-spacer
        aria-hidden="true"
        className="ds-end-gutter"
        style={{ width: END_GUTTER_PX, order: steps.length * ORDER_STEP }}
      />
    </nav>
  );
}
